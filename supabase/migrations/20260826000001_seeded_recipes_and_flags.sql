-- Publish honest initial-seed catalog content and let household members flag a
-- visible recipe once without retaining free-form text.

-- Stop rather than inventing review metadata for a malformed public row. The
-- operator must repair or remove such content deliberately before retrying.
do $$
begin
  if exists (
    select 1
      from public.recipes
     where visibility = 'published'
       and (
         rights_status = 'draft'
         or rights_reviewed_at is null
         or rights_reviewer is null
         or btrim(rights_reviewer) = ''
         or rights_reviewer <> btrim(rights_reviewer)
         or char_length(rights_reviewer) > 160
       )
  ) then
    raise exception using
      errcode = '23514',
      message = 'Public recipe rights metadata is invalid; repair it before enabling seeded recipes.';
  end if;
end;
$$;

-- Older household rows could legally carry a reviewer on drafts or omit a
-- meaningful reviewer on reviewed content. Remove claims rather than inventing
-- an attestation while preserving the recipe as a private draft.
update public.recipes
   set rights_reviewer = null,
       rights_reviewed_at = null
 where visibility = 'household'
   and rights_status = 'draft';

update public.recipes
   set rights_status = 'draft',
       rights_reviewer = null,
       rights_reviewed_at = null
 where visibility = 'household'
   and rights_status = 'reviewed'
   and (
     rights_reviewer is null
     or btrim(rights_reviewer) = ''
     or rights_reviewer <> btrim(rights_reviewer)
     or char_length(rights_reviewer) > 160
   );

alter table public.recipes drop constraint recipes_review_shape;
alter table public.recipes add constraint recipes_review_shape check (
  (
    rights_status = 'reviewed'
    and rights_reviewer is not null
    and char_length(btrim(rights_reviewer)) between 1 and 160
    and rights_reviewer = btrim(rights_reviewer)
    and rights_reviewed_at is not null
  )
  or (rights_status in ('draft', 'seeded') and rights_reviewer is null and rights_reviewed_at is null)
);
alter table public.recipes add constraint recipes_publication_status check (
  visibility <> 'published' or rights_status in ('seeded', 'reviewed')
);

create type public.recipe_flag_reason as enum (
  'inaccurate',
  'unsafe',
  'poor_instructions',
  'rights_concern',
  'other'
);

create table public.recipe_flags (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  recipe_id text not null references public.recipes (id) on delete cascade,
  reason public.recipe_flag_reason not null,
  flagged_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint recipe_flags_one_per_member unique (household_id, recipe_id, flagged_by)
);

create index recipe_flags_recipe_idx on public.recipe_flags (recipe_id, created_at desc);
create index recipe_flags_household_idx on public.recipe_flags (household_id, created_at desc);

alter table public.recipe_flags enable row level security;

-- Replace reviewed-only public visibility with reviewed-or-seeded visibility.
drop policy recipes_select_published on public.recipes;
create policy recipes_select_published on public.recipes
  for select to anon, authenticated
  using (visibility = 'published' and rights_status in ('seeded', 'reviewed'));

drop policy recipe_ingredients_select_published on public.recipe_ingredients;
create policy recipe_ingredients_select_published on public.recipe_ingredients
  for select to anon, authenticated
  using (
    exists (
      select 1
        from public.recipes as r
       where r.id = recipe_ingredients.recipe_id
         and r.visibility = 'published'
         and r.rights_status in ('seeded', 'reviewed')
    )
  );

create policy recipe_flags_select_household on public.recipe_flags
  for select to authenticated
  using (
    flagged_by = (select auth.uid())
    and private.is_household_member(household_id)
    and exists (
      select 1 from public.profiles as p
       where p.id = (select auth.uid()) and p.status = 'enabled'
    )
  );

create policy recipe_flags_insert_visible on public.recipe_flags
  for insert to authenticated
  with check (
    household_id = private.current_household_id()
    and flagged_by = (select auth.uid())
    and exists (
      select 1 from public.profiles as p
       where p.id = (select auth.uid()) and p.status = 'enabled'
    )
    and exists (
      select 1
        from public.recipes as r
       where r.id = recipe_flags.recipe_id
         and (
           (r.visibility = 'published' and r.rights_status in ('seeded', 'reviewed'))
           or (r.visibility = 'household' and r.household_id = private.current_household_id())
         )
    )
  );

-- Flags are append-only feedback. Duplicate inserts are handled idempotently by
-- the API and users cannot alter or erase an existing report.
grant select, insert on public.recipe_flags to authenticated;
