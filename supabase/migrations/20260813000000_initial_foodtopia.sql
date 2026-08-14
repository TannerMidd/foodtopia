-- Foodtopia initial persistence and tenancy model.
--
-- Security invariant: a client-provided household UUID is never an authority.
-- Tenant access is derived from auth.uid() through household_members. All public
-- tenant tables have RLS enabled, and cross-table foreign keys repeat
-- household_id so a row cannot be attached to an object in another household.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create type public.household_role as enum ('owner', 'member');
create type public.invite_status as enum ('pending', 'accepted', 'revoked', 'expired');
create type public.food_alias_scope as enum ('global', 'household');
create type public.quantity_status as enum ('unknown', 'estimated', 'known');
create type public.food_location as enum ('unknown', 'pantry', 'fridge', 'freezer', 'other');
create type public.food_form as enum ('unspecified', 'fresh', 'frozen', 'canned', 'dried', 'cooked', 'opened');
create type public.date_label_type as enum ('best_before', 'sell_by', 'use_by', 'unknown');
create type public.inventory_lot_status as enum ('active', 'consumed', 'discarded');
create type public.inventory_command_type as enum ('add', 'adjust', 'consume', 'discard', 'restore');
create type public.inventory_command_status as enum ('applied');
create type public.inventory_event_type as enum (
  'lot_added',
  'lot_adjusted',
  'lot_consumed',
  'lot_discarded',
  'lot_restored',
  'lot_added_from_analysis',
  'lot_reconciled'
);
create type public.analysis_status as enum (
  'created',
  'uploaded',
  'queued',
  'processing',
  'needs_review',
  'applied',
  'failed',
  'cancelled',
  'expired'
);
create type public.image_asset_status as enum (
  'pending_upload',
  'uploaded',
  'processing',
  'processed',
  'purge_pending',
  'deleted',
  'failed'
);
create type public.analysis_candidate_status as enum ('proposed', 'accepted', 'rejected');
create type public.recipe_visibility as enum ('household', 'published');
create type public.recipe_review_status as enum ('draft', 'reviewed');
create type public.cook_session_status as enum ('active', 'reconciled', 'cancelled');
create type public.cook_reconciliation_action as enum ('no_change', 'used_some', 'used_up');
create type public.product_event_source as enum ('client', 'server', 'worker');
create type public.product_event_name as enum (
  'analysis_created',
  'analysis_completed',
  'analysis_cancelled',
  'analysis_failed',
  'analysis_reviewed',
  'analysis_applied',
  'recipe_suggestions_requested',
  'recipe_suggestions_returned',
  'recipe_opened',
  'invite_created',
  'cook_started',
  'cook_reconciled',
  'inventory_command_applied',
  'offline_sync_completed',
  'purge_completed'
);
create type public.api_rate_limit_action as enum (
  'analysis_create',
  'recipe_suggest',
  'invite_create',
  'inventory_command',
  'cook_reconcile'
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  avatar_url text,
  timezone text not null default 'UTC',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 0,
  constraint profiles_display_name_length check (display_name is null or char_length(display_name) between 1 and 80),
  constraint profiles_avatar_url_length check (avatar_url is null or char_length(avatar_url) <= 2048),
  constraint profiles_timezone_length check (char_length(timezone) between 1 and 80),
  constraint profiles_version_nonnegative check (version >= 0)
);

create table public.beta_invites (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  token_hash text not null unique,
  expires_at timestamptz not null,
  invited_by uuid references auth.users (id) on delete set null,
  claimed_by uuid unique references auth.users (id) on delete set null,
  claimed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 0,
  constraint beta_invites_email_normalized check (email = lower(btrim(email)) and char_length(email) between 3 and 320),
  constraint beta_invites_token_hash_sha256 check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint beta_invites_expiry_after_creation check (expires_at > created_at),
  constraint beta_invites_claim_pair check ((claimed_by is null) = (claimed_at is null)),
  constraint beta_invites_claim_not_revoked check (claimed_by is null or revoked_at is null),
  constraint beta_invites_version_nonnegative check (version >= 0)
);

create index beta_invites_email_pending_idx
  on public.beta_invites (email, expires_at)
  where claimed_by is null and revoked_at is null;

create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid not null references auth.users (id) on delete restrict,
  deletion_requested_at timestamptz,
  deletion_requested_by uuid references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 0,
  constraint households_name_length check (char_length(btrim(name)) between 1 and 80),
  constraint households_deletion_request_pair check (
    (deletion_requested_at is null) = (deletion_requested_by is null)
  ),
  constraint households_version_nonnegative check (version >= 0)
);

create index households_deletion_requested_idx
  on public.households (deletion_requested_at, id)
  where deletion_requested_at is not null;

create table public.household_members (
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.household_role not null default 'member',
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 0,
  primary key (household_id, user_id),
  constraint household_members_one_household_v1 unique (user_id),
  constraint household_members_version_nonnegative check (version >= 0)
);

create index household_members_household_role_idx
  on public.household_members (household_id, role);

-- Records the explicit, versioned first-scan disclosure acknowledgement. The
-- row deliberately contains no photo, prompt, model output, or other content.
-- It is immutable audit evidence, scoped to both the user and their household.
create table public.privacy_consents (
  user_id uuid not null,
  household_id uuid not null,
  consent_version text not null,
  consented_at timestamptz not null default now(),
  primary key (user_id, consent_version),
  constraint privacy_consents_membership_fk foreign key (household_id, user_id)
    references public.household_members (household_id, user_id) on delete cascade,
  constraint privacy_consents_tenant_identity unique (household_id, user_id, consent_version),
  constraint privacy_consents_version_length check (
    char_length(btrim(consent_version)) between 1 and 80
    and consent_version = btrim(consent_version)
  )
);

create index privacy_consents_household_user_idx
  on public.privacy_consents (household_id, user_id, consented_at desc);

-- Durable fixed-window counters. They are deliberately per user as well as
-- tenant so one member cannot consume another member's allowance. There are no
-- client table privileges or policies; the atomic RPC is the sole write path.
create table public.api_rate_limits (
  household_id uuid not null,
  user_id uuid not null,
  action public.api_rate_limit_action not null,
  window_seconds integer not null,
  window_started_at timestamptz not null,
  request_count bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 0,
  primary key (household_id, user_id, action, window_seconds, window_started_at),
  constraint api_rate_limits_membership_fk foreign key (household_id, user_id)
    references public.household_members (household_id, user_id) on delete cascade,
  constraint api_rate_limits_window_seconds check (window_seconds between 1 and 86400),
  constraint api_rate_limits_request_count check (request_count >= 1),
  constraint api_rate_limits_version_nonnegative check (version >= 0)
);

create index api_rate_limits_expiry_idx
  on public.api_rate_limits (window_started_at, window_seconds);

create table public.household_invites (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  email text not null,
  role public.household_role not null default 'member',
  token_hash text not null unique,
  status public.invite_status not null default 'pending',
  expires_at timestamptz not null,
  created_by uuid not null references auth.users (id) on delete restrict,
  accepted_by uuid references auth.users (id) on delete set null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 0,
  constraint household_invites_email_normalized check (email = lower(btrim(email)) and char_length(email) between 3 and 320),
  constraint household_invites_member_only_v1 check (role = 'member'),
  constraint household_invites_token_hash_sha256 check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint household_invites_expiry_after_creation check (expires_at > created_at),
  constraint household_invites_accept_pair check ((accepted_by is null) = (accepted_at is null)),
  constraint household_invites_state_shape check (
    (status = 'pending' and accepted_by is null and revoked_at is null)
    or (status = 'accepted' and accepted_by is not null and revoked_at is null)
    or (status = 'revoked' and accepted_by is null and revoked_at is not null)
    or (status = 'expired' and accepted_by is null and revoked_at is null)
  ),
  constraint household_invites_version_nonnegative check (version >= 0)
);

create unique index household_invites_one_pending_email_idx
  on public.household_invites (household_id, email)
  where status = 'pending';
create index household_invites_household_status_idx
  on public.household_invites (household_id, status, expires_at);

