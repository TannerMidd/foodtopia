-- Household-scoped AI recipe proposals. Model output remains inert until an
-- enabled household member makes an explicit, versioned decision.

create type public.recipe_proposal_status as enum ('proposed', 'approved', 'denied', 'expired');

create table public.recipe_proposals (
  id uuid primary key,
  household_id uuid not null references public.households (id) on delete cascade,
  status public.recipe_proposal_status not null default 'proposed',
  recipe_payload jsonb,
  content_hash text,
  idempotency_key uuid not null,
  request_fingerprint text not null,
  expires_at timestamptz not null default (now() + interval '24 hours'),
  provider text,
  model text,
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  recipe_id text references public.recipes (id) on delete restrict,
  version integer not null default 0,
  constraint recipe_proposals_content_hash check (content_hash is null or content_hash ~ '^[0-9a-f]{64}$'),
  constraint recipe_proposals_request_fingerprint check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint recipe_proposals_expiry check (expires_at > created_at),
  constraint recipe_proposals_provider_length check (provider is null or char_length(provider) between 1 and 40),
  constraint recipe_proposals_model_length check (model is null or char_length(model) between 1 and 160),
  constraint recipe_proposals_version_nonnegative check (version >= 0),
  constraint recipe_proposals_payload_shape check (
    recipe_payload is null or (
      jsonb_typeof(recipe_payload) = 'object'
      and jsonb_typeof(recipe_payload -> 'ingredients') = 'array'
      and jsonb_array_length(recipe_payload -> 'ingredients') between 2 and 16
      and jsonb_typeof(recipe_payload -> 'steps') = 'array'
      and jsonb_array_length(recipe_payload -> 'steps') between 2 and 12
    )
  ),
  constraint recipe_proposals_lifecycle_shape check (
    (
      status = 'proposed' and recipe_payload is not null and content_hash is not null
      and decided_by is null and decided_at is null and recipe_id is null
    ) or (
      status = 'approved' and recipe_payload is not null and content_hash is not null
      and decided_by is not null and decided_at is not null and recipe_id is not null
    ) or (
      status = 'denied' and recipe_payload is null and content_hash is null
      and decided_by is not null and decided_at is not null and recipe_id is null
    ) or (
      status = 'expired' and recipe_payload is null and content_hash is null
      and decided_by is null and decided_at is not null and recipe_id is null
    )
  ),
  constraint recipe_proposals_idempotency unique (household_id, created_by, idempotency_key)
);

create index recipe_proposals_household_status_idx
  on public.recipe_proposals (household_id, status, created_at desc);
create index recipe_proposals_recipe_idx
  on public.recipe_proposals (recipe_id) where recipe_id is not null;

alter table public.recipe_proposals enable row level security;
-- No policies or direct grants: trusted server code inserts/reads proposals and
-- decide_recipe_proposal is the only authenticated mutation boundary.
revoke all on public.recipe_proposals from anon, authenticated;

-- Account disablement must revoke every household capability even while an Auth
-- token remains valid. Keeping this check in the shared helper protects all
-- existing household RLS policies and security-definer RPCs consistently.
create or replace function private.current_household_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select hm.household_id
    from public.household_members as hm
    join public.households as h on h.id = hm.household_id
    join public.profiles as p on p.id = hm.user_id
   where hm.user_id = (select auth.uid())
     and p.status = 'enabled'
     and h.deletion_requested_at is null
$$;

