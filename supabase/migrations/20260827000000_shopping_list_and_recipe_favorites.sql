-- Shared household shopping list and recipe favorites. Both are written and
-- read exclusively through trusted server code (the API routes), so they follow
-- the recipe-proposals isolation shape: RLS enabled, no policies, and every
-- direct grant revoked from anon and authenticated.

create table public.shopping_list_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name text not null,
  category text not null,
  food_concept_id text references public.food_concepts (id) on delete set null,
  quantity_text text,
  done boolean not null default false,
  added_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 0,
  constraint shopping_list_items_name_length check (char_length(name) between 1 and 120),
  constraint shopping_list_items_category_length check (char_length(category) between 1 and 80),
  constraint shopping_list_items_quantity_length check (quantity_text is null or char_length(quantity_text) between 1 and 40),
  constraint shopping_list_items_version_nonnegative check (version >= 0)
);

-- One open entry per distinct item per household keeps replays of an offline
-- batch idempotent; a completed entry may be added again freely.
create unique index shopping_list_items_open_name_idx
  on public.shopping_list_items (household_id, lower(name))
  where done = false;
create index shopping_list_items_household_time_idx
  on public.shopping_list_items (household_id, created_at desc);

alter table public.shopping_list_items enable row level security;
revoke all on public.shopping_list_items from anon, authenticated;

create trigger shopping_list_items_touch before update on public.shopping_list_items
  for each row execute function private.touch_versioned_row();

comment on table public.shopping_list_items is
  'Shared per-household shopping list. Trusted server code is the only writer; clients never receive other tenants rows.';

create table public.household_recipe_favorites (
  household_id uuid not null references public.households (id) on delete cascade,
  recipe_id text not null references public.recipes (id) on delete cascade,
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (household_id, recipe_id),
  constraint household_recipe_favorites_recipe_length check (char_length(recipe_id) between 1 and 120)
);

alter table public.household_recipe_favorites enable row level security;
revoke all on public.household_recipe_favorites from anon, authenticated;

comment on table public.household_recipe_favorites is
  'Household-shared favorite recipes. Favorites are visible to every member; removal is also member-level.';