create table public.food_concepts (
  id text primary key,
  canonical_name text not null,
  category text not null default 'Other',
  default_unit text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 0,
  constraint food_concepts_id_format check (id ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' and char_length(id) <= 120),
  constraint food_concepts_name_length check (char_length(btrim(canonical_name)) between 1 and 120),
  constraint food_concepts_category_length check (char_length(btrim(category)) between 1 and 80),
  constraint food_concepts_unit_length check (default_unit is null or char_length(btrim(default_unit)) between 1 and 24),
  constraint food_concepts_version_nonnegative check (version >= 0)
);

create unique index food_concepts_canonical_name_idx
  on public.food_concepts (lower(btrim(canonical_name)));

create table public.food_aliases (
  id uuid primary key default gen_random_uuid(),
  scope public.food_alias_scope not null,
  household_id uuid references public.households (id) on delete cascade,
  food_concept_id text not null references public.food_concepts (id) on delete restrict,
  alias text not null,
  normalized_alias text generated always as (lower(btrim(alias))) stored,
  created_by uuid references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 0,
  constraint food_aliases_alias_length check (char_length(btrim(alias)) between 1 and 160),
  constraint food_aliases_scope_shape check (
    (scope = 'global' and household_id is null and created_by is null)
    or (scope = 'household' and household_id is not null and created_by is not null)
  ),
  constraint food_aliases_version_nonnegative check (version >= 0)
);

create unique index food_aliases_global_name_idx
  on public.food_aliases (normalized_alias)
  where scope = 'global';
create unique index food_aliases_household_name_idx
  on public.food_aliases (household_id, normalized_alias)
  where scope = 'household';
create index food_aliases_concept_idx on public.food_aliases (food_concept_id);

create table public.inventory_lots (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  food_concept_id text references public.food_concepts (id) on delete set null,
  name text not null,
  category text not null default 'Other',
  quantity_status public.quantity_status not null default 'unknown',
  quantity numeric(12, 3),
  unit text,
  form public.food_form not null default 'unspecified',
  location public.food_location not null default 'unknown',
  date_label_type public.date_label_type,
  date_label date,
  status public.inventory_lot_status not null default 'active',
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 0,
  constraint inventory_lots_tenant_identity unique (id, household_id),
  constraint inventory_lots_name_length check (char_length(btrim(name)) between 1 and 120),
  constraint inventory_lots_category_length check (char_length(btrim(category)) between 1 and 80),
  constraint inventory_lots_unit_length check (unit is null or char_length(btrim(unit)) between 1 and 24),
  constraint inventory_lots_quantity_shape check (
    (quantity_status = 'unknown' and quantity is null and unit is null)
    or (quantity_status in ('estimated', 'known') and quantity is not null and quantity > 0 and unit is not null)
  ),
  constraint inventory_lots_date_shape check ((date_label is null) = (date_label_type is null)),
  constraint inventory_lots_metadata_object check (jsonb_typeof(metadata) = 'object'),
  constraint inventory_lots_version_nonnegative check (version >= 0)
);

create index inventory_lots_household_active_idx
  on public.inventory_lots (household_id, updated_at desc, id)
  where status = 'active';
create index inventory_lots_household_concept_idx
  on public.inventory_lots (household_id, food_concept_id)
  where status = 'active';
create index inventory_lots_household_date_idx
  on public.inventory_lots (household_id, date_label)
  where status = 'active' and date_label is not null;

create table public.inventory_commands (
  id uuid primary key,
  household_id uuid not null references public.households (id) on delete cascade,
  idempotency_key uuid not null,
  command_type public.inventory_command_type not null,
  target_lot_id uuid not null,
  expected_version integer,
  payload jsonb not null,
  status public.inventory_command_status not null default 'applied',
  result jsonb not null,
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  applied_at timestamptz not null default now(),
  constraint inventory_commands_tenant_identity unique (id, household_id),
  constraint inventory_commands_idempotency unique (household_id, idempotency_key),
  constraint inventory_commands_lot_tenant_fk foreign key (target_lot_id, household_id)
    references public.inventory_lots (id, household_id) on delete restrict,
  constraint inventory_commands_payload_object check (jsonb_typeof(payload) = 'object'),
  constraint inventory_commands_result_object check (jsonb_typeof(result) = 'object'),
  constraint inventory_commands_expected_version check (expected_version is null or expected_version >= 0),
  constraint inventory_commands_version_shape check (
    (command_type = 'add' and expected_version is null)
    or (command_type <> 'add' and expected_version is not null)
  ),
  constraint inventory_commands_status_shape check (status = 'applied')
);

create index inventory_commands_household_created_idx
  on public.inventory_commands (household_id, created_at desc, id);

create table public.inventory_events (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  command_id uuid not null,
  lot_id uuid not null,
  event_type public.inventory_event_type not null,
  prior_version integer,
  new_version integer not null,
  quantity_before numeric(12, 3),
  quantity_after numeric(12, 3),
  lot_snapshot jsonb not null,
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint inventory_events_command_tenant_fk foreign key (command_id, household_id)
    references public.inventory_commands (id, household_id) on delete restrict,
  constraint inventory_events_lot_tenant_fk foreign key (lot_id, household_id)
    references public.inventory_lots (id, household_id) on delete restrict,
  constraint inventory_events_one_per_command unique (household_id, command_id),
  constraint inventory_events_versions check (
    new_version >= 0 and (prior_version is null or (prior_version >= 0 and new_version > prior_version))
  ),
  constraint inventory_events_snapshot_object check (jsonb_typeof(lot_snapshot) = 'object')
);

create index inventory_events_household_cursor_idx
  on public.inventory_events (household_id, created_at, id);

create table public.analyses (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  status public.analysis_status not null default 'created',
  image_count smallint not null,
  idempotency_key uuid,
  output_schema_version text not null default 'inventory-analysis.v1',
  provider text,
  model text,
  prompt_version text,
  error_code text,
  error_detail text,
  application_fingerprint text,
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  -- Incomplete upload reservations expire quickly. complete_analysis extends
  -- this to a 22-hour purge deadline, leaving scheduler/backlog margin under
  -- the product's 24-hour raw-photo deletion ceiling.
  purge_after timestamptz not null default (now() + interval '1 hour'),
  purge_claimed_at timestamptz,
  purge_claimed_by text,
  version integer not null default 0,
  constraint analyses_tenant_identity unique (id, household_id),
  constraint analyses_image_count check (image_count between 1 and 3),
  constraint analyses_schema_version_length check (char_length(output_schema_version) between 1 and 80),
  constraint analyses_provider_length check (provider is null or char_length(provider) <= 80),
  constraint analyses_model_length check (model is null or char_length(model) <= 120),
  constraint analyses_error_length check (error_code is null or char_length(error_code) <= 120),
  constraint analyses_error_detail_length check (error_detail is null or char_length(error_detail) <= 1000),
  constraint analyses_application_fingerprint check (
    (
      status = 'applied'
      and application_fingerprint is not null
      and application_fingerprint ~ '^[0-9a-f]{64}$'
    )
    or (status <> 'applied' and application_fingerprint is null)
  ),
  constraint analyses_purge_claim_shape check ((purge_claimed_at is null) = (purge_claimed_by is null)),
  constraint analyses_purge_worker_length check (purge_claimed_by is null or char_length(purge_claimed_by) between 1 and 160),
  constraint analyses_version_nonnegative check (version >= 0)
);

create unique index analyses_household_idempotency_idx
  on public.analyses (household_id, idempotency_key)
  where idempotency_key is not null;
create index analyses_household_status_idx
  on public.analyses (household_id, status, created_at desc);
create index analyses_raw_image_purge_idx
  on public.analyses (purge_after, id)
  where purge_claimed_at is null;

create table public.image_assets (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  analysis_id uuid not null,
  image_index smallint not null,
  bucket_id text not null default 'raw-images',
  object_path text not null unique,
  original_filename text not null,
  content_type text not null,
  byte_size integer not null,
  checksum_sha256 text,
  status public.image_asset_status not null default 'pending_upload',
  -- Supabase signed-upload authorizations are reusable until their fixed TTL.
  -- Keep a conservative issuance/clock-skew buffer so early purge attempts
  -- never tombstone a path that a still-valid token could recreate.
  upload_authorization_expires_at timestamptz not null
    default (now() + interval '2 hours 15 minutes'),
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 0,
  constraint image_assets_tenant_identity unique (id, household_id),
  constraint image_assets_analysis_tenant_fk foreign key (analysis_id, household_id)
    references public.analyses (id, household_id) on delete cascade,
  constraint image_assets_analysis_position unique (analysis_id, image_index),
  constraint image_assets_image_index check (image_index between 0 and 2),
  constraint image_assets_bucket check (bucket_id = 'raw-images'),
  constraint image_assets_filename_length check (char_length(original_filename) between 1 and 180),
  constraint image_assets_jpeg_only check (content_type = 'image/jpeg'),
  constraint image_assets_size check (byte_size between 1 and 5000000),
  constraint image_assets_checksum check (checksum_sha256 is null or checksum_sha256 ~ '^[0-9a-f]{64}$'),
  constraint image_assets_upload_authorization_after_creation check (
    upload_authorization_expires_at > created_at
  ),
  constraint image_assets_version_nonnegative check (version >= 0)
);

create index image_assets_household_analysis_idx
  on public.image_assets (household_id, analysis_id, image_index);
create index image_assets_purge_safety_idx
  on public.image_assets (status, upload_authorization_expires_at, id)
  where status = 'purge_pending';

create table public.analysis_candidates (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  analysis_id uuid not null,
  ordinal smallint not null,
  raw_label text not null,
  suggested_food_concept_id text references public.food_concepts (id) on delete set null,
  suggested_name text not null,
  category text not null default 'Other',
  quantity_status public.quantity_status not null default 'unknown',
  quantity numeric(12, 3),
  unit text,
  form public.food_form not null default 'unspecified',
  location public.food_location not null default 'unknown',
  date_label_type public.date_label_type,
  date_label date,
  image_indexes smallint[] not null,
  confidence numeric(4, 3),
  uncertainty_reason text,
  review_status public.analysis_candidate_status not null default 'proposed',
  accepted boolean generated always as (review_status = 'accepted') stored,
  applied_lot_id uuid,
  application_command_id uuid,
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 0,
  constraint analysis_candidates_analysis_tenant_fk foreign key (analysis_id, household_id)
    references public.analyses (id, household_id) on delete cascade,
  constraint analysis_candidates_lot_tenant_fk foreign key (applied_lot_id, household_id)
    references public.inventory_lots (id, household_id) on delete restrict,
  constraint analysis_candidates_command_tenant_fk foreign key (application_command_id, household_id)
    references public.inventory_commands (id, household_id) on delete restrict,
  constraint analysis_candidates_position unique (analysis_id, ordinal),
  constraint analysis_candidates_raw_label_length check (char_length(btrim(raw_label)) between 1 and 160),
  constraint analysis_candidates_name_length check (char_length(btrim(suggested_name)) between 1 and 120),
  constraint analysis_candidates_category_length check (char_length(btrim(category)) between 1 and 80),
  constraint analysis_candidates_unit_length check (unit is null or char_length(btrim(unit)) between 1 and 24),
  constraint analysis_candidates_quantity_shape check (
    (quantity_status = 'unknown' and quantity is null and unit is null)
    or (quantity_status in ('estimated', 'known') and quantity is not null and quantity > 0 and unit is not null)
  ),
  constraint analysis_candidates_date_shape check ((date_label is null) = (date_label_type is null)),
  constraint analysis_candidates_images check (
    cardinality(image_indexes) between 1 and 3
    and image_indexes <@ array[0, 1, 2]::smallint[]
  ),
  constraint analysis_candidates_confidence check (confidence is null or confidence between 0 and 1),
  constraint analysis_candidates_uncertainty_length check (uncertainty_reason is null or char_length(uncertainty_reason) <= 240),
  constraint analysis_candidates_review_shape check (
    (review_status = 'proposed' and applied_lot_id is null and application_command_id is null and reviewed_by is null and reviewed_at is null)
    or (review_status = 'accepted' and applied_lot_id is not null and application_command_id is not null and reviewed_by is not null and reviewed_at is not null)
    or (review_status = 'rejected' and applied_lot_id is null and application_command_id is null and reviewed_by is not null and reviewed_at is not null)
  ),
  constraint analysis_candidates_version_nonnegative check (version >= 0)
);

create index analysis_candidates_household_analysis_idx
  on public.analysis_candidates (household_id, analysis_id, ordinal);

create table public.recipes (
  id text primary key,
  household_id uuid references public.households (id) on delete cascade,
  visibility public.recipe_visibility not null,
  slug text not null,
  title text not null,
  description text not null,
  servings smallint not null,
  total_minutes smallint not null,
  meal_types text[] not null default '{}'::text[],
  cuisines text[] not null default '{}'::text[],
  dietary_tags text[] not null default '{}'::text[],
  steps text[] not null,
  rights_owner text not null,
  rights_author text not null,
  rights_reviewer text,
  rights_reviewed_at date,
  rights_status public.recipe_review_status not null default 'draft',
  created_by uuid references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 0,
  constraint recipes_id_length check (char_length(id) between 1 and 120),
  constraint recipes_scope_shape check (
    (visibility = 'published' and household_id is null and created_by is null)
    or (visibility = 'household' and household_id is not null and created_by is not null)
  ),
  constraint recipes_slug_format check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint recipes_title_length check (char_length(title) between 3 and 120),
  constraint recipes_description_length check (char_length(description) between 10 and 360),
  constraint recipes_servings check (servings between 1 and 24),
  constraint recipes_total_minutes check (total_minutes between 1 and 480),
  constraint recipes_steps check (cardinality(steps) >= 2),
  constraint recipes_rights_length check (
    char_length(rights_owner) between 1 and 160 and char_length(rights_author) between 1 and 160
  ),
  constraint recipes_review_shape check (
    (rights_status = 'draft' and rights_reviewed_at is null)
    or (rights_status = 'reviewed' and rights_reviewed_at is not null)
  ),
  constraint recipes_version_nonnegative check (version >= 0)
);

create unique index recipes_published_slug_idx on public.recipes (slug) where visibility = 'published';
create unique index recipes_household_slug_idx on public.recipes (household_id, slug) where visibility = 'household';
create index recipes_household_idx on public.recipes (household_id, updated_at desc) where household_id is not null;

create table public.recipe_ingredients (
  recipe_id text not null references public.recipes (id) on delete cascade,
  id text not null,
  household_id uuid references public.households (id) on delete cascade,
  position smallint not null,
  food_concept_id text not null references public.food_concepts (id) on delete restrict,
  name text not null,
  amount numeric(12, 3),
  unit text,
  display text not null,
  required boolean not null default true,
  accepted_forms public.food_form[] not null default '{}'::public.food_form[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 0,
  primary key (recipe_id, id),
  constraint recipe_ingredients_position unique (recipe_id, position),
  constraint recipe_ingredients_id_length check (char_length(id) between 1 and 120),
  constraint recipe_ingredients_position_positive check (position >= 0),
  constraint recipe_ingredients_name_length check (char_length(name) between 1 and 160),
  constraint recipe_ingredients_amount check (amount is null or amount > 0),
  constraint recipe_ingredients_unit_length check (unit is null or char_length(unit) <= 40),
  constraint recipe_ingredients_display_length check (char_length(display) between 1 and 240),
  constraint recipe_ingredients_forms check (cardinality(accepted_forms) >= 1),
  constraint recipe_ingredients_version_nonnegative check (version >= 0)
);

create index recipe_ingredients_concept_idx on public.recipe_ingredients (food_concept_id);
create index recipe_ingredients_household_idx on public.recipe_ingredients (household_id, recipe_id);

create table public.household_preferences (
  household_id uuid primary key references public.households (id) on delete cascade,
  staples text[] not null default '{}'::text[],
  dietary_tags text[] not null default '{}'::text[],
  excluded_food_concept_ids text[] not null default '{}'::text[],
  updated_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 0,
  constraint household_preferences_version_nonnegative check (version >= 0)
);

create table public.cook_sessions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  recipe_id text references public.recipes (id) on delete set null,
  recipe_snapshot jsonb not null,
  servings smallint not null,
  status public.cook_session_status not null default 'active',
  started_by uuid not null references auth.users (id) on delete restrict,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  reconciliation_fingerprint text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 0,
  constraint cook_sessions_tenant_identity unique (id, household_id),
  constraint cook_sessions_snapshot_object check (jsonb_typeof(recipe_snapshot) = 'object'),
  constraint cook_sessions_servings check (servings between 1 and 24),
  constraint cook_sessions_status_shape check (
    (status = 'active' and completed_at is null)
    or (status in ('reconciled', 'cancelled') and completed_at is not null)
  ),
  constraint cook_sessions_reconciliation_shape check (
    (
      status = 'reconciled'
      and reconciliation_fingerprint is not null
      and reconciliation_fingerprint ~ '^[0-9a-f]{64}$'
    )
    or (status <> 'reconciled' and reconciliation_fingerprint is null)
  ),
  constraint cook_sessions_version_nonnegative check (version >= 0)
);

create index cook_sessions_household_status_idx
  on public.cook_sessions (household_id, status, started_at desc);

create table public.cook_reconciliations (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  cook_session_id uuid not null,
  ingredient_id text not null,
  lot_id uuid not null,
  action public.cook_reconciliation_action not null,
  quantity numeric(12, 3),
  unit text,
  expected_version integer not null,
  applied_command_id uuid,
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint cook_reconciliations_session_tenant_fk foreign key (cook_session_id, household_id)
    references public.cook_sessions (id, household_id) on delete cascade,
  constraint cook_reconciliations_lot_tenant_fk foreign key (lot_id, household_id)
    references public.inventory_lots (id, household_id) on delete restrict,
  constraint cook_reconciliations_command_tenant_fk foreign key (applied_command_id, household_id)
    references public.inventory_commands (id, household_id) on delete restrict,
  constraint cook_reconciliations_once unique (cook_session_id, ingredient_id, lot_id),
  constraint cook_reconciliations_ingredient_length check (char_length(ingredient_id) between 1 and 120),
  constraint cook_reconciliations_quantity check (quantity is null or quantity > 0),
  constraint cook_reconciliations_unit_length check (unit is null or char_length(unit) <= 24),
  constraint cook_reconciliations_expected_version check (expected_version >= 0),
  constraint cook_reconciliations_action_shape check (
    (action in ('no_change', 'used_up') and quantity is null)
    or (action = 'used_some' and quantity is not null)
  )
);

create index cook_reconciliations_household_session_idx
  on public.cook_reconciliations (household_id, cook_session_id);

create function private.valid_product_event_properties(candidate jsonb)
returns boolean
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  property record;
  numeric_value numeric;
begin
  if jsonb_typeof(candidate) <> 'object' or jsonb_object_length(candidate) > 20 then
    return false;
  end if;
  for property in select key, value from jsonb_each(candidate)
  loop
    if property.key in (
      'durationMs', 'itemCount', 'imageCount', 'acceptedCount',
      'rejectedCount', 'conflictCount', 'retryCount', 'candidateCount',
      'correctionCount', 'attemptCount', 'assessmentCount', 'readyCount',
      'likelyReadyCount', 'almostReadyCount', 'ingredientCount',
      'changeCount', 'deletedCount'
    ) then
      if jsonb_typeof(property.value) <> 'number' then return false; end if;
      numeric_value := (property.value #>> '{}')::numeric;
      if numeric_value <> trunc(numeric_value) or numeric_value < 0 then return false; end if;
      if property.key = 'durationMs' and numeric_value > 86400000 then return false; end if;
      if property.key <> 'durationMs' and numeric_value > 10000 then return false; end if;
    elsif property.key in ('replayed', 'offline') then
      if jsonb_typeof(property.value) <> 'boolean' then return false; end if;
    elsif property.key = 'outcome' then
      if jsonb_typeof(property.value) <> 'string'
        or (property.value #>> '{}') not in ('success', 'failure', 'cancelled', 'conflict')
      then return false; end if;
    elsif property.key = 'correctionAction' then
      if jsonb_typeof(property.value) <> 'string'
        or (property.value #>> '{}') not in ('accept', 'edit', 'reject')
      then return false; end if;
    elsif property.key = 'trigger' then
      if jsonb_typeof(property.value) <> 'string'
        or (property.value #>> '{}') not in ('user', 'background', 'retry')
      then return false; end if;
    elsif property.key = 'readinessTier' then
      if jsonb_typeof(property.value) <> 'string'
        or (property.value #>> '{}') not in ('ready', 'likely_ready', 'almost_ready', 'incompatible')
      then return false; end if;
    else
      return false;
    end if;
  end loop;
  return true;
exception
  when others then return false;
end;
$$;

revoke all on function private.valid_product_event_properties(jsonb)
  from public, anon, authenticated;
grant execute on function private.valid_product_event_properties(jsonb)
  to service_role;

create table public.product_events (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete restrict,
  event_name public.product_event_name not null,
  source public.product_event_source not null default 'client',
  properties jsonb not null default '{}'::jsonb,
  client_session_id text,
  idempotency_key text,
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  constraint product_events_properties_object check (jsonb_typeof(properties) = 'object'),
  constraint product_events_properties_privacy_safe check (
    private.valid_product_event_properties(properties)
  ),
  constraint product_events_session_operational_id check (
    client_session_id is null
    or client_session_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  constraint product_events_idempotency_operational_id check (
    idempotency_key is null
    or idempotency_key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or idempotency_key ~ '^(analysis-(created|completed|applied|failed)|cook-(started|reconciled)|invite-created|inventory-command):[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or idempotency_key ~ '^purge-completed:retained:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  )
);

create unique index product_events_household_idempotency_idx
  on public.product_events (household_id, user_id, idempotency_key)
  where idempotency_key is not null;
create index product_events_household_time_idx
  on public.product_events (household_id, occurred_at desc, id);

comment on table public.inventory_events is
  'Append-only inventory journal. UPDATE and DELETE are rejected by trigger, including privileged accidental writes.';
comment on column public.image_assets.object_path is
  'Canonical private path: <household_uuid>/<uploader_uuid>/<analysis_uuid>/<asset_uuid>.jpg. Never contains the original filename.';
comment on table public.household_members is
  'V1 enforces one membership per auth user. Tenant policy helpers derive the household exclusively from this table.';
comment on table public.inventory_commands is
  'Successful commands are immutable idempotency records. Clients supply a command UUID, never an authoritative household UUID.';

-- Generic optimistic versioning. Application writes do not set updated_at or
-- version; every update advances them together inside the database.
create function private.touch_versioned_row()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := clock_timestamp();
  new.version := old.version + 1;
  return new;
end;
$$;

revoke all on function private.touch_versioned_row() from public;

create trigger profiles_touch before update on public.profiles
  for each row execute function private.touch_versioned_row();
create trigger beta_invites_touch before update on public.beta_invites
  for each row execute function private.touch_versioned_row();
create trigger households_touch before update on public.households
  for each row execute function private.touch_versioned_row();
create trigger household_members_touch before update on public.household_members
  for each row execute function private.touch_versioned_row();
create trigger api_rate_limits_touch before update on public.api_rate_limits
  for each row execute function private.touch_versioned_row();
create trigger household_invites_touch before update on public.household_invites
  for each row execute function private.touch_versioned_row();
create trigger food_concepts_touch before update on public.food_concepts
  for each row execute function private.touch_versioned_row();
create trigger food_aliases_touch before update on public.food_aliases
  for each row execute function private.touch_versioned_row();
create trigger inventory_lots_touch before update on public.inventory_lots
  for each row execute function private.touch_versioned_row();
create trigger analyses_touch before update on public.analyses
  for each row execute function private.touch_versioned_row();
create trigger image_assets_touch before update on public.image_assets
  for each row execute function private.touch_versioned_row();
create trigger analysis_candidates_touch before update on public.analysis_candidates
  for each row execute function private.touch_versioned_row();
create trigger recipes_touch before update on public.recipes
  for each row execute function private.touch_versioned_row();
create trigger recipe_ingredients_touch before update on public.recipe_ingredients
  for each row execute function private.touch_versioned_row();
create trigger household_preferences_touch before update on public.household_preferences
  for each row execute function private.touch_versioned_row();
create trigger cook_sessions_touch before update on public.cook_sessions
  for each row execute function private.touch_versioned_row();

-- Object keys are generated from identifiers, not user filenames. This makes
-- authorization inspectable and prevents path traversal or tenant spoofing.
create function private.enforce_image_asset_path()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  expected_path text;
begin
  expected_path := new.household_id::text || '/' || new.created_by::text || '/' ||
    new.analysis_id::text || '/' || new.id::text || '.jpg';
  if new.object_path is distinct from expected_path then
    raise exception using
      errcode = '22023',
      message = 'image asset object_path does not match the canonical tenant path';
  end if;
  return new;
end;
$$;

revoke all on function private.enforce_image_asset_path() from public;
create trigger image_assets_enforce_path
  before insert or update of id, household_id, analysis_id, created_by, object_path
  on public.image_assets
  for each row execute function private.enforce_image_asset_path();

create function private.enforce_recipe_ingredient_scope()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  recipe_household_id uuid;
begin
  select r.household_id
    into recipe_household_id
    from public.recipes as r
   where r.id = new.recipe_id;

  if not found then
    raise foreign_key_violation using message = 'recipe does not exist';
  end if;
  if new.household_id is distinct from recipe_household_id then
    raise exception using
      errcode = '23514',
      message = 'recipe ingredient household_id must match its recipe';
  end if;
  return new;
end;
$$;

revoke all on function private.enforce_recipe_ingredient_scope() from public;
create trigger recipe_ingredients_enforce_scope
  before insert or update of recipe_id, household_id
  on public.recipe_ingredients
  for each row execute function private.enforce_recipe_ingredient_scope();

create function private.enforce_cook_session_recipe_scope()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.recipe_id is not null and not exists (
    select 1
      from public.recipes as r
     where r.id = new.recipe_id
       and (r.visibility = 'published' or r.household_id = new.household_id)
  ) then
    raise exception using
      errcode = '23514',
      message = 'cook session recipe is not visible to its household';
  end if;
  return new;
end;
$$;

revoke all on function private.enforce_cook_session_recipe_scope() from public;
create trigger cook_sessions_enforce_recipe_scope
  before insert or update of recipe_id, household_id
  on public.cook_sessions
  for each row execute function private.enforce_cook_session_recipe_scope();

create function private.reject_append_only_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- The sole exception is the service-only household erasure finalizer. Its
  -- transaction-local marker is scoped to one household and cannot be reached
  -- by an authenticated RPC. This preserves append-only history during normal
  -- operation without making statutory account erasure impossible.
  if tg_op = 'DELETE'
    and current_setting('foodtopia.erasing_household', true) = old.household_id::text
  then
    return old;
  end if;
  if tg_op = 'DELETE'
    and tg_table_schema = 'public'
    and tg_table_name = 'privacy_consents'
    and current_setting('foodtopia.removing_member_household', true) = old.household_id::text
    and current_setting('foodtopia.removing_member_user', true) = old.user_id::text
  then
    return old;
  end if;
  raise exception using
    errcode = '55000',
    message = tg_table_schema || '.' || tg_table_name || ' is append-only';
end;
$$;

revoke all on function private.reject_append_only_mutation() from public;
create trigger inventory_events_immutable
  before update or delete on public.inventory_events
  for each row execute function private.reject_append_only_mutation();
create trigger cook_reconciliations_immutable
  before update or delete on public.cook_reconciliations
  for each row execute function private.reject_append_only_mutation();
create trigger product_events_immutable
  before update or delete on public.product_events
  for each row execute function private.reject_append_only_mutation();
create trigger privacy_consents_immutable
  before update or delete on public.privacy_consents
  for each row execute function private.reject_append_only_mutation();

create function private.protect_inventory_command()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE'
    and current_setting('foodtopia.erasing_household', true) = old.household_id::text
  then
    return old;
  end if;
  raise exception using errcode = '55000', message = 'inventory commands are immutable';
end;
$$;

revoke all on function private.protect_inventory_command() from public;
create trigger inventory_commands_protect
  before update or delete on public.inventory_commands
  for each row execute function private.protect_inventory_command();

-- A household may have multiple owners, but must retain at least one. The
-- deferred check permits an ownership transfer inside one transaction.
create function private.require_household_owner()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  target_household_id uuid;
begin
  target_household_id := old.household_id;
  if exists (select 1 from public.households as h where h.id = target_household_id)
    and not exists (
      select 1
        from public.household_members as hm
       where hm.household_id = target_household_id
         and hm.role = 'owner'
    )
  then
    raise exception using errcode = '23514', message = 'a household must retain at least one owner';
  end if;

  if tg_op = 'UPDATE' and new.household_id is distinct from old.household_id then
    target_household_id := new.household_id;
    if exists (select 1 from public.households as h where h.id = target_household_id)
      and not exists (
        select 1
          from public.household_members as hm
         where hm.household_id = target_household_id
           and hm.role = 'owner'
      )
    then
      raise exception using errcode = '23514', message = 'a household must retain at least one owner';
    end if;
  end if;
  return null;
end;
$$;

revoke all on function private.require_household_owner() from public;
create constraint trigger household_members_require_owner
  after update or delete on public.household_members
  deferrable initially deferred
  for each row execute function private.require_household_owner();

create function private.require_new_household_owner()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from public.households as h where h.id = new.id)
    and not exists (
    select 1
      from public.household_members as hm
     where hm.household_id = new.id
       and hm.role = 'owner'
  ) then
    raise exception using errcode = '23514', message = 'a new household must have an owner';
  end if;
  return null;
end;
$$;

revoke all on function private.require_new_household_owner() from public;
create constraint trigger households_require_owner
  after insert on public.households
  deferrable initially deferred
  for each row execute function private.require_new_household_owner();

-- Authentication profile bootstrap. Auth metadata is untrusted display data;
-- it is length-limited and never used for authorization.
create function private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  candidate_name text;
begin
  candidate_name := nullif(btrim(coalesce(
    new.raw_user_meta_data ->> 'display_name',
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'name',
    ''
  )), '');

  insert into public.profiles (id, display_name)
  values (new.id, case when candidate_name is null then null else left(candidate_name, 80) end)
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke all on function private.handle_new_auth_user() from public;
create trigger auth_users_create_profile
  after insert on auth.users
  for each row execute function private.handle_new_auth_user();

-- Supabase Auth Before User Created hook. Enable this database hook in the
-- Supabase Dashboard with URI:
--   pg-functions://postgres/public/before_user_created
-- The hook must be enabled for invite-only signup enforcement; RLS on public
-- tables cannot prevent auth.users creation. OTP login for an already-created
-- user remains unaffected, while a first-time OTP signup succeeds only for a
-- live beta or household invitation email.
create function public.before_user_created(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  candidate_email text := lower(nullif(btrim(event -> 'user' ->> 'email'), ''));
begin
  if candidate_email is not null and (
    exists (
      select 1
        from public.beta_invites as bi
       where bi.email = candidate_email
         and bi.revoked_at is null
         and bi.claimed_by is null
         and bi.expires_at > now()
    )
    or exists (
      select 1
        from public.household_invites as hi
       where hi.email = candidate_email
         and hi.status = 'pending'
         and hi.expires_at > now()
    )
  ) then
    return '{}'::jsonb;
  end if;

  return jsonb_build_object(
    'error',
    jsonb_build_object(
      'http_code', 403,
      'message', 'A valid Foodtopia invitation is required.'
    )
  );
end;
$$;

revoke all on function public.before_user_created(jsonb) from public, anon, authenticated;
grant execute on function public.before_user_created(jsonb) to supabase_auth_admin;

comment on function public.before_user_created(jsonb) is
  'Configure as Auth Before User Created hook (pg-functions://postgres/public/before_user_created). Allows only active normalized beta/household invite emails.';

insert into public.profiles (id, display_name)
select
  u.id,
  case
    when nullif(btrim(coalesce(
      u.raw_user_meta_data ->> 'display_name',
      u.raw_user_meta_data ->> 'full_name',
      u.raw_user_meta_data ->> 'name',
      ''
    )), '') is null then null
    else left(btrim(coalesce(
      u.raw_user_meta_data ->> 'display_name',
      u.raw_user_meta_data ->> 'full_name',
      u.raw_user_meta_data ->> 'name'
    )), 80)
  end
from auth.users as u
on conflict (id) do nothing;

-- These SECURITY DEFINER helpers are deliberately tiny and return only an
-- authorization decision. The table owner bypasses household_members RLS,
-- avoiding policy recursion; callers cannot choose the auth UID.
create function private.current_household_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select hm.household_id
    from public.household_members as hm
    join public.households as h on h.id = hm.household_id
   where hm.user_id = (select auth.uid())
     and h.deletion_requested_at is null
$$;

create function private.is_household_member(target_household_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select target_household_id is not null
    and target_household_id = private.current_household_id()
$$;

create function private.has_household_role(
  target_household_id uuid,
  allowed_roles public.household_role[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.household_members as hm
     where hm.household_id = target_household_id
       and hm.household_id = private.current_household_id()
       and hm.user_id = (select auth.uid())
       and hm.role = any(allowed_roles)
  )
$$;

revoke all on function private.current_household_id() from public, anon, authenticated;
revoke all on function private.is_household_member(uuid) from public, anon, authenticated;
revoke all on function private.has_household_role(uuid, public.household_role[]) from public, anon, authenticated;
grant execute on function private.current_household_id() to authenticated;
grant execute on function private.is_household_member(uuid) to authenticated;
grant execute on function private.has_household_role(uuid, public.household_role[]) to authenticated;

comment on function private.current_household_id() is
  'Returns the sole active V1 household for auth.uid(); deletion-pending households are quarantined and no caller-provided identifier is accepted.';

create function public.record_privacy_consent(p_consent_version text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_household_id uuid := private.current_household_id();
  recorded_at timestamptz;
  inserted_count integer;
begin
  if actor_id is null or actor_household_id is null then
    raise exception using errcode = '28000', message = 'active household session required';
  end if;
  if p_consent_version is distinct from 'vision-v1' then
    raise exception using errcode = '22023', message = 'unsupported privacy consent version';
  end if;

  insert into public.privacy_consents (
    user_id,
    household_id,
    consent_version
  ) values (
    actor_id,
    actor_household_id,
    p_consent_version
  )
  on conflict (user_id, consent_version) do nothing
  returning consented_at into recorded_at;
  get diagnostics inserted_count = row_count;

  if inserted_count = 0 then
    select pc.consented_at
      into recorded_at
      from public.privacy_consents as pc
     where pc.user_id = actor_id
       and pc.household_id = actor_household_id
       and pc.consent_version = p_consent_version;
    if not found then
      raise exception using errcode = '23505', message = 'privacy consent version is already scoped elsewhere';
    end if;
  end if;

  return jsonb_build_object(
    'consentVersion', p_consent_version,
    'consentedAt', recorded_at,
    'replayed', inserted_count = 0
  );
end;
$$;

revoke all on function public.record_privacy_consent(text) from public, anon, authenticated;
grant execute on function public.record_privacy_consent(text) to authenticated;

comment on function public.record_privacy_consent(text) is
  'Idempotently records the current user first-scan disclosure version for their active household; stores no image, prompt, or model data.';

create function public.consume_rate_limit(
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
  if p_action not in (
    'analysis_create',
    'recipe_suggest',
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
    household_id,
    user_id,
    action,
    window_seconds,
    window_started_at,
    request_count
  ) values (
    actor_household_id,
    actor_id,
    action_value,
    p_window_seconds,
    window_start,
    1
  )
  on conflict (household_id, user_id, action, window_seconds, window_started_at)
  do update
     set request_count = public.api_rate_limits.request_count + 1
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

comment on function public.consume_rate_limit(text, integer, integer) is
  'Atomically consumes one fixed-window allowance for an allowlisted action keyed by auth.uid() and its active household; no tenant identifier is accepted.';

create function public.record_product_event(
  p_event_name text,
  p_properties jsonb default '{}'::jsonb,
  p_client_session_id uuid default null,
  p_idempotency_key uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_household_id uuid := private.current_household_id();
  event_value public.product_event_name;
  property record;
  numeric_value numeric;
  inserted_count integer;
  event_id uuid;
  existing_event public.product_events%rowtype;
begin
  if actor_id is null or actor_household_id is null then
    raise exception using errcode = '28000', message = 'active household session required';
  end if;
  if p_event_name not in (
    'analysis_created', 'analysis_completed', 'analysis_cancelled',
    'analysis_failed', 'analysis_reviewed', 'analysis_applied',
    'recipe_suggestions_requested', 'recipe_suggestions_returned',
    'recipe_opened', 'invite_created', 'cook_started', 'cook_reconciled',
    'inventory_command_applied', 'offline_sync_completed', 'purge_completed'
  ) then
    raise exception using errcode = '22023', message = 'unsupported product event';
  end if;
  if p_properties is null or jsonb_typeof(p_properties) <> 'object' then
    raise exception using errcode = '22023', message = 'event properties must be a JSON object';
  end if;
  if jsonb_object_length(p_properties) > 12 then
    raise exception using errcode = '22023', message = 'too many event properties';
  end if;

  -- This is a closed vocabulary. Text is accepted only for short enums; user
  -- content and identifiers must never be tunneled through properties.
  for property in select key, value from jsonb_each(p_properties)
  loop
    if property.key in (
      'durationMs', 'itemCount', 'imageCount', 'acceptedCount',
      'rejectedCount', 'conflictCount', 'retryCount', 'candidateCount',
      'correctionCount', 'attemptCount', 'assessmentCount', 'readyCount',
      'likelyReadyCount', 'almostReadyCount', 'ingredientCount',
      'changeCount', 'deletedCount'
    ) then
      if jsonb_typeof(property.value) <> 'number' then
        raise exception using errcode = '22023', message = property.key || ' must be numeric';
      end if;
      numeric_value := (property.value #>> '{}')::numeric;
      if numeric_value <> trunc(numeric_value)
        or numeric_value < 0
        or numeric_value > 86400000
      then
        raise exception using errcode = '22023', message = property.key || ' is outside its allowed integer range';
      end if;
    elsif property.key in ('replayed', 'offline') then
      if jsonb_typeof(property.value) <> 'boolean' then
        raise exception using errcode = '22023', message = property.key || ' must be boolean';
      end if;
    elsif property.key = 'outcome' then
      if jsonb_typeof(property.value) <> 'string'
        or (property.value #>> '{}') not in ('success', 'failure', 'cancelled', 'conflict')
      then
        raise exception using errcode = '22023', message = 'outcome is not allowlisted';
      end if;
    elsif property.key = 'correctionAction' then
      if jsonb_typeof(property.value) <> 'string'
        or (property.value #>> '{}') not in ('accept', 'edit', 'reject')
      then
        raise exception using errcode = '22023', message = 'correctionAction is not allowlisted';
      end if;
    elsif property.key = 'trigger' then
      if jsonb_typeof(property.value) <> 'string'
        or (property.value #>> '{}') not in ('user', 'background', 'retry')
      then
        raise exception using errcode = '22023', message = 'trigger is not allowlisted';
      end if;
    elsif property.key = 'readinessTier' then
      if jsonb_typeof(property.value) <> 'string'
        or (property.value #>> '{}') not in ('ready', 'likely_ready', 'almost_ready', 'incompatible')
      then
        raise exception using errcode = '22023', message = 'readinessTier is not allowlisted';
      end if;
    else
      raise exception using errcode = '22023', message = 'event property is not allowlisted: ' || property.key;
    end if;
  end loop;

  event_value := p_event_name::public.product_event_name;
  insert into public.product_events (
    household_id,
    user_id,
    event_name,
    source,
    properties,
    client_session_id,
    idempotency_key,
    occurred_at
  ) values (
    actor_household_id,
    actor_id,
    event_value,
    'client',
    p_properties,
    p_client_session_id::text,
    p_idempotency_key::text,
    now()
  )
  on conflict (household_id, user_id, idempotency_key)
    where idempotency_key is not null
  do nothing
  returning id into event_id;
  get diagnostics inserted_count = row_count;

  if inserted_count = 0 then
    select pe.*
      into existing_event
      from public.product_events as pe
     where pe.household_id = actor_household_id
       and pe.user_id = actor_id
       and pe.idempotency_key = p_idempotency_key::text;
    if not found
      or existing_event.event_name <> event_value
      or existing_event.properties <> p_properties
      or existing_event.client_session_id is distinct from p_client_session_id::text
    then
      raise exception using errcode = '23505', message = 'product event idempotency key reused with different semantics';
    end if;
    event_id := existing_event.id;
  end if;

  return jsonb_build_object('eventId', event_id, 'replayed', inserted_count = 0);
end;
$$;

revoke all on function public.record_product_event(text, jsonb, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.record_product_event(text, jsonb, uuid, uuid)
  to authenticated;

comment on function public.record_product_event(text, jsonb, uuid, uuid) is
  'Append-only privacy boundary for product telemetry: allowlisted event names and numeric, boolean, or closed-enum properties only; tenant/user are derived from auth.';

create function public.bootstrap_household(p_name text, p_beta_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_email text := lower(nullif(btrim(auth.jwt() ->> 'email'), ''));
  invite public.beta_invites%rowtype;
  existing_household_id uuid;
  new_household_id uuid;
begin
  if actor_id is null or actor_email is null then
    raise exception using errcode = '28000', message = 'authenticated user with a verified email required';
  end if;
  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 80 then
    raise exception using errcode = '22023', message = 'household name must be between 1 and 80 characters';
  end if;
  if char_length(coalesce(p_beta_token, '')) not between 20 and 512 then
    raise exception using errcode = '22023', message = 'invalid beta invitation token';
  end if;

  select bi.*
    into invite
    from public.beta_invites as bi
   where bi.token_hash = encode(extensions.digest(p_beta_token, 'sha256'), 'hex')
     and bi.email = actor_email
   for update;

  if not found or invite.revoked_at is not null or invite.expires_at <= now() then
    raise exception using errcode = '28000', message = 'beta invitation is invalid or expired';
  end if;
  if invite.claimed_by is not null and invite.claimed_by <> actor_id then
    raise exception using errcode = '28000', message = 'beta invitation has already been claimed';
  end if;

  select hm.household_id
    into existing_household_id
    from public.household_members as hm
   where hm.user_id = actor_id;
  if found then
    if invite.claimed_by = actor_id then
      return existing_household_id;
    end if;
    raise exception using errcode = '23505', message = 'V1 supports one household per user';
  end if;

  update public.beta_invites
     set claimed_by = actor_id,
         claimed_at = coalesce(claimed_at, now())
   where id = invite.id;

  insert into public.households (name, created_by)
  values (btrim(p_name), actor_id)
  returning id into new_household_id;

  insert into public.household_members (household_id, user_id, role)
  values (new_household_id, actor_id, 'owner');

  insert into public.household_preferences (household_id, staples, updated_by)
  values (
    new_household_id,
    array['water', 'salt', 'black-pepper', 'vegetable-oil']::text[],
    actor_id
  );

  return new_household_id;
end;
$$;

create function public.create_household_invite(
  p_email text,
  p_token text,
  p_expires_at timestamptz default (now() + interval '7 days')
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_household_id uuid := private.current_household_id();
  normalized_email text := lower(btrim(coalesce(p_email, '')));
  new_invite_id uuid;
begin
  if actor_id is null or actor_household_id is null then
    raise exception using errcode = '42501', message = 'active household member required';
  end if;
  if char_length(normalized_email) not between 3 and 320 or position('@' in normalized_email) < 2 then
    raise exception using errcode = '22023', message = 'invalid invitation email';
  end if;
  if char_length(coalesce(p_token, '')) not between 20 and 512 then
    raise exception using errcode = '22023', message = 'invitation token must contain at least 20 characters';
  end if;
  if p_expires_at <= now() or p_expires_at > now() + interval '30 days' then
    raise exception using errcode = '22023', message = 'invitation expiry must be within 30 days';
  end if;

  update public.household_invites
     set status = 'expired'
   where household_id = actor_household_id
     and email = normalized_email
     and status = 'pending'
     and expires_at <= now();

  insert into public.household_invites (
    household_id, email, token_hash, expires_at, created_by
  ) values (
    actor_household_id,
    normalized_email,
    encode(extensions.digest(p_token, 'sha256'), 'hex'),
    p_expires_at,
    actor_id
  )
  returning id into new_invite_id;
  return new_invite_id;
end;
$$;

create function public.accept_household_invite(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_email text := lower(nullif(btrim(auth.jwt() ->> 'email'), ''));
  invite public.household_invites%rowtype;
  existing_household_id uuid;
begin
  if actor_id is null or actor_email is null then
    raise exception using errcode = '28000', message = 'authenticated user with a verified email required';
  end if;
  if char_length(coalesce(p_token, '')) not between 20 and 512 then
    raise exception using errcode = '22023', message = 'invalid household invitation token';
  end if;

  select hi.*
    into invite
    from public.household_invites as hi
   where hi.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
     and hi.email = actor_email
   for update;

  if not found then
    raise exception using errcode = '28000', message = 'household invitation is invalid';
  end if;
  if invite.status = 'accepted' and invite.accepted_by = actor_id then
    return invite.household_id;
  end if;
  if invite.status <> 'pending' or invite.expires_at <= now() then
    raise exception using errcode = '28000', message = 'household invitation is no longer active';
  end if;

  select hm.household_id
    into existing_household_id
    from public.household_members as hm
   where hm.user_id = actor_id;
  if found and existing_household_id <> invite.household_id then
    raise exception using errcode = '23505', message = 'V1 supports one household per user';
  end if;

  insert into public.household_members (household_id, user_id, role, invited_by)
  values (invite.household_id, actor_id, invite.role, invite.created_by)
  on conflict (household_id, user_id) do nothing;

  update public.household_invites
     set status = 'accepted',
         accepted_by = actor_id,
         accepted_at = now()
   where id = invite.id;

  return invite.household_id;
end;
$$;

create function public.revoke_household_invite(p_invite_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_household_id uuid := private.current_household_id();
begin
  if auth.uid() is null or actor_household_id is null then
    raise exception using errcode = '42501', message = 'active household member required';
  end if;

  update public.household_invites
     set status = 'revoked', revoked_at = now()
   where id = p_invite_id
     and household_id = actor_household_id
     and status = 'pending';

  if not found then
    raise exception using errcode = 'P0002', message = 'active household invitation not found';
  end if;
end;
$$;

create function public.list_household_invites()
returns table (
  id uuid,
  email text,
  role public.household_role,
  status public.invite_status,
  expires_at timestamptz,
  created_at timestamptz,
  accepted_at timestamptz,
  revoked_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_household_id uuid := private.current_household_id();
begin
  if auth.uid() is null or actor_household_id is null then
    raise exception using errcode = '42501', message = 'active household member required';
  end if;

  return query
  select hi.id, hi.email, hi.role, hi.status, hi.expires_at, hi.created_at, hi.accepted_at, hi.revoked_at
    from public.household_invites as hi
   where hi.household_id = actor_household_id
   order by hi.created_at desc, hi.id;
end;
$$;

create function public.list_household_members()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_household_id uuid := private.current_household_id();
  member_rows jsonb;
begin
  if auth.uid() is null or actor_household_id is null then
    raise exception using errcode = '28000', message = 'active household session required';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'userId', hm.user_id,
        'displayName', p.display_name,
        'role', hm.role,
        'joinedAt', hm.created_at
      ) order by hm.created_at, hm.user_id
    ),
    '[]'::jsonb
  ) into member_rows
    from public.household_members as hm
    left join public.profiles as p on p.id = hm.user_id
   where hm.household_id = actor_household_id;

  return jsonb_build_object('members', member_rows);
end;
$$;

create function public.remove_household_member(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_household_id uuid := private.current_household_id();
  target_role public.household_role;
  owner_count integer;
begin
  if actor_id is null
    or actor_household_id is null
    or not private.has_household_role(
      actor_household_id,
      array['owner']::public.household_role[]
    )
  then
    raise exception using errcode = '42501', message = 'active household owner required';
  end if;
  if p_user_id is null then
    raise exception using errcode = '22023', message = 'member user id is required';
  end if;
  if p_user_id = actor_id then
    raise exception using errcode = '22023', message = 'owners cannot remove themselves';
  end if;

  -- Serialize membership removals and ownership checks within the household.
  perform hm.user_id
    from public.household_members as hm
   where hm.household_id = actor_household_id
   for update;

  select hm.role
    into target_role
    from public.household_members as hm
   where hm.household_id = actor_household_id
     and hm.user_id = p_user_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'household member not found';
  end if;

  if target_role = 'owner' then
    select count(*)::integer
      into owner_count
      from public.household_members as hm
     where hm.household_id = actor_household_id
       and hm.role = 'owner';
    if owner_count <= 1 then
      raise exception using errcode = '23514', message = 'the sole household owner cannot be removed';
    end if;
  end if;

  perform set_config('foodtopia.removing_member_household', actor_household_id::text, true);
  perform set_config('foodtopia.removing_member_user', p_user_id::text, true);
  delete from public.household_members as hm
   where hm.household_id = actor_household_id
     and hm.user_id = p_user_id;

  return jsonb_build_object(
    'userId', p_user_id,
    'removed', true,
    'role', target_role
  );
end;
$$;

revoke all on function public.bootstrap_household(text, text) from public, anon, authenticated;
revoke all on function public.create_household_invite(text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.accept_household_invite(text) from public, anon, authenticated;
revoke all on function public.revoke_household_invite(uuid) from public, anon, authenticated;
revoke all on function public.list_household_invites() from public, anon, authenticated;
revoke all on function public.list_household_members() from public, anon, authenticated;
revoke all on function public.remove_household_member(uuid) from public, anon, authenticated;
grant execute on function public.bootstrap_household(text, text) to authenticated;
grant execute on function public.create_household_invite(text, text, timestamptz) to authenticated;
grant execute on function public.accept_household_invite(text) to authenticated;
grant execute on function public.revoke_household_invite(uuid) to authenticated;
grant execute on function public.list_household_invites() to authenticated;
grant execute on function public.list_household_members() to authenticated;
grant execute on function public.remove_household_member(uuid) to authenticated;

comment on function public.bootstrap_household(text, text) is
  'Atomically consumes a beta token and creates the caller-owned household. The household is derived from auth.uid(), never accepted as input.';
comment on function public.accept_household_invite(text) is
  'Atomically accepts a token only when its normalized email matches the signed auth email claim.';
comment on function public.list_household_members() is
  'Returns a safe current-household member DTO without auth email or invitation secrets.';
comment on function public.remove_household_member(uuid) is
  'Owner-only member removal. The tenant is derived from auth, self-removal is rejected, and membership-dependent RLS access is revoked with the transaction.';

create function private.inventory_lot_dto(lot public.inventory_lots)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', lot.id,
    'householdId', lot.household_id,
    'foodConceptId', lot.food_concept_id,
    'name', lot.name,
    'category', lot.category,
    'quantityStatus', lot.quantity_status,
    'quantity', lot.quantity,
    'unit', lot.unit,
    'form', lot.form,
    'location', lot.location,
    'dateLabelType', lot.date_label_type,
    'dateLabel', lot.date_label,
    'status', lot.status,
    'version', lot.version,
    'createdAt', lot.created_at,
    'updatedAt', lot.updated_at
  )
$$;

revoke all on function private.inventory_lot_dto(public.inventory_lots) from public, anon, authenticated;

create function private.inventory_event_for_command(
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
      id, household_id, food_concept_id, name, category, quantity_status,
      quantity, unit, form, location, date_label_type, date_label, status,
      metadata, created_by
    ) values (
      command_lot_id,
      p_household_id,
      nullif(canonical_payload ->> 'foodConceptId', ''),
      btrim(canonical_payload ->> 'name'),
      coalesce(nullif(btrim(canonical_payload ->> 'category'), ''), 'Other'),
      next_quantity_status,
      next_quantity,
      next_unit,
      coalesce(nullif(canonical_payload ->> 'form', '')::public.food_form, 'unspecified'),
      coalesce(nullif(canonical_payload ->> 'location', '')::public.food_location, 'unknown'),
      next_date_label_type,
      next_date_label,
      'active',
      coalesce(canonical_payload -> 'metadata', '{}'::jsonb),
      p_actor_id
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
       set food_concept_id = next_food_concept_id, name = next_name,
           category = next_category,
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

revoke all on function private.inventory_event_for_command(uuid, uuid, uuid, public.inventory_command_type, integer, jsonb, public.inventory_event_type)
  from public, anon, authenticated;

-- Offline clients generate p_command_id once and retain it until acknowledged.
-- A replay with identical semantics returns the original result. A UUID reused
-- with different semantics is rejected. householdId in payload is discarded;
-- auth.uid() -> household_members is the only tenant authority.
create function public.apply_inventory_command(
  p_command_id uuid,
  p_command_type public.inventory_command_type,
  p_expected_version integer,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_household_id uuid := private.current_household_id();
  canonical_payload jsonb;
  existing_command public.inventory_commands%rowtype;
  event_kind public.inventory_event_type;
  command_result jsonb;
begin
  if actor_id is null or actor_household_id is null then
    raise exception using errcode = '28000', message = 'active household session required';
  end if;
  if p_command_id is null then
    raise exception using errcode = '22023', message = 'commandId is required';
  end if;
  if p_command_type is null then
    raise exception using errcode = '22023', message = 'command type is required';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception using errcode = '22023', message = 'command payload must be a JSON object';
  end if;

  canonical_payload := p_payload - 'householdId' - 'household_id';
  if p_command_type = 'add' then
    if p_expected_version is not null then
      raise exception using errcode = '22023', message = 'add commands cannot have expectedVersion';
    end if;
  else
    if p_expected_version is null or p_expected_version < 0 then
      raise exception using errcode = '22023', message = 'expectedVersion is required for this command';
    end if;
    if nullif(canonical_payload ->> 'lotId', '')::uuid is null then
      raise exception using errcode = '22023', message = 'lotId is required for this command';
    end if;
    if p_command_type in ('consume', 'discard', 'restore')
      and canonical_payload - 'lotId' <> '{}'::jsonb
    then
      raise exception using errcode = '22023', message = p_command_type::text || ' accepts only lotId';
    end if;
  end if;

  -- Serialize identical offline command UUIDs before reading or mutating. This
  -- lets a concurrent retry observe the first transaction's immutable result.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_command_id::text, 20260813)
  );

  select c.*
    into existing_command
    from public.inventory_commands as c
   where c.id = p_command_id;

  if found then
    if existing_command.household_id <> actor_household_id then
      raise exception using errcode = '23505', message = 'commandId is unavailable';
    end if;
    if existing_command.command_type <> p_command_type
      or existing_command.expected_version is distinct from p_expected_version
      or existing_command.payload is distinct from canonical_payload
    then
      raise exception using errcode = '23505', message = 'commandId has already been used with different semantics';
    end if;
    return jsonb_set(existing_command.result, '{replayed}', 'true'::jsonb, true);
  end if;

  event_kind := case p_command_type
    when 'add' then 'lot_added'::public.inventory_event_type
    when 'adjust' then 'lot_adjusted'::public.inventory_event_type
    when 'consume' then 'lot_consumed'::public.inventory_event_type
    when 'discard' then 'lot_discarded'::public.inventory_event_type
    when 'restore' then 'lot_restored'::public.inventory_event_type
  end;
  command_result := private.inventory_event_for_command(
    actor_household_id,
    actor_id,
    p_command_id,
    p_command_type,
    p_expected_version,
    canonical_payload,
    event_kind
  );

  return command_result;
end;
$$;

revoke all on function public.apply_inventory_command(uuid, public.inventory_command_type, integer, jsonb)
  from public, anon, authenticated;
grant execute on function public.apply_inventory_command(uuid, public.inventory_command_type, integer, jsonb)
  to authenticated;

comment on function public.apply_inventory_command(uuid, public.inventory_command_type, integer, jsonb) is
  'Atomic optimistic inventory mutation and immutable journal append. Successful command UUIDs replay exactly once per household.';

-- Applies all selected candidates or none. The analysis row lock and terminal
-- applied state make a committed retry a replay; rollbacks remove every lot,
-- command, event, and review change together.
create function public.apply_analysis_candidates(
  p_analysis_id uuid,
  p_expected_version integer,
  p_candidates jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_household_id uuid := private.current_household_id();
  analysis_row public.analyses%rowtype;
  candidate_row public.analysis_candidates%rowtype;
  selected jsonb;
  selected_ids uuid[] := '{}'::uuid[];
  accepted_lot_ids uuid[] := '{}'::uuid[];
  candidate_id uuid;
  candidate_command_id uuid;
  command_response jsonb;
  candidate_payload jsonb;
  final_name text;
  final_category text;
  final_quantity_status public.quantity_status;
  final_quantity numeric(12, 3);
  final_unit text;
  final_form public.food_form;
  final_location public.food_location;
  final_date_label_type public.date_label_type;
  final_date_label date;
  manual_ordinal smallint;
  manual_raw_label text;
  manual_image_indexes smallint[];
  manual_uncertainty_reason text;
  application_hash text := encode(extensions.digest(p_candidates::text, 'sha256'), 'hex');
begin
  if actor_id is null or actor_household_id is null then
    raise exception using errcode = '28000', message = 'active household session required';
  end if;
  if p_candidates is null
    or jsonb_typeof(p_candidates) <> 'array'
    or jsonb_array_length(p_candidates) < 1
    or jsonb_array_length(p_candidates) > 200
  then
    raise exception using errcode = '22023', message = 'between 1 and 200 analysis candidates are required';
  end if;

  select a.*
    into analysis_row
    from public.analyses as a
   where a.id = p_analysis_id
     and a.household_id = actor_household_id
   for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'analysis not found';
  end if;
  if analysis_row.status = 'applied' then
    if analysis_row.application_fingerprint is distinct from application_hash then
      raise exception using errcode = '23505', message = 'analysis was already applied with different candidate selections';
    end if;
    select coalesce(array_agg(ac.applied_lot_id order by ac.ordinal), '{}'::uuid[])
      into accepted_lot_ids
      from public.analysis_candidates as ac
     where ac.analysis_id = p_analysis_id
       and ac.household_id = actor_household_id
       and ac.review_status = 'accepted';
    return jsonb_build_object(
      'analysisId', p_analysis_id,
      'lotIds', to_jsonb(accepted_lot_ids),
      'replayed', true
    );
  end if;
  if analysis_row.status <> 'needs_review' then
    raise exception using errcode = '22023', message = 'analysis is not ready for review';
  end if;
  if p_expected_version is null or analysis_row.version <> p_expected_version then
    raise exception using
      errcode = '40001',
      message = 'analysis version conflict',
      detail = 'expected ' || coalesce(p_expected_version::text, 'null') || ', current ' || analysis_row.version::text;
  end if;

  for selected in select value from jsonb_array_elements(p_candidates)
  loop
    if jsonb_typeof(selected) <> 'object' then
      raise exception using errcode = '22023', message = 'analysis candidate must be a JSON object';
    end if;
    candidate_id := nullif(selected ->> 'id', '')::uuid;
    if candidate_id is null or candidate_id = any(selected_ids) then
      raise exception using errcode = '22023', message = 'candidate IDs must be present and unique';
    end if;

    select ac.*
      into candidate_row
      from public.analysis_candidates as ac
     where ac.id = candidate_id
       and ac.analysis_id = p_analysis_id
       and ac.household_id = actor_household_id
     for update;

    if not found then
      -- The review UI may add a food the model missed. An unknown UUID is
      -- accepted as manual only when the caller supplies the complete bounded
      -- candidate shape. IDs already owned by any analysis are never adopted.
      if exists (
        select 1 from public.analysis_candidates as ac where ac.id = candidate_id
      ) then
        raise exception using errcode = '23505', message = 'candidate ID is unavailable';
      end if;

      manual_raw_label := nullif(btrim(selected ->> 'rawLabel'), '');
      final_name := nullif(btrim(selected ->> 'suggestedName'), '');
      final_category := nullif(btrim(selected ->> 'category'), '');
      final_quantity_status := nullif(selected ->> 'quantityStatus', '')::public.quantity_status;
      final_quantity := nullif(selected ->> 'quantity', '')::numeric;
      final_unit := nullif(btrim(selected ->> 'unit'), '');
      final_form := nullif(selected ->> 'form', '')::public.food_form;
      final_location := nullif(selected ->> 'location', '')::public.food_location;
      final_date_label_type := nullif(selected ->> 'dateLabelType', '')::public.date_label_type;
      final_date_label := nullif(selected ->> 'dateLabel', '')::date;
      manual_uncertainty_reason := nullif(btrim(selected ->> 'uncertaintyReason'), '');

      if manual_raw_label is null
        or final_name is null
        or final_category is null
        or final_quantity_status is null
        or final_form is null
        or final_location is null
      then
        raise exception using errcode = '22023', message = 'manual candidates require rawLabel, suggestedName, category, quantityStatus, form, and location';
      end if;
      if final_quantity_status = 'unknown' then
        final_quantity := null;
        final_unit := null;
      elsif final_quantity is null or final_quantity <= 0 or final_unit is null then
        raise exception using errcode = '22023', message = 'manual candidate known/estimated quantity requires a positive quantity and unit';
      end if;
      if (final_date_label is null) <> (final_date_label_type is null) then
        raise exception using errcode = '22023', message = 'manual candidate dateLabel and dateLabelType must be supplied together';
      end if;
      if not (selected ? 'imageIndexes')
        or jsonb_typeof(selected -> 'imageIndexes') <> 'array'
      then
        raise exception using errcode = '22023', message = 'manual candidate imageIndexes must be an array';
      end if;
      select coalesce(array_agg(value::smallint order by ordinal), '{}'::smallint[])
        into manual_image_indexes
        from jsonb_array_elements_text(selected -> 'imageIndexes') with ordinality as image(value, ordinal);
      if cardinality(manual_image_indexes) not between 1 and analysis_row.image_count
        or exists (
          select 1
            from unnest(manual_image_indexes) as image_index(value)
           where image_index.value < 0 or image_index.value >= analysis_row.image_count
        )
        or (
          select count(distinct image_index.value)
            from unnest(manual_image_indexes) as image_index(value)
        ) <> cardinality(manual_image_indexes)
      then
        raise exception using errcode = '22023', message = 'manual candidate imageIndexes must be unique indexes from this analysis';
      end if;

      select (coalesce(max(ac.ordinal), -1) + 1)::smallint
        into manual_ordinal
        from public.analysis_candidates as ac
       where ac.analysis_id = p_analysis_id
         and ac.household_id = actor_household_id;
      if manual_ordinal >= 200 then
        raise exception using errcode = '54000', message = 'analysis candidate limit reached';
      end if;

      insert into public.analysis_candidates (
        id,
        household_id,
        analysis_id,
        ordinal,
        raw_label,
        suggested_food_concept_id,
        suggested_name,
        category,
        quantity_status,
        quantity,
        unit,
        form,
        location,
        date_label_type,
        date_label,
        image_indexes,
        uncertainty_reason
      ) values (
        candidate_id,
        actor_household_id,
        p_analysis_id,
        manual_ordinal,
        manual_raw_label,
        nullif(selected ->> 'suggestedConceptId', ''),
        final_name,
        final_category,
        final_quantity_status,
        final_quantity,
        final_unit,
        final_form,
        final_location,
        final_date_label_type,
        final_date_label,
        manual_image_indexes,
        manual_uncertainty_reason
      )
      returning * into candidate_row;
    end if;

    if candidate_row.review_status <> 'proposed' then
      raise exception using errcode = 'P0002', message = 'proposed analysis candidate not found';
    end if;

    final_name := coalesce(nullif(btrim(selected ->> 'suggestedName'), ''), candidate_row.suggested_name);
    final_category := coalesce(nullif(btrim(selected ->> 'category'), ''), candidate_row.category);
    final_quantity_status := case
      when selected ? 'quantityStatus' then nullif(selected ->> 'quantityStatus', '')::public.quantity_status
      else candidate_row.quantity_status
    end;
    final_quantity := case
      when selected ? 'quantity' then nullif(selected ->> 'quantity', '')::numeric
      else candidate_row.quantity
    end;
    final_unit := case
      when selected ? 'unit' then nullif(btrim(selected ->> 'unit'), '')
      else candidate_row.unit
    end;
    final_form := case
      when selected ? 'form' then nullif(selected ->> 'form', '')::public.food_form
      else candidate_row.form
    end;
    final_location := case
      when selected ? 'location' then nullif(selected ->> 'location', '')::public.food_location
      else candidate_row.location
    end;
    final_date_label_type := case
      when selected ? 'dateLabelType' then nullif(selected ->> 'dateLabelType', '')::public.date_label_type
      else candidate_row.date_label_type
    end;
    final_date_label := case
      when selected ? 'dateLabel' then nullif(selected ->> 'dateLabel', '')::date
      else candidate_row.date_label
    end;

    if final_quantity_status = 'unknown' then
      final_quantity := null;
      final_unit := null;
    end if;
    if final_date_label is null then
      final_date_label_type := null;
    end if;

    candidate_payload := jsonb_build_object(
      'id', candidate_row.id,
      'foodConceptId', case
        when selected ? 'suggestedConceptId'
          then nullif(selected ->> 'suggestedConceptId', '')
        else candidate_row.suggested_food_concept_id
      end,
      'name', final_name,
      'category', final_category,
      'quantityStatus', final_quantity_status,
      'quantity', final_quantity,
      'unit', final_unit,
      'form', final_form,
      'location', final_location,
      'dateLabelType', final_date_label_type,
      'dateLabel', final_date_label,
      'metadata', jsonb_build_object(
        'source', 'analysis',
        'analysisId', p_analysis_id,
        'candidateId', candidate_row.id
      )
    );

    candidate_command_id := gen_random_uuid();
    command_response := private.inventory_event_for_command(
      actor_household_id,
      actor_id,
      candidate_command_id,
      'add'::public.inventory_command_type,
      null,
      candidate_payload,
      'lot_added_from_analysis'::public.inventory_event_type
    );

    accepted_lot_ids := array_append(
      accepted_lot_ids,
      (command_response #>> '{lot,id}')::uuid
    );
    selected_ids := array_append(selected_ids, candidate_row.id);

    update public.analysis_candidates
       set suggested_food_concept_id = case
             when selected ? 'suggestedConceptId'
               then nullif(selected ->> 'suggestedConceptId', '')
             else candidate_row.suggested_food_concept_id
           end,
           suggested_name = final_name,
           category = final_category,
           quantity_status = final_quantity_status,
           quantity = final_quantity,
           unit = final_unit,
           form = final_form,
           location = final_location,
           date_label_type = final_date_label_type,
           date_label = final_date_label,
           review_status = 'accepted',
           applied_lot_id = (command_response #>> '{lot,id}')::uuid,
           application_command_id = candidate_command_id,
           reviewed_by = actor_id,
           reviewed_at = now()
     where id = candidate_row.id;
  end loop;

  update public.analysis_candidates
     set review_status = 'rejected',
         reviewed_by = actor_id,
         reviewed_at = now()
   where analysis_id = p_analysis_id
     and household_id = actor_household_id
     and review_status = 'proposed'
     and not (id = any(selected_ids));

  update public.analyses
     set status = 'applied',
         completed_at = now(),
         application_fingerprint = application_hash,
         purge_after = least(purge_after, now())
   where id = p_analysis_id
     and household_id = actor_household_id;

  update public.image_assets
     set status = case
       when status = 'deleted' then 'deleted'::public.image_asset_status
       else 'purge_pending'::public.image_asset_status
     end,
         upload_authorization_expires_at = case
           when status in ('purge_pending', 'deleted') then upload_authorization_expires_at
           else greatest(upload_authorization_expires_at, now() + interval '2 hours 15 minutes')
         end
   where analysis_id = p_analysis_id
     and household_id = actor_household_id;

  return jsonb_build_object(
    'analysisId', p_analysis_id,
    'lotIds', to_jsonb(accepted_lot_ids),
    'replayed', false
  );
end;
$$;

revoke all on function public.apply_analysis_candidates(uuid, integer, jsonb)
  from public, anon, authenticated;
grant execute on function public.apply_analysis_candidates(uuid, integer, jsonb)
  to authenticated;

comment on function public.apply_analysis_candidates(uuid, integer, jsonb) is
  'Atomically accepts selected candidates, rejects the remainder, applies idempotent inventory commands, and marks the caller household analysis applied.';

create function public.create_analysis(
  p_analysis_id uuid,
  p_assets jsonb,
  p_idempotency_key uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_household_id uuid := private.current_household_id();
  asset_input jsonb;
  asset_id uuid;
  asset_index smallint;
  asset_count integer;
  asset_indexes smallint[];
  inserted_count integer;
  existing_analysis public.analyses%rowtype;
  response_assets jsonb;
  rate_limit_result jsonb;
begin
  if actor_id is null or actor_household_id is null then
    raise exception using errcode = '28000', message = 'active household session required';
  end if;
  if not exists (
    select 1
      from public.privacy_consents as pc
     where pc.user_id = actor_id
       and pc.household_id = actor_household_id
       and pc.consent_version = 'vision-v1'
  ) then
    raise exception using errcode = '42501', message = 'vision-v1 privacy consent required before image analysis';
  end if;
  if p_analysis_id is null then
    raise exception using errcode = '22023', message = 'analysisId is required';
  end if;
  if p_assets is null or jsonb_typeof(p_assets) <> 'array' then
    raise exception using errcode = '22023', message = 'assets must be a JSON array';
  end if;
  asset_count := jsonb_array_length(p_assets);
  if asset_count not between 1 and 3 then
    raise exception using errcode = '22023', message = 'analysis requires between one and three assets';
  end if;
  select array_agg(distinct nullif(asset ->> 'imageIndex', '')::smallint order by nullif(asset ->> 'imageIndex', '')::smallint)
    into asset_indexes
    from jsonb_array_elements(p_assets) as requested(asset);
  if asset_indexes is distinct from array(
    select generate_series(0, asset_count - 1)::smallint
  ) then
    raise exception using errcode = '22023', message = 'asset imageIndex values must be unique and contiguous from zero';
  end if;

  insert into public.analyses (
    id, household_id, status, image_count, idempotency_key, created_by
  ) values (
    p_analysis_id,
    actor_household_id,
    'created',
    asset_count,
    p_idempotency_key,
    actor_id
  )
  on conflict (id) do nothing;
  get diagnostics inserted_count = row_count;

  if inserted_count = 0 then
    select a.*
      into existing_analysis
      from public.analyses as a
     where a.id = p_analysis_id
       and a.household_id = actor_household_id;
    if not found then
      raise exception using errcode = '23505', message = 'analysisId is unavailable';
    end if;
    if existing_analysis.created_by <> actor_id
      or existing_analysis.image_count <> asset_count
      or existing_analysis.idempotency_key is distinct from p_idempotency_key
    then
      raise exception using errcode = '23505', message = 'analysisId has already been used with different semantics';
    end if;
  else
    -- This cost-bearing limit lives in the database boundary so an
    -- authenticated caller cannot bypass it by invoking the RPC directly.
    -- A rejected insert rolls back while the previously committed allowance
    -- remains exhausted; idempotent replays do not consume another slot.
    select public.consume_rate_limit('analysis_create', 10, 3600)
      into rate_limit_result;
    if not coalesce((rate_limit_result ->> 'allowed')::boolean, false) then
      raise sqlstate 'PT429' using
        message = 'Analysis creation rate limit exceeded',
        detail = 'retryAfterSeconds=' || coalesce(rate_limit_result ->> 'retryAfterSeconds', '1');
    end if;

    for asset_input in select value from jsonb_array_elements(p_assets)
    loop
      if jsonb_typeof(asset_input) <> 'object' then
        raise exception using errcode = '22023', message = 'asset descriptor must be a JSON object';
      end if;
      asset_id := nullif(asset_input ->> 'id', '')::uuid;
      asset_index := nullif(asset_input ->> 'imageIndex', '')::smallint;
      if asset_id is null or asset_index is null then
        raise exception using errcode = '22023', message = 'asset id and imageIndex are required';
      end if;

      insert into public.image_assets (
        id,
        household_id,
        analysis_id,
        image_index,
        object_path,
        original_filename,
        content_type,
        byte_size,
        checksum_sha256,
        created_by
      ) values (
        asset_id,
        actor_household_id,
        p_analysis_id,
        asset_index,
        actor_household_id::text || '/' || actor_id::text || '/' || p_analysis_id::text || '/' || asset_id::text || '.jpg',
        asset_input ->> 'originalFilename',
        asset_input ->> 'contentType',
        nullif(asset_input ->> 'byteSize', '')::integer,
        nullif(lower(asset_input ->> 'checksumSha256'), ''),
        actor_id
      );
    end loop;
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'assetId', ia.id,
        'imageIndex', ia.image_index,
        'objectPath', ia.object_path,
        'contentType', ia.content_type,
        'byteSize', ia.byte_size
      ) order by ia.image_index
    ),
    '[]'::jsonb
  )
    into response_assets
    from public.image_assets as ia
   where ia.analysis_id = p_analysis_id
     and ia.household_id = actor_household_id;

  if jsonb_array_length(response_assets) <> asset_count then
    raise exception using errcode = '23505', message = 'analysisId has already been used with different assets';
  end if;
  if exists (
    select 1
      from jsonb_array_elements(p_assets) as requested(asset)
     where not exists (
       select 1
         from public.image_assets as ia
        where ia.analysis_id = p_analysis_id
          and ia.household_id = actor_household_id
          and ia.id = nullif(requested.asset ->> 'id', '')::uuid
          and ia.image_index = nullif(requested.asset ->> 'imageIndex', '')::smallint
          and ia.original_filename = requested.asset ->> 'originalFilename'
          and ia.content_type = requested.asset ->> 'contentType'
          and ia.byte_size = nullif(requested.asset ->> 'byteSize', '')::integer
          and ia.checksum_sha256 is not distinct from nullif(lower(requested.asset ->> 'checksumSha256'), '')
     )
  ) then
    raise exception using errcode = '23505', message = 'analysisId has already been used with different assets';
  end if;

  return jsonb_build_object(
    'analysisId', p_analysis_id,
    'status', 'created',
    'assets', response_assets,
    'replayed', inserted_count = 0
  );
end;
$$;

create function public.get_inventory_sync(
  p_after_created_at timestamptz default null,
  p_after_event_id uuid default null,
  p_limit integer default 500
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_household_id uuid := private.current_household_id();
  lot_rows jsonb;
  event_rows jsonb;
  last_created_at timestamptz;
  last_event_id uuid;
begin
  if auth.uid() is null or actor_household_id is null then
    raise exception using errcode = '28000', message = 'active household session required';
  end if;
  if p_limit not between 1 and 1000 then
    raise exception using errcode = '22023', message = 'sync limit must be between 1 and 1000';
  end if;
  if (p_after_created_at is null) <> (p_after_event_id is null) then
    raise exception using errcode = '22023', message = 'both cursor fields must be supplied together';
  end if;

  select coalesce(jsonb_agg(private.inventory_lot_dto(l) order by l.created_at, l.id), '[]'::jsonb)
    into lot_rows
    from public.inventory_lots as l
   where l.household_id = actor_household_id;

  with page as (
    select e.*
      from public.inventory_events as e
     where e.household_id = actor_household_id
       and (
         p_after_created_at is null
         or (e.created_at, e.id) > (p_after_created_at, p_after_event_id)
       )
     order by e.created_at, e.id
     limit p_limit
  ), aggregated as (
    select
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', p.id,
            'commandId', p.command_id,
            'lotId', p.lot_id,
            'type', p.event_type,
            'previousVersion', p.prior_version,
            'version', p.new_version,
            'createdAt', p.created_at
          ) order by p.created_at, p.id
        ),
        '[]'::jsonb
      ) as events,
      (array_agg(p.created_at order by p.created_at desc, p.id desc))[1] as tail_created_at,
      (array_agg(p.id order by p.created_at desc, p.id desc))[1] as tail_event_id
    from page as p
  )
  select a.events, a.tail_created_at, a.tail_event_id
    into event_rows, last_created_at, last_event_id
    from aggregated as a;

  return jsonb_build_object(
    'lots', lot_rows,
    'events', event_rows,
    'cursor', case
      when last_event_id is null then null
      else jsonb_build_object('createdAt', last_created_at, 'eventId', last_event_id)
    end
  );
end;
$$;

revoke all on function public.create_analysis(uuid, jsonb, uuid) from public, anon, authenticated;
revoke all on function public.get_inventory_sync(timestamptz, uuid, integer) from public, anon, authenticated;
grant execute on function public.create_analysis(uuid, jsonb, uuid) to authenticated;
grant execute on function public.get_inventory_sync(timestamptz, uuid, integer) to authenticated;

comment on function public.create_analysis(uuid, jsonb, uuid) is
  'Atomically creates an analysis and 1-3 canonical private-storage asset rows for auth.uid() current household.';
comment on function public.get_inventory_sync(timestamptz, uuid, integer) is
  'Returns the current lot snapshot plus an ordered append-only event page for auth.uid() current household.';

create function public.complete_analysis(
  p_analysis_id uuid,
  p_asset_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_household_id uuid := private.current_household_id();
  analysis_row public.analyses%rowtype;
  expected_asset_ids uuid[];
  normalized_asset_ids uuid[];
begin
  if auth.uid() is null or actor_household_id is null then
    raise exception using errcode = '28000', message = 'active household session required';
  end if;
  if p_asset_ids is null or cardinality(p_asset_ids) not between 1 and 3 then
    raise exception using errcode = '22023', message = 'between one and three asset IDs are required';
  end if;
  select array_agg(distinct requested_id order by requested_id)
    into normalized_asset_ids
    from unnest(p_asset_ids) as requested(requested_id);
  if cardinality(normalized_asset_ids) <> cardinality(p_asset_ids) then
    raise exception using errcode = '22023', message = 'asset IDs must be unique';
  end if;

  select a.*
    into analysis_row
    from public.analyses as a
   where a.id = p_analysis_id
     and a.household_id = actor_household_id
   for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'analysis not found';
  end if;

  perform 1
    from public.image_assets as ia
   where ia.analysis_id = p_analysis_id
     and ia.household_id = actor_household_id
   for update;
  select array_agg(ia.id order by ia.id)
    into expected_asset_ids
    from public.image_assets as ia
   where ia.analysis_id = p_analysis_id
     and ia.household_id = actor_household_id;

  if expected_asset_ids is distinct from normalized_asset_ids
    or cardinality(expected_asset_ids) <> analysis_row.image_count
  then
    raise exception using errcode = '22023', message = 'asset IDs must exactly match the analysis asset set';
  end if;

  if analysis_row.status in ('queued', 'processing', 'needs_review', 'applied', 'failed') then
    return jsonb_build_object(
      'analysisId', p_analysis_id,
      'status', analysis_row.status,
      'replayed', true
    );
  end if;
  if analysis_row.status <> 'created' then
    raise exception using errcode = '22023', message = 'analysis cannot be completed from its current state';
  end if;
  if exists (
    select 1
      from public.image_assets as ia
     where ia.analysis_id = p_analysis_id
       and ia.household_id = actor_household_id
       and ia.status <> 'pending_upload'
  ) then
    raise exception using errcode = '22023', message = 'analysis assets are not awaiting upload completion';
  end if;

  -- Storage metadata is validated again inside the authoritative transition.
  -- The browser cannot queue a missing, oversized, non-JPEG, or wrong-size
  -- object by skipping the Next.js completion route.
  if exists (
    select 1
      from public.image_assets as ia
      left join storage.objects as stored
        on stored.bucket_id = 'raw-images'
       and stored.name = ia.object_path
     where ia.analysis_id = p_analysis_id
       and ia.household_id = actor_household_id
       and (
         stored.id is null
         or lower(coalesce(stored.metadata ->> 'mimetype', '')) <> 'image/jpeg'
         or case
              when coalesce(stored.metadata ->> 'size', '') ~ '^[0-9]+$'
                then (stored.metadata ->> 'size')::bigint
              else null
            end is distinct from ia.byte_size::bigint
         or ia.byte_size > 5000000
       )
  ) then
    raise exception using errcode = '22023', message = 'uploaded object metadata does not match its verified descriptor';
  end if;

  update public.image_assets
     set status = 'uploaded'
   where analysis_id = p_analysis_id
     and household_id = actor_household_id;
  update public.analyses
     set status = 'queued',
         purge_after = now() + interval '22 hours',
         purge_claimed_at = null,
         purge_claimed_by = null
   where id = p_analysis_id
     and household_id = actor_household_id;

  return jsonb_build_object('analysisId', p_analysis_id, 'status', 'queued', 'replayed', false);
end;
$$;

create function public.cancel_analysis(p_analysis_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_household_id uuid := private.current_household_id();
  analysis_row public.analyses%rowtype;
  purge_paths jsonb;
begin
  if auth.uid() is null or actor_household_id is null then
    raise exception using errcode = '28000', message = 'active household session required';
  end if;

  select a.*
    into analysis_row
    from public.analyses as a
   where a.id = p_analysis_id
     and a.household_id = actor_household_id
   for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'analysis not found';
  end if;
  if analysis_row.status = 'applied' then
    raise exception using errcode = '22023', message = 'an applied analysis cannot be cancelled';
  end if;

  update public.image_assets
     set status = case when status = 'deleted' then 'deleted'::public.image_asset_status else 'purge_pending'::public.image_asset_status end
       , upload_authorization_expires_at = case
           when status in ('purge_pending', 'deleted') then upload_authorization_expires_at
           else greatest(upload_authorization_expires_at, now() + interval '2 hours 15 minutes')
         end
   where analysis_id = p_analysis_id
     and household_id = actor_household_id;

  if analysis_row.status <> 'cancelled' then
    update public.analyses
       set status = 'cancelled',
           completed_at = coalesce(completed_at, now()),
           purge_after = least(purge_after, now())
     where id = p_analysis_id
       and household_id = actor_household_id;
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object('assetId', ia.id, 'objectPath', ia.object_path)
      order by ia.image_index
    ),
    '[]'::jsonb
  ) into purge_paths
    from public.image_assets as ia
   where ia.analysis_id = p_analysis_id
     and ia.household_id = actor_household_id
     and ia.status = 'purge_pending';

  return jsonb_build_object(
    'analysisId', p_analysis_id,
    'status', 'cancelled',
    'assets', purge_paths,
    'replayed', analysis_row.status = 'cancelled'
  );
end;
$$;

-- Service-only worker write boundary. Valid transitions are constrained here,
-- and candidate replacement plus analysis state commit atomically. Candidates
-- are accepted as provider-validated structured output, then constrained again
-- by table enums/checks before storage.
create function public.store_analysis_candidates(
  p_analysis_id uuid,
  p_from_status public.analysis_status,
  p_to_status public.analysis_status,
  p_candidates jsonb default '[]'::jsonb,
  p_provider text default null,
  p_model text default null,
  p_prompt_version text default null,
  p_error_code text default null,
  p_error_detail text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  analysis_row public.analyses%rowtype;
  candidate_input jsonb;
  candidate_count integer;
begin
  if p_candidates is null or jsonb_typeof(p_candidates) <> 'array' then
    raise exception using errcode = '22023', message = 'candidates must be a JSON array';
  end if;
  if not (
    (p_from_status = 'queued' and p_to_status = 'processing')
    or (p_from_status = 'processing' and p_to_status in ('needs_review', 'failed'))
  ) then
    raise exception using errcode = '22023', message = 'invalid worker analysis status transition';
  end if;
  if p_to_status = 'needs_review' and jsonb_array_length(p_candidates) < 1 then
    raise exception using errcode = '22023', message = 'needs_review requires at least one candidate';
  end if;
  if p_to_status <> 'needs_review' and jsonb_array_length(p_candidates) <> 0 then
    raise exception using errcode = '22023', message = 'only needs_review may store candidates';
  end if;
  if p_to_status = 'failed' and nullif(btrim(coalesce(p_error_code, '')), '') is null then
    raise exception using errcode = '22023', message = 'failed transition requires an error code';
  end if;

  select a.*
    into analysis_row
    from public.analyses as a
   where a.id = p_analysis_id
   for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'analysis not found';
  end if;
  if analysis_row.status = p_to_status then
    if p_to_status = 'needs_review' then
      select count(*) into candidate_count
        from public.analysis_candidates as ac
       where ac.analysis_id = p_analysis_id
         and ac.household_id = analysis_row.household_id;
      if candidate_count <> jsonb_array_length(p_candidates)
        or exists (
          select 1
            from jsonb_array_elements(p_candidates) as requested(candidate)
           where not exists (
             select 1
               from public.analysis_candidates as ac
              where ac.analysis_id = p_analysis_id
                and ac.household_id = analysis_row.household_id
                and ac.id = nullif(requested.candidate ->> 'id', '')::uuid
                and ac.ordinal = nullif(requested.candidate ->> 'ordinal', '')::smallint
           )
        )
      then
        raise exception using errcode = '23505', message = 'analysis transition was already stored with different candidates';
      end if;
    elsif p_to_status = 'failed' and analysis_row.error_code is distinct from p_error_code then
      raise exception using errcode = '23505', message = 'analysis transition was already stored with a different error';
    end if;
    return jsonb_build_object('analysisId', p_analysis_id, 'status', p_to_status, 'replayed', true);
  end if;
  if analysis_row.status <> p_from_status then
    raise exception using errcode = '40001', message = 'analysis status transition conflict';
  end if;
  if p_to_status = 'processing' and exists (
    select 1
      from public.image_assets as ia
     where ia.analysis_id = p_analysis_id
       and ia.household_id = analysis_row.household_id
       and ia.status <> 'uploaded'
  ) then
    raise exception using errcode = '22023', message = 'analysis assets are not ready for processing';
  end if;

  if p_to_status = 'needs_review' then
    for candidate_input in select value from jsonb_array_elements(p_candidates)
    loop
      if jsonb_typeof(candidate_input) <> 'object' then
        raise exception using errcode = '22023', message = 'candidate must be a JSON object';
      end if;
      if nullif(candidate_input ->> 'id', '')::uuid is null
        or nullif(candidate_input ->> 'ordinal', '')::smallint is null
      then
        raise exception using errcode = '22023', message = 'candidate id and ordinal are required';
      end if;
      insert into public.analysis_candidates (
        id,
        household_id,
        analysis_id,
        ordinal,
        raw_label,
        suggested_food_concept_id,
        suggested_name,
        category,
        quantity_status,
        quantity,
        unit,
        form,
        location,
        date_label_type,
        date_label,
        image_indexes,
        confidence,
        uncertainty_reason
      ) values (
        nullif(candidate_input ->> 'id', '')::uuid,
        analysis_row.household_id,
        p_analysis_id,
        nullif(candidate_input ->> 'ordinal', '')::smallint,
        candidate_input ->> 'rawLabel',
        nullif(candidate_input ->> 'suggestedConceptId', ''),
        candidate_input ->> 'suggestedName',
        coalesce(nullif(candidate_input ->> 'category', ''), 'Other'),
        coalesce(nullif(candidate_input ->> 'quantityStatus', '')::public.quantity_status, 'unknown'),
        nullif(candidate_input ->> 'quantity', '')::numeric,
        nullif(candidate_input ->> 'unit', ''),
        coalesce(nullif(candidate_input ->> 'form', '')::public.food_form, 'unspecified'),
        coalesce(nullif(candidate_input ->> 'location', '')::public.food_location, 'unknown'),
        nullif(candidate_input ->> 'dateLabelType', '')::public.date_label_type,
        nullif(candidate_input ->> 'dateLabel', '')::date,
        array(select jsonb_array_elements_text(candidate_input -> 'imageIndexes')::smallint),
        nullif(candidate_input ->> 'confidence', '')::numeric,
        nullif(candidate_input ->> 'uncertaintyReason', '')
      );
    end loop;
  end if;

  update public.analyses
     set status = p_to_status,
         provider = coalesce(p_provider, provider),
         model = coalesce(p_model, model),
         prompt_version = coalesce(p_prompt_version, prompt_version),
         error_code = case when p_to_status = 'failed' then p_error_code else null end,
         error_detail = case when p_to_status = 'failed' then p_error_detail else null end,
         started_at = case when p_to_status = 'processing' then coalesce(started_at, now()) else started_at end,
         completed_at = case when p_to_status in ('needs_review', 'failed') then now() else completed_at end
   where id = p_analysis_id;

  update public.image_assets
     set status = case p_to_status
       when 'processing' then 'processing'::public.image_asset_status
       when 'needs_review' then 'processed'::public.image_asset_status
       when 'failed' then 'failed'::public.image_asset_status
       else status
     end
   where analysis_id = p_analysis_id
     and household_id = analysis_row.household_id
     and status <> 'deleted';

  return jsonb_build_object('analysisId', p_analysis_id, 'status', p_to_status, 'replayed', false);
end;
$$;

revoke all on function public.complete_analysis(uuid, uuid[]) from public, anon, authenticated;
revoke all on function public.cancel_analysis(uuid) from public, anon, authenticated;
revoke all on function public.store_analysis_candidates(uuid, public.analysis_status, public.analysis_status, jsonb, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.complete_analysis(uuid, uuid[]) to authenticated;
grant execute on function public.cancel_analysis(uuid) to authenticated;
grant execute on function public.store_analysis_candidates(uuid, public.analysis_status, public.analysis_status, jsonb, text, text, text, text, text)
  to service_role;

comment on function public.complete_analysis(uuid, uuid[]) is
  'Caller-household exact-set upload completion: locks analysis/assets, transitions pending_upload -> uploaded and created -> queued atomically and idempotently.';
comment on function public.cancel_analysis(uuid) is
  'Idempotently cancels a caller-household analysis before application and returns its purge_pending object paths for immediate deletion.';
comment on function public.store_analysis_candidates(uuid, public.analysis_status, public.analysis_status, jsonb, text, text, text, text, text) is
  'Service-only atomic worker transition and structured candidate persistence boundary.';

create function public.apply_cook_reconciliation(
  p_cook_session_id uuid,
  p_changes jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_household_id uuid := private.current_household_id();
  session_row public.cook_sessions%rowtype;
  lot_row public.inventory_lots%rowtype;
  change_input jsonb;
  change_ids text[] := '{}'::text[];
  changed_lot_ids uuid[] := '{}'::uuid[];
  change_key text;
  ingredient_id text;
  lot_id uuid;
  action public.cook_reconciliation_action;
  expected_version integer;
  used_quantity numeric(12, 3);
  used_unit text;
  remaining_quantity numeric(12, 3);
  command_id uuid;
  command_response jsonb;
  fingerprint text := encode(extensions.digest(p_changes::text, 'sha256'), 'hex');
  result_rows jsonb;
begin
  if actor_id is null or actor_household_id is null then
    raise exception using errcode = '28000', message = 'active household session required';
  end if;
  if p_changes is null
    or jsonb_typeof(p_changes) <> 'array'
    or jsonb_array_length(p_changes) > 200
  then
    raise exception using errcode = '22023', message = 'reconciliation changes must be an array of at most 200 items';
  end if;

  select cs.*
    into session_row
    from public.cook_sessions as cs
   where cs.id = p_cook_session_id
     and cs.household_id = actor_household_id
   for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'cook session not found';
  end if;
  if session_row.status = 'reconciled' then
    if session_row.reconciliation_fingerprint is distinct from fingerprint then
      raise exception using errcode = '23505', message = 'cook session was reconciled with different changes';
    end if;
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', cr.id,
          'ingredientId', cr.ingredient_id,
          'lotId', cr.lot_id,
          'action', cr.action,
          'commandId', cr.applied_command_id
        ) order by cr.created_at, cr.id
      ),
      '[]'::jsonb
    ) into result_rows
      from public.cook_reconciliations as cr
     where cr.cook_session_id = p_cook_session_id
       and cr.household_id = actor_household_id;
    return jsonb_build_object(
      'cookSessionId', p_cook_session_id,
      'changes', result_rows,
      'replayed', true
    );
  end if;
  if session_row.status <> 'active' then
    raise exception using errcode = '22023', message = 'cook session is not active';
  end if;

  for change_input in select value from jsonb_array_elements(p_changes)
  loop
    if jsonb_typeof(change_input) <> 'object' then
      raise exception using errcode = '22023', message = 'reconciliation change must be a JSON object';
    end if;
    ingredient_id := nullif(btrim(change_input ->> 'ingredientId'), '');
    lot_id := nullif(change_input ->> 'lotId', '')::uuid;
    action := nullif(change_input ->> 'action', '')::public.cook_reconciliation_action;
    expected_version := nullif(change_input ->> 'expectedVersion', '')::integer;
    used_quantity := nullif(change_input ->> 'quantity', '')::numeric;
    used_unit := nullif(btrim(change_input ->> 'unit'), '');
    change_key := coalesce(ingredient_id, '') || ':' || coalesce(lot_id::text, '');

    if ingredient_id is null or lot_id is null or action is null or expected_version is null or expected_version < 0 then
      raise exception using errcode = '22023', message = 'ingredientId, lotId, action, and expectedVersion are required';
    end if;
    if change_key = any(change_ids) then
      raise exception using errcode = '22023', message = 'reconciliation changes must be unique per ingredient and lot';
    end if;
    if lot_id = any(changed_lot_ids) then
      raise exception using errcode = '22023', message = 'a lot may be changed only once per reconciliation';
    end if;

    select l.*
      into lot_row
      from public.inventory_lots as l
     where l.id = lot_id
       and l.household_id = actor_household_id
     for update;

    if not found then
      raise exception using errcode = 'P0002', message = 'reconciliation lot not found';
    end if;
    if lot_row.version <> expected_version then
      raise exception using
        errcode = '40001',
        message = 'reconciliation lot version conflict',
        detail = 'expected ' || expected_version::text || ', current ' || lot_row.version::text;
    end if;
    if action <> 'no_change' and lot_row.status <> 'active' then
      raise exception using errcode = '22023', message = 'only active lots can be reconciled as used';
    end if;

    command_id := gen_random_uuid();
    if action = 'used_some' then
      if used_quantity is null or used_quantity <= 0 or used_unit is null then
        raise exception using errcode = '22023', message = 'used_some requires a positive quantity and unit';
      end if;
      if lot_row.quantity_status = 'unknown' or lot_row.quantity is null or lot_row.unit is null then
        raise exception using errcode = '22023', message = 'used_some requires a lot with a numeric quantity';
      end if;
      if lower(lot_row.unit) <> lower(used_unit) then
        raise exception using errcode = '22023', message = 'reconciliation unit must match the inventory lot unit';
      end if;
      remaining_quantity := lot_row.quantity - used_quantity;
      if remaining_quantity <= 0 then
        raise exception using errcode = '22023', message = 'use used_up when the whole lot was consumed';
      end if;
      command_response := private.inventory_event_for_command(
        actor_household_id,
        actor_id,
        command_id,
        'adjust'::public.inventory_command_type,
        expected_version,
        jsonb_build_object(
          'lotId', lot_id,
          'quantityStatus', lot_row.quantity_status,
          'quantity', remaining_quantity,
          'unit', lot_row.unit
        ),
        'lot_reconciled'::public.inventory_event_type
      );
    elsif action = 'used_up' then
      if used_quantity is not null or used_unit is not null then
        raise exception using errcode = '22023', message = 'used_up does not accept quantity or unit';
      end if;
      command_response := private.inventory_event_for_command(
        actor_household_id,
        actor_id,
        command_id,
        'consume'::public.inventory_command_type,
        expected_version,
        jsonb_build_object('lotId', lot_id),
        'lot_reconciled'::public.inventory_event_type
      );
    elsif used_quantity is not null or used_unit is not null then
      raise exception using errcode = '22023', message = 'no_change does not accept quantity or unit';
    else
      command_id := null;
    end if;

    insert into public.cook_reconciliations (
      household_id,
      cook_session_id,
      ingredient_id,
      lot_id,
      action,
      quantity,
      unit,
      expected_version,
      applied_command_id,
      created_by
    ) values (
      actor_household_id,
      p_cook_session_id,
      ingredient_id,
      lot_id,
      action,
      used_quantity,
      used_unit,
      expected_version,
      command_id,
      actor_id
    );

    change_ids := array_append(change_ids, change_key);
    if action <> 'no_change' then
      changed_lot_ids := array_append(changed_lot_ids, lot_id);
    end if;
  end loop;

  update public.cook_sessions
     set status = 'reconciled',
         completed_at = now(),
         reconciliation_fingerprint = fingerprint
   where id = p_cook_session_id
     and household_id = actor_household_id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', cr.id,
        'ingredientId', cr.ingredient_id,
        'lotId', cr.lot_id,
        'action', cr.action,
        'commandId', cr.applied_command_id
      ) order by cr.created_at, cr.id
    ),
    '[]'::jsonb
  ) into result_rows
    from public.cook_reconciliations as cr
   where cr.cook_session_id = p_cook_session_id
     and cr.household_id = actor_household_id;

  return jsonb_build_object(
    'cookSessionId', p_cook_session_id,
    'changes', result_rows,
    'replayed', false
  );
end;
$$;

-- Claims purge work with SKIP LOCKED so concurrent workers cannot own the same
-- analysis. Incomplete uploads expire after one hour; completed uploads become
-- eligible at 22 hours, leaving scheduler/backlog margin below the 24-hour
-- maximum retention ceiling. Apply/cancel make photos immediately eligible.
-- Purge-pending paths are reclaimed only after their recorded upload token
-- expiry, avoiding lease churn while still re-deleting any late upload. Only
-- service_role can execute this function. A stale 15-minute lease is
-- reclaimable after worker failure. Storage deletion is performed by the
-- worker, then complete_raw_image_purge marks relational assets deleted.
create function public.claim_expired_image_assets(
  p_worker_id text,
  p_limit integer default 100
)
returns table (
  analysis_id uuid,
  household_id uuid,
  asset_id uuid,
  object_path text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if char_length(btrim(coalesce(p_worker_id, ''))) not between 1 and 160 then
    raise exception using errcode = '22023', message = 'worker id is required';
  end if;
  if p_limit not between 1 and 500 then
    raise exception using errcode = '22023', message = 'purge claim limit must be between 1 and 500';
  end if;

  return query
  with claimable as (
    select a.id
      from public.analyses as a
     where a.purge_after <= now()
       and (
         a.purge_claimed_at is null
         or a.purge_claimed_at < now() - interval '15 minutes'
       )
       and exists (
         select 1
           from public.image_assets as ia
          where ia.analysis_id = a.id
            and ia.household_id = a.household_id
            and ia.status <> 'deleted'
            and (
              ia.status <> 'purge_pending'
              or ia.upload_authorization_expires_at <= now()
            )
       )
     order by a.purge_after, a.id
     for update skip locked
     limit p_limit
  ), claimed as (
    update public.analyses as a
       set status = case
             when a.status = 'created' then 'expired'::public.analysis_status
             else a.status
           end,
           completed_at = case
             when a.status = 'created' then coalesce(a.completed_at, now())
             else a.completed_at
           end,
           purge_claimed_at = now(),
           purge_claimed_by = btrim(p_worker_id)
      from claimable as c
     where a.id = c.id
    returning a.id, a.household_id
  ), marked as (
    update public.image_assets as ia
       set status = 'purge_pending',
           upload_authorization_expires_at = case
             when ia.status = 'purge_pending'
               or ia.upload_authorization_expires_at <= now()
             then ia.upload_authorization_expires_at
             else greatest(
               ia.upload_authorization_expires_at,
               now() + interval '2 hours 15 minutes'
             )
           end
      from claimed as c
     where ia.analysis_id = c.id
       and ia.household_id = c.household_id
       and ia.status <> 'deleted'
    returning ia.analysis_id, ia.household_id, ia.id, ia.object_path
  )
  select m.analysis_id, m.household_id, m.id, m.object_path
    from marked as m
   order by m.analysis_id, m.id;
end;
$$;

create function public.complete_raw_image_purge(p_asset_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  updated_count integer;
begin
  if p_asset_ids is null or cardinality(p_asset_ids) < 1 or cardinality(p_asset_ids) > 500 then
    raise exception using errcode = '22023', message = 'between 1 and 500 asset IDs are required';
  end if;

  update public.image_assets as ia
     set status = 'deleted'
   where ia.id = any(p_asset_ids)
     and ia.status = 'purge_pending'
     and ia.upload_authorization_expires_at <= now()
     and not exists (
       select 1
         from storage.objects as so
        where so.bucket_id = ia.bucket_id
          and so.name = ia.object_path
     );
  get diagnostics updated_count = row_count;
  return updated_count;
end;
$$;

-- Household erasure is intentionally two-phase because PostgreSQL cannot
-- atomically delete bytes held by the Storage service. The owner request below
-- immediately quarantines the tenant (current_household_id stops resolving),
-- claims every known raw path, and returns a complete deletion manifest. A
-- trusted service deletes those objects and only then calls the finalizer.
create function public.request_household_deletion()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_household_id uuid;
  prior_requested_at timestamptz;
  purge_paths jsonb;
  finalize_after timestamptz;
begin
  if actor_id is null then
    raise exception using errcode = '28000', message = 'authenticated household owner required';
  end if;

  -- Query membership directly so an idempotent retry still works after the
  -- first call has quarantined this household from normal tenant helpers.
  select h.id, h.deletion_requested_at
    into actor_household_id, prior_requested_at
    from public.households as h
    join public.household_members as hm
      on hm.household_id = h.id
     and hm.user_id = actor_id
   where hm.role = 'owner'
   for update of h;
  if not found then
    raise exception using errcode = '42501', message = 'active or deletion-pending household owner required';
  end if;

  if prior_requested_at is null then
    update public.households
       set deletion_requested_at = now(),
           deletion_requested_by = actor_id
     where id = actor_household_id;
  end if;

  -- Mark all relational images and reserve the purge lease for the erasure
  -- worker. A failed erasure is recoverable by the normal sweeper after 15 min.
  update public.analyses
     set purge_after = least(purge_after, now()),
         purge_claimed_at = now(),
         purge_claimed_by = 'household-erasure:' || actor_id::text
   where household_id = actor_household_id
     and exists (
       select 1
         from public.image_assets as ia
        where ia.analysis_id = analyses.id
          and ia.household_id = analyses.household_id
          and ia.status <> 'deleted'
     );

  update public.image_assets
     set status = case
       when status = 'deleted' then 'deleted'::public.image_asset_status
       else 'purge_pending'::public.image_asset_status
     end,
         upload_authorization_expires_at = case
           when prior_requested_at is not null or status = 'deleted'
             then upload_authorization_expires_at
           else greatest(
             upload_authorization_expires_at,
             now() + interval '2 hours 15 minutes'
           )
         end
   where household_id = actor_household_id;

  -- Include both relational paths and prefix-scoped Storage rows so an orphaned
  -- object cannot be silently omitted from the service deletion manifest.
  with paths as (
    select ia.object_path as object_path
      from public.image_assets as ia
     where ia.household_id = actor_household_id
       and ia.status <> 'deleted'
    union
    select so.name as object_path
      from storage.objects as so
     where so.bucket_id = 'raw-images'
       and so.name like actor_household_id::text || '/%'
  )
  select coalesce(jsonb_agg(p.object_path order by p.object_path), '[]'::jsonb)
    into purge_paths
    from paths as p;

  select greatest(
    h.deletion_requested_at + interval '2 hours 15 minutes',
    coalesce(max(ia.upload_authorization_expires_at), h.deletion_requested_at)
  )
    into finalize_after
    from public.households as h
    left join public.image_assets as ia on ia.household_id = h.id
   where h.id = actor_household_id
   group by h.deletion_requested_at;

  return jsonb_build_object(
    'householdId', actor_household_id,
    'bucketId', 'raw-images',
    'objectPaths', purge_paths,
    'status', 'deletion_pending',
    'finalizeAfter', finalize_after,
    'replayed', prior_requested_at is not null
  );
end;
$$;

create function public.finalize_household_deletion(p_household_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_at timestamptz;
begin
  if p_household_id is null then
    raise exception using errcode = '22023', message = 'household id is required';
  end if;

  select h.deletion_requested_at
    into requested_at
    from public.households as h
   where h.id = p_household_id
   for update;
  if not found then
    return jsonb_build_object(
      'householdId', p_household_id,
      'deleted', false,
      'replayed', true
    );
  end if;
  if requested_at is null then
    raise exception using errcode = '42501', message = 'household deletion has not been requested by an owner';
  end if;

  if requested_at > now() - interval '2 hours 15 minutes' then
    raise exception using
      errcode = '55000',
      message = 'household erasure is waiting for pre-quarantine signed upload authorizations to expire';
  end if;

  if exists (
    select 1
      from public.image_assets as ia
     where ia.household_id = p_household_id
       and ia.upload_authorization_expires_at > now()
  ) then
    raise exception using
      errcode = '55000',
      message = 'signed upload authorizations have not expired; household erasure cannot yet be finalized';
  end if;

  -- Block concurrent Storage metadata writes for the duration of the final
  -- verification/delete transaction. Previously minted upload tokens must also
  -- be short-lived and expired by the caller before finalization.
  lock table storage.objects in share mode;
  if exists (
    select 1
      from storage.objects as so
     where so.bucket_id = 'raw-images'
       and so.name like p_household_id::text || '/%'
  ) then
    raise exception using
      errcode = '55000',
      message = 'raw image objects remain; delete the returned manifest before finalizing household erasure';
  end if;

  perform set_config('foodtopia.erasing_household', p_household_id::text, true);

  -- Restrict FKs and immutable audit triggers require a deliberate child-first
  -- order. The transaction-local marker permits DELETE only for this household.
  delete from public.cook_reconciliations where household_id = p_household_id;
  delete from public.analysis_candidates where household_id = p_household_id;
  delete from public.inventory_events where household_id = p_household_id;
  delete from public.inventory_commands where household_id = p_household_id;
  delete from public.inventory_lots where household_id = p_household_id;
  delete from public.product_events where household_id = p_household_id;
  delete from public.privacy_consents where household_id = p_household_id;
  delete from public.households where id = p_household_id;

  return jsonb_build_object(
    'householdId', p_household_id,
    'deleted', true,
    'replayed', false
  );
end;
$$;

revoke all on function public.apply_cook_reconciliation(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.apply_cook_reconciliation(uuid, jsonb) to authenticated;
revoke all on function public.claim_expired_image_assets(text, integer) from public, anon, authenticated;
revoke all on function public.complete_raw_image_purge(uuid[]) from public, anon, authenticated;
grant execute on function public.claim_expired_image_assets(text, integer) to service_role;
grant execute on function public.complete_raw_image_purge(uuid[]) to service_role;
revoke all on function public.request_household_deletion() from public, anon, authenticated;
revoke all on function public.finalize_household_deletion(uuid) from public, anon, authenticated;
grant execute on function public.request_household_deletion() to authenticated;
grant execute on function public.finalize_household_deletion(uuid) to service_role;

comment on function public.apply_cook_reconciliation(uuid, jsonb) is
  'All-or-nothing cook reconciliation: locks every household lot, checks optimistic versions, records immutable reconciliations, and journals inventory mutations.';
comment on function public.claim_expired_image_assets(text, integer) is
  'Service-only raw-image retention queue: one-hour incomplete-upload expiry, 24-hour completed-upload maximum, immediate apply/cancel purge, SKIP LOCKED, and a reclaimable lease.';
comment on function public.request_household_deletion() is
  'Owner-only phase one: quarantines the caller household, claims raw assets, and returns all relational plus prefix-scoped Storage object paths. No household input is accepted.';
comment on function public.finalize_household_deletion(uuid) is
  'Service-only phase two: refuses while any raw-images object remains, then transactionally erases the deletion-pending tenant and immutable audit rows.';

-- Grants are intentionally narrow. Direct client mutation is allowed only for
-- low-risk tenant rows whose WITH CHECK re-derives both tenant and actor. Core
-- inventory, analysis review, membership, and invitation state mutate only via
-- the vetted RPCs above (or a server-side service-role worker).
revoke all on all tables in schema public from public, anon, authenticated;

grant select on public.profiles to authenticated;
grant update (display_name, avatar_url, timezone) on public.profiles to authenticated;
grant select on public.households to authenticated;
grant update (name) on public.households to authenticated;
grant select on public.household_members to authenticated;
grant select on public.privacy_consents to authenticated;
grant select on public.food_concepts to authenticated;
grant select, insert, update, delete on public.food_aliases to authenticated;
grant select on public.inventory_lots, public.inventory_commands, public.inventory_events to authenticated;
grant select on public.analyses to authenticated;
grant select on public.image_assets to authenticated;
grant select on public.analysis_candidates to authenticated;
grant select on public.recipes, public.recipe_ingredients to anon, authenticated;
grant insert, update, delete on public.recipes, public.recipe_ingredients to authenticated;
grant select, insert, update on public.household_preferences to authenticated;
grant select, insert on public.cook_sessions to authenticated;
grant select on public.cook_reconciliations to authenticated;

alter table public.profiles enable row level security;
alter table public.beta_invites enable row level security;
alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.privacy_consents enable row level security;
alter table public.api_rate_limits enable row level security;
alter table public.household_invites enable row level security;
alter table public.food_concepts enable row level security;
alter table public.food_aliases enable row level security;
alter table public.inventory_lots enable row level security;
alter table public.inventory_commands enable row level security;
alter table public.inventory_events enable row level security;
alter table public.analyses enable row level security;
alter table public.image_assets enable row level security;
alter table public.analysis_candidates enable row level security;
alter table public.recipes enable row level security;
alter table public.recipe_ingredients enable row level security;
alter table public.household_preferences enable row level security;
alter table public.cook_sessions enable row level security;
alter table public.cook_reconciliations enable row level security;
alter table public.product_events enable row level security;

create policy profiles_select_self on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- No beta_invites policy: tokens and the invite roster are never client-readable.

create policy households_select_member on public.households
  for select to authenticated
  using (private.is_household_member(id));
create policy households_update_owner on public.households
  for update to authenticated
  using (private.has_household_role(id, array['owner']::public.household_role[]))
  with check (private.has_household_role(id, array['owner']::public.household_role[]));

create policy household_members_select_household on public.household_members
  for select to authenticated
  using (private.is_household_member(household_id));
-- No INSERT/UPDATE/DELETE policies: membership and role changes require vetted RPCs.

create policy privacy_consents_select_self on public.privacy_consents
  for select to authenticated
  using (
    user_id = (select auth.uid())
    and household_id = private.current_household_id()
  );
-- No mutation policies: record_privacy_consent is the only authenticated write
-- path, and consent evidence is immutable until the household erasure flow.

-- No api_rate_limits policies or direct grants: consume_rate_limit is the only
-- client-visible boundary and returns only the caller's current allowance.

-- No household_invites SELECT policy: list_household_invites returns a safe
-- household-member projection that never exposes token hashes.

create policy food_concepts_select_authenticated on public.food_concepts
  for select to authenticated
  using (true);
-- No mutation policy: global concepts are curated by trusted server tooling only.

create policy food_aliases_select_visible on public.food_aliases
  for select to authenticated
  using (scope = 'global' or private.is_household_member(household_id));
create policy food_aliases_insert_household on public.food_aliases
  for insert to authenticated
  with check (
    scope = 'household'
    and household_id = private.current_household_id()
    and created_by = (select auth.uid())
  );
create policy food_aliases_update_household on public.food_aliases
  for update to authenticated
  using (scope = 'household' and private.is_household_member(household_id))
  with check (
    scope = 'household'
    and household_id = private.current_household_id()
    and created_by = (select auth.uid())
  );
create policy food_aliases_delete_household on public.food_aliases
  for delete to authenticated
  using (scope = 'household' and private.is_household_member(household_id));

create policy inventory_lots_select_household on public.inventory_lots
  for select to authenticated
  using (private.is_household_member(household_id));
create policy inventory_commands_select_household on public.inventory_commands
  for select to authenticated
  using (private.is_household_member(household_id));
create policy inventory_events_select_household on public.inventory_events
  for select to authenticated
  using (private.is_household_member(household_id));
-- No direct mutation policies: apply_inventory_command owns all three writes.

create policy analyses_select_household on public.analyses
  for select to authenticated
  using (private.is_household_member(household_id));
-- create_analysis is the only authenticated insertion path, ensuring that the
-- analysis and all private object descriptors commit together.

create policy image_assets_select_household on public.image_assets
  for select to authenticated
  using (private.is_household_member(household_id));
-- Image asset rows are inserted only by create_analysis or the service role.

create policy analysis_candidates_select_household on public.analysis_candidates
  for select to authenticated
  using (private.is_household_member(household_id));
-- Worker/service role writes proposals; users review them only through the atomic RPC.

create policy recipes_select_published on public.recipes
  for select to anon, authenticated
  using (visibility = 'published' and rights_status = 'reviewed');
create policy recipes_select_household on public.recipes
  for select to authenticated
  using (visibility = 'household' and private.is_household_member(household_id));
create policy recipes_insert_household on public.recipes
  for insert to authenticated
  with check (
    visibility = 'household'
    and household_id = private.current_household_id()
    and created_by = (select auth.uid())
  );
create policy recipes_update_household on public.recipes
  for update to authenticated
  using (visibility = 'household' and private.is_household_member(household_id))
  with check (
    visibility = 'household'
    and household_id = private.current_household_id()
    and created_by = (select auth.uid())
  );
create policy recipes_delete_household on public.recipes
  for delete to authenticated
  using (visibility = 'household' and private.is_household_member(household_id));

create policy recipe_ingredients_select_published on public.recipe_ingredients
  for select to anon, authenticated
  using (
    exists (
      select 1
        from public.recipes as r
       where r.id = recipe_ingredients.recipe_id
         and r.visibility = 'published'
         and r.rights_status = 'reviewed'
    )
  );
create policy recipe_ingredients_select_household on public.recipe_ingredients
  for select to authenticated
  using (
    exists (
      select 1
        from public.recipes as r
       where r.id = recipe_ingredients.recipe_id
         and r.visibility = 'household'
         and private.is_household_member(r.household_id)
    )
  );
create policy recipe_ingredients_insert_household on public.recipe_ingredients
  for insert to authenticated
  with check (
    household_id = private.current_household_id()
    and exists (
      select 1
        from public.recipes as r
       where r.id = recipe_ingredients.recipe_id
         and r.visibility = 'household'
         and r.household_id = private.current_household_id()
    )
  );
create policy recipe_ingredients_update_household on public.recipe_ingredients
  for update to authenticated
  using (private.is_household_member(household_id))
  with check (
    household_id = private.current_household_id()
    and exists (
      select 1
        from public.recipes as r
       where r.id = recipe_ingredients.recipe_id
         and r.visibility = 'household'
         and r.household_id = private.current_household_id()
    )
  );
create policy recipe_ingredients_delete_household on public.recipe_ingredients
  for delete to authenticated
  using (private.is_household_member(household_id));

create policy household_preferences_select_household on public.household_preferences
  for select to authenticated
  using (private.is_household_member(household_id));
create policy household_preferences_insert_household on public.household_preferences
  for insert to authenticated
  with check (
    household_id = private.current_household_id()
    and updated_by = (select auth.uid())
  );
create policy household_preferences_update_household on public.household_preferences
  for update to authenticated
  using (private.is_household_member(household_id))
  with check (
    household_id = private.current_household_id()
    and updated_by = (select auth.uid())
  );

create policy cook_sessions_select_household on public.cook_sessions
  for select to authenticated
  using (private.is_household_member(household_id));
create policy cook_sessions_insert_household on public.cook_sessions
  for insert to authenticated
  with check (
    household_id = private.current_household_id()
    and started_by = (select auth.uid())
    and status = 'active'
  );
-- Cook-session completion is reserved for apply_cook_reconciliation so status,
-- optimistic inventory versions, immutable changes, and events stay atomic.

create policy cook_reconciliations_select_household on public.cook_reconciliations
  for select to authenticated
  using (private.is_household_member(household_id));
-- Reconciliation writes are append-only and reserved for an atomic server/RPC flow.

-- No product_events policies or direct grants. record_product_event is the
-- only authenticated write boundary and rejects arbitrary text/content fields.

-- Realtime broadcasts only rows the subscriber may SELECT. Supabase Realtime
-- applies table RLS for authenticated Postgres Changes subscriptions; adding
-- only these tenant tables makes that guarantee explicit and auditable.
alter table public.inventory_lots replica identity full;
alter table public.inventory_events replica identity full;
alter table public.analyses replica identity full;
alter table public.analysis_candidates replica identity full;
alter table public.cook_sessions replica identity full;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table
      public.inventory_lots,
      public.inventory_events,
      public.analyses,
      public.analysis_candidates,
      public.cook_sessions;
  end if;
exception
  when duplicate_object then null;
end
$$;

-- Private raw image storage. The relational asset row must exist before upload.
-- Storage object names cannot be chosen freely: path segments must match that
-- row, its analysis, uploader, and current household membership.
insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
) values (
  'raw-images',
  'raw-images',
  false,
  5000000,
  array['image/jpeg']::text[]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create function private.can_upload_raw_image(candidate_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.image_assets as ia
      join public.analyses as a
        on a.id = ia.analysis_id
       and a.household_id = ia.household_id
     where ia.object_path = candidate_path
       and ia.bucket_id = 'raw-images'
       and ia.household_id = private.current_household_id()
       and ia.created_by = (select auth.uid())
       and ia.status = 'pending_upload'
       and a.status = 'created'
  )
$$;

create function private.can_read_raw_image(candidate_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.image_assets as ia
      join public.analyses as a
        on a.id = ia.analysis_id
       and a.household_id = ia.household_id
     where ia.object_path = candidate_path
       and ia.bucket_id = 'raw-images'
       and ia.household_id = private.current_household_id()
       and (
         ia.status in ('uploaded', 'processing', 'processed')
         or (
           ia.status = 'pending_upload'
           and ia.created_by = (select auth.uid())
           and a.status = 'created'
         )
       )
  )
$$;

create function private.can_delete_raw_image(candidate_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.image_assets as ia
      join public.analyses as a
        on a.id = ia.analysis_id
       and a.household_id = ia.household_id
     where ia.object_path = candidate_path
       and ia.bucket_id = 'raw-images'
       and ia.household_id = private.current_household_id()
       and ia.created_by = (select auth.uid())
       and ia.status = 'pending_upload'
       and a.status = 'created'
  )
$$;

revoke all on function private.can_upload_raw_image(text) from public, anon, authenticated;
revoke all on function private.can_read_raw_image(text) from public, anon, authenticated;
revoke all on function private.can_delete_raw_image(text) from public, anon, authenticated;
grant execute on function private.can_upload_raw_image(text) to authenticated;
grant execute on function private.can_read_raw_image(text) to authenticated;
grant execute on function private.can_delete_raw_image(text) to authenticated;

drop policy if exists raw_images_insert_own_pending_asset on storage.objects;
create policy raw_images_insert_own_pending_asset on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'raw-images'
    and private.can_upload_raw_image(name)
  );

drop policy if exists raw_images_select_household_asset on storage.objects;
create policy raw_images_select_household_asset on storage.objects
  for select to authenticated
  using (
    bucket_id = 'raw-images'
    and private.can_read_raw_image(name)
  );

drop policy if exists raw_images_delete_uploader_or_owner on storage.objects;
drop policy if exists raw_images_delete_own_pending_asset on storage.objects;
create policy raw_images_delete_own_pending_asset on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'raw-images'
    and private.can_delete_raw_image(name)
  );

-- No storage UPDATE policy: object replacement/upsert is intentionally denied.
-- Signed upload/read operations execute the same storage RLS when issued with
-- the user client. Service-role signing must first call requireHouseholdSession
-- and verify the image_assets row; the browser never receives the service key.

comment on function private.can_upload_raw_image(text) is
  'Storage INSERT authorization: exact canonical path, pending relational asset, uploader auth.uid(), current household, and created analysis are all required.';
comment on function private.can_read_raw_image(text) is
  'Storage SELECT authorization used by downloads and user-scoped signed URL creation; membership is derived from auth.uid().';
comment on function private.can_delete_raw_image(text) is
  'Storage DELETE authorization is limited to the uploader own pending asset while its analysis is still created; trusted purge workers use service role after a DB transition.';
