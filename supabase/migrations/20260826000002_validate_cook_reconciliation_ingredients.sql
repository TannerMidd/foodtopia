-- Only trusted server code may create an authoritative recipe snapshot. Clients
-- reconcile through the existing security-definer RPC, not direct table writes.
revoke insert, update, delete on public.cook_sessions from authenticated;

create function private.recipe_snapshot_has_valid_ingredients(p_snapshot jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  ingredient jsonb;
  ingredient_id text;
  seen_ids text[] := '{}'::text[];
begin
  if jsonb_typeof(p_snapshot) <> 'object'
     or jsonb_typeof(p_snapshot -> 'ingredients') <> 'array'
     or jsonb_array_length(p_snapshot -> 'ingredients') = 0 then
    return false;
  end if;

  for ingredient in
    select value from jsonb_array_elements(p_snapshot -> 'ingredients')
  loop
    if jsonb_typeof(ingredient) <> 'object'
       or jsonb_typeof(ingredient -> 'id') <> 'string' then
      return false;
    end if;
    ingredient_id := btrim(ingredient ->> 'id');
    if ingredient_id = '' or ingredient_id = any(seen_ids) then
      return false;
    end if;
    seen_ids := array_append(seen_ids, ingredient_id);
  end loop;

  return true;
end;
$$;

revoke all on function private.recipe_snapshot_has_valid_ingredients(jsonb) from public;

do $$
begin
  if exists (
    select 1
      from public.cook_sessions
     where not private.recipe_snapshot_has_valid_ingredients(recipe_snapshot)
  ) then
    raise exception using
      errcode = '23514',
      message = 'cook session migration refused: an existing recipe snapshot has malformed or duplicate ingredient IDs';
  end if;
end;
$$;

alter table public.cook_sessions
  add constraint cook_sessions_snapshot_ingredients_valid
  check (private.recipe_snapshot_has_valid_ingredients(recipe_snapshot));

-- Reconciliation rows must name one unique ingredient from the authoritative
-- recipe snapshot and a lot whose confirmed concept matches that ingredient.
create function private.validate_cook_reconciliation_ingredient()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  effective_concept_id text;
  lot_concept_id text;
begin
  select ingredient ->> 'foodConceptId'
    into effective_concept_id
    from public.cook_sessions as session
    cross join lateral jsonb_array_elements(session.recipe_snapshot -> 'ingredients') as ingredients(ingredient)
   where session.id = new.cook_session_id
     and session.household_id = new.household_id
     and ingredient ->> 'id' = new.ingredient_id;

  if effective_concept_id is null or btrim(effective_concept_id) = '' then
    raise exception using
      errcode = '22023',
      message = 'reconciliation ingredient is not in the authoritative recipe snapshot';
  end if;

  select lot.food_concept_id
    into lot_concept_id
    from public.inventory_lots as lot
   where lot.id = new.lot_id
     and lot.household_id = new.household_id;

  if lot_concept_id is null or lot_concept_id <> effective_concept_id then
    raise exception using
      errcode = '22023',
      message = 'reconciliation lot does not match the effective recipe ingredient';
  end if;

  return new;
end;
$$;

revoke all on function private.validate_cook_reconciliation_ingredient() from public;

do $$
begin
  if exists (
    select 1
      from public.cook_reconciliations as reconciliation
      join public.cook_sessions as session
        on session.id = reconciliation.cook_session_id
       and session.household_id = reconciliation.household_id
      left join public.inventory_lots as lot
        on lot.id = reconciliation.lot_id
       and lot.household_id = reconciliation.household_id
     where not exists (
             select 1
               from jsonb_array_elements(session.recipe_snapshot -> 'ingredients') as ingredients(ingredient)
              where ingredient ->> 'id' = reconciliation.ingredient_id
                and ingredient ->> 'foodConceptId' = lot.food_concept_id
           )
  ) then
    raise exception using
      errcode = '23514',
      message = 'cook reconciliation migration refused: historical rows do not match their recipe snapshots';
  end if;
end;
$$;

create trigger cook_reconciliations_validate_ingredient
before insert on public.cook_reconciliations
for each row execute function private.validate_cook_reconciliation_ingredient();