create or replace function public.consume_rate_limit(
  p_action text,
  p_limit integer,
  p_window_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_household_id uuid := private.current_household_id();
  action_value public.api_rate_limit_action;
  observed_at timestamptz := clock_timestamp();
  window_start timestamptz;
  consumed_count bigint;
  is_allowed boolean;
  remaining_count bigint;
  retry_seconds integer;
begin
  if actor_id is null or actor_household_id is null then
    raise exception using errcode = '28000', message = 'active household session required';
  end if;
  if not exists (
    select 1 from public.profiles as p
     where p.id = actor_id and p.status = 'enabled'
  ) then
    raise exception using errcode = '42501', message = 'enabled account required';
  end if;
  if p_action not in (
    'analysis_create',
    'recipe_suggest',
    'recipe_generate',
    'invite_create',
    'inventory_command',
    'cook_reconcile'
  ) then
    raise exception using errcode = '22023', message = 'unsupported rate-limit action';
  end if;
  if p_limit is null or p_limit not between 1 and 10000 then
    raise exception using errcode = '22023', message = 'rate-limit maximum must be between 1 and 10000';
  end if;
  if p_window_seconds is null or p_window_seconds not in (60, 300, 3600, 86400) then
    raise exception using errcode = '22023', message = 'rate-limit window must be 60, 300, 3600, or 86400 seconds';
  end if;

  action_value := p_action::public.api_rate_limit_action;
  window_start := to_timestamp(
    floor(extract(epoch from observed_at) / p_window_seconds) * p_window_seconds
  );

  insert into public.api_rate_limits (
    household_id, user_id, action, window_seconds, window_started_at, request_count
  ) values (
    actor_household_id, actor_id, action_value, p_window_seconds, window_start, 1
  )
  on conflict (household_id, user_id, action, window_seconds, window_started_at)
  do update set request_count = public.api_rate_limits.request_count + 1
  returning request_count into consumed_count;

  is_allowed := consumed_count <= p_limit;
  remaining_count := greatest(p_limit::bigint - consumed_count, 0);
  retry_seconds := case
    when is_allowed then 0
    else greatest(
      1,
      ceil(extract(epoch from (
        window_start + make_interval(secs => p_window_seconds) - observed_at
      )))::integer
    )
  end;

  return jsonb_build_object(
    'allowed', is_allowed,
    'remaining', remaining_count,
    'retryAfterSeconds', retry_seconds
  );
end;
$$;

revoke all on function public.consume_rate_limit(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text, integer, integer)
  to authenticated;

create function public.decide_recipe_proposal(
  p_proposal_id uuid,
  p_decision text,
  p_expected_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_household_id uuid := private.current_household_id();
  proposal public.recipe_proposals%rowtype;
  payload jsonb;
  target_recipe_id text;
  ingredient_count integer;
begin
  if actor_id is null or actor_household_id is null then
    raise exception using errcode = '28000', message = 'active household session required';
  end if;
  if not exists (
    select 1 from public.profiles as p
     where p.id = actor_id and p.status = 'enabled'
  ) then
    raise exception using errcode = '42501', message = 'enabled account required';
  end if;
  if p_decision not in ('approve', 'deny') then
    raise exception using errcode = '22023', message = 'decision must be approve or deny';
  end if;
  if p_expected_version is null or p_expected_version < 0 then
    raise exception using errcode = '22023', message = 'expected version is invalid';
  end if;

  select * into proposal
    from public.recipe_proposals
   where id = p_proposal_id
     and household_id = actor_household_id
   for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'recipe proposal not found';
  end if;

  if proposal.status <> 'proposed' then
    if (proposal.status = 'approved' and p_decision = 'approve')
       or (proposal.status = 'denied' and p_decision = 'deny') then
      return jsonb_build_object(
        'proposalId', proposal.id,
        'status', proposal.status,
        'recipeId', proposal.recipe_id,
        'version', proposal.version,
        'replayed', true
      );
    end if;
    if proposal.status = 'expired' then
      raise exception using errcode = '55000', message = 'recipe proposal expired';
    end if;
    raise exception using errcode = '23514', message = 'recipe proposal already has a different decision';
  end if;
  if proposal.expires_at <= clock_timestamp() then
    update public.recipe_proposals
       set status = 'expired', recipe_payload = null, content_hash = null,
           decided_at = clock_timestamp(), version = version + 1
     where id = proposal.id
     returning version into p_expected_version;
    return jsonb_build_object(
      'proposalId', proposal.id,
      'status', 'expired',
      'recipeId', null,
      'version', p_expected_version,
      'replayed', false
    );
  end if;
  if proposal.version <> p_expected_version then
    raise exception using errcode = '40001', message = 'recipe proposal version changed';
  end if;

  if p_decision = 'deny' then
    update public.recipe_proposals
       set status = 'denied', recipe_payload = null, content_hash = null,
           decided_by = actor_id, decided_at = clock_timestamp(), version = version + 1
     where id = proposal.id
     returning version into p_expected_version;
    return jsonb_build_object(
      'proposalId', proposal.id,
      'status', 'denied',
      'recipeId', null,
      'version', p_expected_version,
      'replayed', false
    );
  end if;

  payload := proposal.recipe_payload;
  target_recipe_id := payload ->> 'id';
  if target_recipe_id is null or target_recipe_id !~ '^generated-[0-9a-f-]{36}$' then
    raise exception using errcode = '23514', message = 'generated recipe ID is invalid';
  end if;
  if jsonb_typeof(payload -> 'ingredients') <> 'array'
     or jsonb_array_length(payload -> 'ingredients') not between 2 and 16
     or jsonb_typeof(payload -> 'steps') <> 'array' then
    raise exception using errcode = '23514', message = 'generated recipe payload is malformed';
  end if;
  select count(*)::integer into ingredient_count
    from jsonb_array_elements(payload -> 'ingredients') as items(item)
   where jsonb_typeof(item) = 'object'
     and item ? 'id' and item ? 'foodConceptId' and item ? 'name'
     and item ? 'display' and item ? 'required' and item ? 'acceptedForms';
  if ingredient_count <> jsonb_array_length(payload -> 'ingredients') then
    raise exception using errcode = '23514', message = 'generated ingredients are malformed';
  end if;

  insert into public.recipes (
    id, household_id, visibility, slug, title, description, servings,
    total_minutes, meal_types, cuisines, dietary_tags, steps,
    rights_owner, rights_author, rights_reviewer, rights_reviewed_at,
    rights_status, created_by
  ) values (
    target_recipe_id, actor_household_id, 'household', payload ->> 'slug',
    payload ->> 'title', payload ->> 'description', (payload ->> 'servings')::smallint,
    (payload ->> 'totalMinutes')::smallint,
    array(select jsonb_array_elements_text(payload -> 'mealTypes')),
    array(select jsonb_array_elements_text(payload -> 'cuisines')),
    array(select jsonb_array_elements_text(payload -> 'dietaryTags')),
    array(select jsonb_array_elements_text(payload -> 'steps')),
    'Household', 'AI-assisted household recipe', null, null, 'draft', actor_id
  );

  insert into public.recipe_ingredients (
    recipe_id, id, household_id, position, food_concept_id, name, amount,
    unit, display, required, accepted_forms
  )
  select
    target_recipe_id,
    ingredient ->> 'id',
    actor_household_id,
    (ordinality - 1)::smallint,
    ingredient ->> 'foodConceptId',
    ingredient ->> 'name',
    case when ingredient -> 'amount' = 'null'::jsonb then null
         else (ingredient ->> 'amount')::numeric end,
    ingredient ->> 'unit',
    ingredient ->> 'display',
    (ingredient ->> 'required')::boolean,
    array(select jsonb_array_elements_text(ingredient -> 'acceptedForms'))::public.food_form[]
  from jsonb_array_elements(payload -> 'ingredients') with ordinality as items(ingredient, ordinality);

  update public.recipe_proposals
     set status = 'approved', recipe_id = target_recipe_id,
         decided_by = actor_id, decided_at = clock_timestamp(), version = version + 1
   where id = proposal.id
   returning version into p_expected_version;

  return jsonb_build_object(
    'proposalId', proposal.id,
    'status', 'approved',
    'recipeId', target_recipe_id,
    'version', p_expected_version,
    'replayed', false
  );
end;
$$;

revoke all on function public.decide_recipe_proposal(uuid, text, integer)
  from public, anon, authenticated;
grant execute on function public.decide_recipe_proposal(uuid, text, integer)
  to authenticated;

-- A disabled profile can retain an otherwise valid Auth token. Household recipe
-- access therefore checks admission status in addition to membership.
drop policy recipes_select_household on public.recipes;
create policy recipes_select_household on public.recipes
  for select to authenticated
  using (
    visibility = 'household'
    and private.is_household_member(household_id)
    and exists (select 1 from public.profiles as p where p.id = (select auth.uid()) and p.status = 'enabled')
  );
drop policy recipes_insert_household on public.recipes;
create policy recipes_insert_household on public.recipes
  for insert to authenticated
  with check (
    visibility = 'household'
    and household_id = private.current_household_id()
    and created_by = (select auth.uid())
    and exists (select 1 from public.profiles as p where p.id = (select auth.uid()) and p.status = 'enabled')
  );
drop policy recipes_update_household on public.recipes;
create policy recipes_update_household on public.recipes
  for update to authenticated
  using (
    visibility = 'household'
    and private.is_household_member(household_id)
    and exists (select 1 from public.profiles as p where p.id = (select auth.uid()) and p.status = 'enabled')
  )
  with check (
    visibility = 'household'
    and household_id = private.current_household_id()
    and created_by = (select auth.uid())
    and exists (select 1 from public.profiles as p where p.id = (select auth.uid()) and p.status = 'enabled')
  );
drop policy recipes_delete_household on public.recipes;
create policy recipes_delete_household on public.recipes
  for delete to authenticated
  using (
    visibility = 'household'
    and private.is_household_member(household_id)
    and exists (select 1 from public.profiles as p where p.id = (select auth.uid()) and p.status = 'enabled')
  );

drop policy recipe_ingredients_select_household on public.recipe_ingredients;
create policy recipe_ingredients_select_household on public.recipe_ingredients
  for select to authenticated
  using (
    exists (
      select 1 from public.recipes as r
       where r.id = recipe_ingredients.recipe_id
         and r.visibility = 'household'
         and private.is_household_member(r.household_id)
    )
    and exists (select 1 from public.profiles as p where p.id = (select auth.uid()) and p.status = 'enabled')
  );
drop policy recipe_ingredients_insert_household on public.recipe_ingredients;
create policy recipe_ingredients_insert_household on public.recipe_ingredients
  for insert to authenticated
  with check (
    household_id = private.current_household_id()
    and exists (
      select 1 from public.recipes as r
       where r.id = recipe_ingredients.recipe_id
         and r.visibility = 'household'
         and r.household_id = private.current_household_id()
    )
    and exists (select 1 from public.profiles as p where p.id = (select auth.uid()) and p.status = 'enabled')
  );
drop policy recipe_ingredients_update_household on public.recipe_ingredients;
create policy recipe_ingredients_update_household on public.recipe_ingredients
  for update to authenticated
  using (
    private.is_household_member(household_id)
    and exists (select 1 from public.profiles as p where p.id = (select auth.uid()) and p.status = 'enabled')
  )
  with check (
    household_id = private.current_household_id()
    and exists (
      select 1 from public.recipes as r
       where r.id = recipe_ingredients.recipe_id
         and r.visibility = 'household'
         and r.household_id = private.current_household_id()
    )
    and exists (select 1 from public.profiles as p where p.id = (select auth.uid()) and p.status = 'enabled')
  );
drop policy recipe_ingredients_delete_household on public.recipe_ingredients;
create policy recipe_ingredients_delete_household on public.recipe_ingredients
  for delete to authenticated
  using (
    private.is_household_member(household_id)
    and exists (select 1 from public.profiles as p where p.id = (select auth.uid()) and p.status = 'enabled')
  );

comment on table public.recipe_proposals is
  'Server-validated household AI recipe proposals. Raw prompts and raw inventory labels are never stored; undecided payloads expire after 24 hours.';
comment on function public.decide_recipe_proposal(uuid, text, integer) is
  'Atomically approves or denies the caller household proposal; approval creates a private draft recipe and denial clears payload.';
