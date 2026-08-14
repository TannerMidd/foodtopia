-- Household-only concepts preserve inventory identity when a food cannot be
-- resolved to the curated global vocabulary. They deliberately never appear in
-- recipe ingredients, aliases, or recipe matching.
create table public.household_custom_food_concepts (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  normalized_name text not null,
  display_name text not null,
  category text not null default 'Other',
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 0,
  constraint household_custom_food_concepts_identity unique (id, household_id),
  constraint household_custom_food_concepts_normalized_name unique (household_id, normalized_name),
  constraint household_custom_food_concepts_normalized_name_length check (char_length(btrim(normalized_name)) between 1 and 120),
  constraint household_custom_food_concepts_display_name_length check (char_length(btrim(display_name)) between 1 and 120),
  constraint household_custom_food_concepts_category_length check (char_length(btrim(category)) between 1 and 80),
  constraint household_custom_food_concepts_version_nonnegative check (version >= 0)
);

create index household_custom_food_concepts_household_idx
  on public.household_custom_food_concepts (household_id, normalized_name);

create trigger household_custom_food_concepts_touch
before update on public.household_custom_food_concepts
for each row execute function private.touch_row();

create function private.normalize_custom_food_name(p_name text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select regexp_replace(
    regexp_replace(lower(btrim(p_name)), '[^a-z0-9]+', ' ', 'g'),
    '\s+', ' ',
    'g'
  )
$$;

create function private.resolve_household_custom_food_concept(
  p_household_id uuid,
  p_name text,
  p_category text,
  p_actor_id uuid
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  normalized text := private.normalize_custom_food_name(p_name);
  resolved_id uuid;
begin
  if normalized is null or char_length(normalized) not between 1 and 120 then
    raise exception using errcode = '22023', message = 'custom food name must be between 1 and 120 characters';
  end if;
  if p_category is null or char_length(btrim(p_category)) not between 1 and 80 then
    raise exception using errcode = '22023', message = 'custom food category must be between 1 and 80 characters';
  end if;

  insert into public.household_custom_food_concepts (
    household_id, normalized_name, display_name, category, created_by
  ) values (
    p_household_id, normalized, btrim(p_name), btrim(p_category), p_actor_id
  )
  on conflict (household_id, normalized_name) do nothing
  returning id into resolved_id;

  if resolved_id is null then
    select id
      into resolved_id
      from public.household_custom_food_concepts
     where household_id = p_household_id
       and normalized_name = normalized;
  end if;

  return resolved_id;
end;
$$;

revoke all on function private.normalize_custom_food_name(text) from public, anon, authenticated;
revoke all on function private.resolve_household_custom_food_concept(uuid, text, text, uuid) from public, anon, authenticated;

-- A previously stored unresolved lot is upgraded during migration so the new
-- invariant is immediately true before it is enforced.
insert into public.household_custom_food_concepts (
  household_id, normalized_name, display_name, category, created_by
)
select distinct on (lot.household_id, private.normalize_custom_food_name(lot.name))
  lot.household_id,
  private.normalize_custom_food_name(lot.name),
  btrim(lot.name),
  btrim(lot.category),
  lot.created_by
from public.inventory_lots as lot
where lot.food_concept_id is null
order by lot.household_id, private.normalize_custom_food_name(lot.name), lot.created_at, lot.id
on conflict (household_id, normalized_name) do nothing;

alter table public.inventory_lots
  add column custom_food_concept_id uuid;

update public.inventory_lots as lot
   set custom_food_concept_id = custom_concept.id
  from public.household_custom_food_concepts as custom_concept
 where lot.food_concept_id is null
   and custom_concept.household_id = lot.household_id
   and custom_concept.normalized_name = private.normalize_custom_food_name(lot.name);

alter table public.inventory_lots
  add constraint inventory_lots_custom_concept_tenant_fk
    foreign key (custom_food_concept_id, household_id)
    references public.household_custom_food_concepts (id, household_id)
    on delete cascade,
  add constraint inventory_lots_single_concept_identity
    check (num_nonnulls(food_concept_id, custom_food_concept_id) = 1);

create index inventory_lots_household_custom_concept_idx
  on public.inventory_lots (household_id, custom_food_concept_id);

-- Replaces the original private command primitive so every add, correction,
-- review apply, and reconciliation flows through the same resolver.
create or replace function private.inventory_event_for_command(
  p_household_id uuid,
  p_actor_id uuid,
  p_command_id uuid,
  p_command_type public.inventory_command_type,
  p_expected_version integer,
  p_payload jsonb,
  p_event_type public.inventory_event_type
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  canonical_payload jsonb := p_payload - 'householdId' - 'household_id';
  before_lot public.inventory_lots%rowtype;
  after_lot public.inventory_lots%rowtype;
  command_lot_id uuid;
  next_food_concept_id text;
  next_custom_food_concept_id uuid;
  next_name text;
  next_category text;
  next_quantity_status public.quantity_status;
  next_quantity numeric(12, 3);
  next_unit text;
  next_form public.food_form;
  next_location public.food_location;
  next_date_label_type public.date_label_type;
  next_date_label date;
  next_status public.inventory_lot_status;
  command_result jsonb;
begin
  if p_command_type is null then
    raise exception using errcode = '22023', message = 'command type is required';
  end if;
  if p_command_type = 'add' then
    command_lot_id := coalesce(nullif(canonical_payload ->> 'id', '')::uuid, gen_random_uuid());
    next_food_concept_id := nullif(canonical_payload ->> 'foodConceptId', '');
    next_name := nullif(btrim(canonical_payload ->> 'name'), '');
    next_category := coalesce(nullif(btrim(canonical_payload ->> 'category'), ''), 'Other');
    if next_name is null or char_length(next_name) > 120 then
      raise exception using errcode = '22023', message = 'inventory name must be between 1 and 120 characters';
    end if;
    if char_length(next_category) > 80 then
      raise exception using errcode = '22023', message = 'inventory category must be between 1 and 80 characters';
    end if;
    next_custom_food_concept_id := case
      when next_food_concept_id is null then private.resolve_household_custom_food_concept(
        p_household_id, next_name, next_category, p_actor_id
      )
      else null
    end;
    next_quantity_status := coalesce(
      nullif(canonical_payload ->> 'quantityStatus', '')::public.quantity_status,
      'unknown'
    );
    next_quantity := nullif(canonical_payload ->> 'quantity', '')::numeric;
    next_unit := nullif(btrim(canonical_payload ->> 'unit'), '');
    next_date_label_type := nullif(canonical_payload ->> 'dateLabelType', '')::public.date_label_type;
    next_date_label := nullif(canonical_payload ->> 'dateLabel', '')::date;
    if next_quantity_status = 'unknown' then next_quantity := null; next_unit := null; end if;
    if next_date_label is null then next_date_label_type := null; end if;
    insert into public.inventory_lots (
      id, household_id, food_concept_id, custom_food_concept_id, name, category, quantity_status,
      quantity, unit, form, location, date_label_type, date_label, status,
      metadata, created_by
    ) values (
      command_lot_id, p_household_id, next_food_concept_id, next_custom_food_concept_id,
      next_name, next_category, next_quantity_status, next_quantity, next_unit,
      coalesce(nullif(canonical_payload ->> 'form', '')::public.food_form, 'unspecified'),
      coalesce(nullif(canonical_payload ->> 'location', '')::public.food_location, 'unknown'),
      next_date_label_type, next_date_label, 'active',
      coalesce(canonical_payload -> 'metadata', '{}'::jsonb), p_actor_id
    ) returning * into after_lot;
  else
    command_lot_id := nullif(canonical_payload ->> 'lotId', '')::uuid;
    select l.* into before_lot
      from public.inventory_lots as l
     where l.id = command_lot_id and l.household_id = p_household_id
     for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'inventory lot not found';
    end if;
    if before_lot.version <> p_expected_version then
      raise exception using errcode = '40001', message = 'inventory lot version conflict';
    end if;
    if p_command_type in ('consume', 'discard') and before_lot.status <> 'active' then
      raise exception using errcode = '22023', message = 'only an active lot can be consumed or discarded';
    end if;
    if p_command_type = 'restore' and before_lot.status = 'active' then
      raise exception using errcode = '22023', message = 'lot is already active';
    end if;

    next_food_concept_id := case when p_command_type = 'adjust' and canonical_payload ? 'foodConceptId'
      then nullif(canonical_payload ->> 'foodConceptId', '') else before_lot.food_concept_id end;
    next_name := case when p_command_type = 'adjust' and canonical_payload ? 'name'
      then nullif(btrim(canonical_payload ->> 'name'), '') else before_lot.name end;
    next_category := case when p_command_type = 'adjust' and canonical_payload ? 'category'
      then nullif(btrim(canonical_payload ->> 'category'), '') else before_lot.category end;
    if next_name is null or char_length(next_name) > 120 then
      raise exception using errcode = '22023', message = 'inventory name must be between 1 and 120 characters';
    end if;
    if next_category is null or char_length(next_category) > 80 then
      raise exception using errcode = '22023', message = 'inventory category must be between 1 and 80 characters';
    end if;
    next_custom_food_concept_id := case
      when next_food_concept_id is null then private.resolve_household_custom_food_concept(
        p_household_id, next_name, next_category, p_actor_id
      )
      else null
    end;
    next_quantity_status := case when canonical_payload ? 'quantityStatus'
      then nullif(canonical_payload ->> 'quantityStatus', '')::public.quantity_status else before_lot.quantity_status end;
    next_quantity := case when canonical_payload ? 'quantity'
      then nullif(canonical_payload ->> 'quantity', '')::numeric else before_lot.quantity end;
    next_unit := case when canonical_payload ? 'unit'
      then nullif(btrim(canonical_payload ->> 'unit'), '') else before_lot.unit end;
    next_form := case when canonical_payload ? 'form'
      then nullif(canonical_payload ->> 'form', '')::public.food_form else before_lot.form end;
    next_location := case when canonical_payload ? 'location'
      then nullif(canonical_payload ->> 'location', '')::public.food_location else before_lot.location end;
    next_date_label_type := case when canonical_payload ? 'dateLabelType'
      then nullif(canonical_payload ->> 'dateLabelType', '')::public.date_label_type else before_lot.date_label_type end;
    next_date_label := case when canonical_payload ? 'dateLabel'
      then nullif(canonical_payload ->> 'dateLabel', '')::date else before_lot.date_label end;
    if next_quantity_status = 'unknown' then next_quantity := null; next_unit := null; end if;
    if next_date_label is null then next_date_label_type := null; end if;
    next_status := case p_command_type
      when 'consume' then 'consumed'::public.inventory_lot_status
      when 'discard' then 'discarded'::public.inventory_lot_status
      when 'restore' then 'active'::public.inventory_lot_status
      else before_lot.status
    end;
    update public.inventory_lots
       set food_concept_id = next_food_concept_id,
           custom_food_concept_id = next_custom_food_concept_id,
           name = next_name, category = next_category,
           quantity_status = next_quantity_status, quantity = next_quantity,
           unit = next_unit, form = next_form, location = next_location,
           date_label_type = next_date_label_type, date_label = next_date_label,
           status = next_status
     where id = command_lot_id and household_id = p_household_id
    returning * into after_lot;
  end if;

  command_result := jsonb_build_object('lot', private.inventory_lot_dto(after_lot), 'replayed', false);
  insert into public.inventory_commands (
    id, household_id, idempotency_key, command_type, target_lot_id,
    expected_version, payload, result, created_by
  ) values (
    p_command_id, p_household_id, p_command_id, p_command_type, after_lot.id,
    p_expected_version, canonical_payload, command_result, p_actor_id
  );
  insert into public.inventory_events (
    household_id, command_id, lot_id, event_type, prior_version, new_version,
    quantity_before, quantity_after, lot_snapshot, created_by
  ) values (
    p_household_id, p_command_id, after_lot.id, p_event_type,
    case when p_command_type = 'add' then null else before_lot.version end,
    after_lot.version,
    case when p_command_type = 'add' then null else before_lot.quantity end,
    after_lot.quantity, private.inventory_lot_dto(after_lot), p_actor_id
  );
  return command_result;
end;
$$;

revoke all on table public.household_custom_food_concepts from public, anon, authenticated;
grant select on public.household_custom_food_concepts to authenticated;
alter table public.household_custom_food_concepts enable row level security;

create policy household_custom_food_concepts_select_household on public.household_custom_food_concepts
  for select to authenticated
  using (private.is_household_member(household_id));
-- No direct write policy: custom concepts are only materialized through the
-- reviewed inventory command primitive above.
