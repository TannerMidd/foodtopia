-- Household-selectable AI providers. Credentials are deliberately isolated
-- behind service-only RPCs; authenticated clients can only receive a
-- secret-free configuration DTO.

create table public.household_ai_settings (
  household_id uuid primary key references public.households (id) on delete cascade,
  provider text not null default 'openai',
  vision_model_id text not null default 'gpt-5.6-terra',
  recipe_model_id text not null default 'gpt-5.6-luna',
  credential_source text not null default 'platform',
  updated_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  constraint household_ai_settings_provider check (provider in ('openai', 'openrouter')),
  constraint household_ai_settings_vision_model_id check (
    char_length(vision_model_id) between 1 and 160
    and vision_model_id ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]*$'
  ),
  constraint household_ai_settings_recipe_model_id check (
    char_length(recipe_model_id) between 1 and 160
    and recipe_model_id ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]*$'
  ),
  constraint household_ai_settings_credential_source check (credential_source in ('platform', 'household')),
  constraint household_ai_settings_version_positive check (version >= 1),
  constraint household_ai_settings_household_provider_unique unique (household_id, provider)
);

create table private.household_ai_credentials (
  household_id uuid primary key,
  provider text not null,
  encryption_key_id text not null,
  encrypted_api_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint household_ai_credentials_provider check (provider in ('openai', 'openrouter')),
  constraint household_ai_credentials_key_id check (
    char_length(encryption_key_id) between 1 and 64
    and encryption_key_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]*$'
  ),
  constraint household_ai_credentials_ciphertext check (
    char_length(encrypted_api_key) between 24 and 8192
    and encrypted_api_key ~ '^[A-Za-z0-9][A-Za-z0-9._~-]*$'
  ),
  constraint household_ai_credentials_settings_fk foreign key (household_id, provider)
    references public.household_ai_settings (household_id, provider)
    on delete cascade
    deferrable initially deferred
);

comment on table public.household_ai_settings is
  'One secret-free provider configuration per household. Browser access is exclusively through vetted RPCs.';
comment on table private.household_ai_credentials is
  'Encrypted household API-key envelopes. No browser role receives table or function access to this relation.';

create trigger household_ai_settings_touch
before update on public.household_ai_settings
for each row execute function private.touch_versioned_row();

create function private.touch_household_ai_credential()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

revoke all on function private.touch_household_ai_credential() from public, anon, authenticated;

create trigger household_ai_credentials_touch
before update on private.household_ai_credentials
for each row execute function private.touch_household_ai_credential();

-- A single deferred invariant is attached to both sides of the relationship.
-- Deferral lets the atomic write RPC replace a provider and its envelope in one
-- transaction while still rejecting any durable mismatched configuration.
create function private.enforce_household_ai_credential_shape()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  target_household_id uuid;
  settings_row public.household_ai_settings%rowtype;
  credential_count integer;
begin
  target_household_id := case
    when tg_op = 'DELETE' then old.household_id
    else new.household_id
  end;

  select *
    into settings_row
    from public.household_ai_settings
   where household_id = target_household_id;

  -- A household cascade has already removed the parent settings row.
  if not found then
    return null;
  end if;

  select count(*)
    into credential_count
    from private.household_ai_credentials as credential
   where credential.household_id = target_household_id
     and credential.provider = settings_row.provider;

  if settings_row.credential_source = 'household' and credential_count <> 1 then
    raise exception using errcode = '23514', message = 'household credential source requires exactly one matching credential';
  end if;
  if settings_row.credential_source = 'platform' and credential_count <> 0 then
    raise exception using errcode = '23514', message = 'platform credential source cannot retain a household credential';
  end if;

  return null;
end;
$$;

revoke all on function private.enforce_household_ai_credential_shape() from public, anon, authenticated;

create constraint trigger household_ai_settings_credential_shape
after insert or update or delete on public.household_ai_settings
deferrable initially deferred
for each row execute function private.enforce_household_ai_credential_shape();

create constraint trigger household_ai_credentials_credential_shape
after insert or update or delete on private.household_ai_credentials
deferrable initially deferred
for each row execute function private.enforce_household_ai_credential_shape();

create function private.create_household_ai_settings()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  insert into public.household_ai_settings (household_id, updated_by)
  values (new.id, new.created_by)
  on conflict (household_id) do nothing;
  return new;
end;
$$;

revoke all on function private.create_household_ai_settings() from public, anon, authenticated;

create trigger households_create_ai_settings
after insert on public.households
for each row execute function private.create_household_ai_settings();

-- Backfill before the invariant can run at commit. Existing households are
-- intentionally platform-backed until an owner explicitly supplies an
-- encrypted household credential.
insert into public.household_ai_settings (household_id, updated_by)
select h.id, h.created_by
  from public.households as h
on conflict (household_id) do nothing;

alter table public.household_ai_settings enable row level security;
alter table private.household_ai_credentials enable row level security;
revoke all on table public.household_ai_settings from public, anon, authenticated;
revoke all on table private.household_ai_credentials from public, anon, authenticated;

create function private.household_ai_settings_dto(p_settings public.household_ai_settings)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'provider', p_settings.provider,
    'visionModelId', p_settings.vision_model_id,
    'recipeModelId', p_settings.recipe_model_id,
    'credentialSource', p_settings.credential_source,
    'householdCredentialConfigured', exists (
      select 1
        from private.household_ai_credentials as credential
       where credential.household_id = p_settings.household_id
         and credential.provider = p_settings.provider
    ),
    'updatedAt', p_settings.updated_at,
    'version', p_settings.version
  )
$$;

revoke all on function private.household_ai_settings_dto(public.household_ai_settings)
  from public, anon, authenticated;

create function public.get_household_ai_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_household_id uuid := private.current_household_id();
  settings_row public.household_ai_settings%rowtype;
begin
  if auth.uid() is null or actor_household_id is null then
    raise exception using errcode = '28000', message = 'active household session required';
  end if;

  select * into settings_row
    from public.household_ai_settings
   where household_id = actor_household_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'household AI settings not found';
  end if;
  return private.household_ai_settings_dto(settings_row);
end;
$$;

create function public.write_household_ai_settings(
  p_provider text,
  p_vision_model_id text,
  p_recipe_model_id text,
  p_credential_source text,
  p_credential_action text,
  p_encrypted_api_key text,
  p_encryption_key_id text,
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
  settings_row public.household_ai_settings%rowtype;
begin
  if actor_id is null or actor_household_id is null then
    raise exception using errcode = '28000', message = 'active household session required';
  end if;
  if not private.has_household_role(actor_household_id, array['owner']::public.household_role[]) then
    raise exception using errcode = '42501', message = 'owner household role required';
  end if;
  if p_provider is null or p_provider not in ('openai', 'openrouter') then
    raise exception using errcode = '22023', message = 'unsupported AI provider';
  end if;
  if p_vision_model_id is null
    or char_length(p_vision_model_id) not between 1 and 160
    or p_vision_model_id !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]*$'
  then
    raise exception using errcode = '22023', message = 'vision model ID is invalid';
  end if;
  if p_recipe_model_id is null
    or char_length(p_recipe_model_id) not between 1 and 160
    or p_recipe_model_id !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]*$'
  then
    raise exception using errcode = '22023', message = 'recipe model ID is invalid';
  end if;
  if p_credential_source is null or p_credential_source not in ('platform', 'household') then
    raise exception using errcode = '22023', message = 'credential source is invalid';
  end if;
  if p_credential_action is null or p_credential_action not in ('retain', 'replace', 'clear') then
    raise exception using errcode = '22023', message = 'credential action is invalid';
  end if;
  if p_expected_version is null or p_expected_version < 0 then
    raise exception using errcode = '22023', message = 'expected settings version is required';
  end if;

  select * into settings_row
    from public.household_ai_settings
   where household_id = actor_household_id
   for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'household AI settings not found';
  end if;
  if settings_row.version <> p_expected_version then
    raise exception using errcode = '40001', message = 'household AI settings version conflict';
  end if;

  if p_credential_action = 'retain' then
    if p_provider <> settings_row.provider or p_credential_source <> settings_row.credential_source then
      raise exception using errcode = '22023', message = 'retain requires the current provider and credential source';
    end if;
    if p_encrypted_api_key is not null or p_encryption_key_id is not null then
      raise exception using errcode = '22023', message = 'retain cannot include a credential';
    end if;
  elsif p_credential_action = 'replace' then
    if p_credential_source <> 'household'
      or p_encryption_key_id is null
      or char_length(p_encryption_key_id) not between 1 and 64
      or p_encryption_key_id !~ '^[A-Za-z0-9][A-Za-z0-9_-]*$'
      or p_encrypted_api_key is null
      or char_length(p_encrypted_api_key) not between 24 and 8192
      or p_encrypted_api_key !~ '^[A-Za-z0-9][A-Za-z0-9._~-]*$'
    then
      raise exception using errcode = '22023', message = 'replace requires a valid encrypted household credential';
    end if;
  else
    if p_credential_source <> 'platform' then
      raise exception using errcode = '22023', message = 'clear requires the platform credential source';
    end if;
    if p_encrypted_api_key is not null or p_encryption_key_id is not null then
      raise exception using errcode = '22023', message = 'clear cannot include a credential';
    end if;
  end if;

  if settings_row.credential_source = 'household'
    and p_credential_source = 'platform'
    and p_credential_action <> 'clear'
  then
    raise exception using errcode = '22023', message = 'switching to platform credentials requires clear';
  end if;
  if settings_row.provider <> p_provider
    and settings_row.credential_source = 'household'
    and p_credential_action <> 'replace'
  then
    raise exception using errcode = '22023', message = 'changing a household-key provider requires replace';
  end if;

  if p_credential_action = 'clear' then
    delete from private.household_ai_credentials where household_id = actor_household_id;
  end if;

  update public.household_ai_settings
     set provider = p_provider,
         vision_model_id = p_vision_model_id,
         recipe_model_id = p_recipe_model_id,
         credential_source = p_credential_source,
         updated_by = actor_id
   where household_id = actor_household_id
  returning * into settings_row;

  if p_credential_action = 'replace' then
    insert into private.household_ai_credentials (
      household_id, provider, encryption_key_id, encrypted_api_key
    ) values (
      actor_household_id, p_provider, p_encryption_key_id, p_encrypted_api_key
    )
    on conflict (household_id) do update
       set provider = excluded.provider,
           encryption_key_id = excluded.encryption_key_id,
           encrypted_api_key = excluded.encrypted_api_key;
  end if;

  return private.household_ai_settings_dto(settings_row);
end;
$$;

create function public.get_household_ai_runtime_config(p_household_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  settings_row public.household_ai_settings%rowtype;
  credential_row private.household_ai_credentials%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'service role required';
  end if;
  if p_household_id is null then
    raise exception using errcode = '22023', message = 'household ID is required';
  end if;
  select * into settings_row
    from public.household_ai_settings
   where household_id = p_household_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'household AI settings not found';
  end if;
  select * into credential_row
    from private.household_ai_credentials
   where household_id = p_household_id
     and provider = settings_row.provider;

  return jsonb_build_object(
    'provider', settings_row.provider,
    'visionModelId', settings_row.vision_model_id,
    'recipeModelId', settings_row.recipe_model_id,
    'credentialSource', settings_row.credential_source,
    'encryptedApiKey', credential_row.encrypted_api_key,
    'encryptionKeyId', credential_row.encryption_key_id,
    'updatedAt', settings_row.updated_at,
    'version', settings_row.version
  );
end;
$$;

create function public.rotate_household_ai_credential(
  p_household_id uuid,
  p_expected_provider text,
  p_expected_encryption_key_id text,
  p_expected_encrypted_api_key text,
  p_new_encryption_key_id text,
  p_new_encrypted_api_key text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  settings_row public.household_ai_settings%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'service role required';
  end if;
  if p_household_id is null
    or p_expected_provider is null
    or p_expected_provider not in ('openai', 'openrouter')
    or p_new_encryption_key_id is null
    or char_length(p_new_encryption_key_id) not between 1 and 64
    or p_new_encryption_key_id !~ '^[A-Za-z0-9][A-Za-z0-9_-]*$'
    or p_new_encrypted_api_key is null
    or char_length(p_new_encrypted_api_key) not between 24 and 8192
    or p_new_encrypted_api_key !~ '^[A-Za-z0-9][A-Za-z0-9._~-]*$'
  then
    raise exception using errcode = '22023', message = 'credential rotation input is invalid';
  end if;

  select * into settings_row
    from public.household_ai_settings
   where household_id = p_household_id
   for update;
  if not found
    or settings_row.provider <> p_expected_provider
    or settings_row.credential_source <> 'household'
  then
    return false;
  end if;

  update private.household_ai_credentials
     set encryption_key_id = p_new_encryption_key_id,
         encrypted_api_key = p_new_encrypted_api_key
   where household_id = p_household_id
     and provider = p_expected_provider
     and encryption_key_id is not distinct from p_expected_encryption_key_id
     and encrypted_api_key is not distinct from p_expected_encrypted_api_key;

  return found;
end;
$$;

revoke all on function public.get_household_ai_settings() from public, anon, authenticated;
revoke all on function public.write_household_ai_settings(text, text, text, text, text, text, text, integer)
  from public, anon, authenticated;
revoke all on function public.get_household_ai_runtime_config(uuid) from public, anon, authenticated;
revoke all on function public.rotate_household_ai_credential(uuid, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.get_household_ai_settings() to authenticated;
grant execute on function public.write_household_ai_settings(text, text, text, text, text, text, text, integer)
  to authenticated;
grant execute on function public.get_household_ai_runtime_config(uuid) to service_role;
grant execute on function public.rotate_household_ai_credential(uuid, text, text, text, text, text)
  to service_role;

comment on function public.get_household_ai_settings() is
  'Returns the active household provider configuration without encrypted credentials.';
comment on function public.write_household_ai_settings(text, text, text, text, text, text, text, integer) is
  'Owner-only, version-checked atomic provider/model/credential-envelope update. Plaintext credentials are never accepted.';
comment on function public.get_household_ai_runtime_config(uuid) is
  'Service-only runtime configuration resolver. Returns an encrypted envelope only when the source is household.';
comment on function public.rotate_household_ai_credential(uuid, text, text, text, text, text) is
  'Service-only compare-and-swap re-encryption primitive over the full existing credential envelope.';

-- New provider routing changes the first-scan disclosure. v1 rows remain as
-- historical audit evidence, but only v2 authorizes a new image analysis.
create or replace function public.record_privacy_consent(p_consent_version text)
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
  if p_consent_version is distinct from 'vision-v2' then
    raise exception using errcode = '22023', message = 'unsupported privacy consent version';
  end if;

  insert into public.privacy_consents (user_id, household_id, consent_version)
  values (actor_id, actor_household_id, p_consent_version)
  on conflict (user_id, consent_version) do nothing
  returning consented_at into recorded_at;
  get diagnostics inserted_count = row_count;

  if inserted_count = 0 then
    select pc.consented_at into recorded_at
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

create or replace function public.create_analysis(
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
    select 1 from public.privacy_consents as pc
     where pc.user_id = actor_id
       and pc.household_id = actor_household_id
       and pc.consent_version = 'vision-v2'
  ) then
    raise exception using errcode = '42501', message = 'vision-v2 privacy consent required before image analysis';
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
  if asset_indexes is distinct from array(select generate_series(0, asset_count - 1)::smallint) then
    raise exception using errcode = '22023', message = 'asset imageIndex values must be unique and contiguous from zero';
  end if;

  insert into public.analyses (id, household_id, status, image_count, idempotency_key, created_by)
  values (p_analysis_id, actor_household_id, 'created', asset_count, p_idempotency_key, actor_id)
  on conflict (id) do nothing;
  get diagnostics inserted_count = row_count;

  if inserted_count = 0 then
    select a.* into existing_analysis from public.analyses as a
     where a.id = p_analysis_id and a.household_id = actor_household_id;
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
    select public.consume_rate_limit('analysis_create', 10, 3600) into rate_limit_result;
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
        id, household_id, analysis_id, image_index, object_path,
        original_filename, content_type, byte_size, checksum_sha256, created_by
      ) values (
        asset_id, actor_household_id, p_analysis_id, asset_index,
        actor_household_id::text || '/' || actor_id::text || '/' || p_analysis_id::text || '/' || asset_id::text || '.jpg',
        asset_input ->> 'originalFilename', asset_input ->> 'contentType',
        nullif(asset_input ->> 'byteSize', '')::integer,
        nullif(lower(asset_input ->> 'checksumSha256'), ''), actor_id
      );
    end loop;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'assetId', ia.id, 'imageIndex', ia.image_index, 'objectPath', ia.object_path,
    'contentType', ia.content_type, 'byteSize', ia.byte_size
  ) order by ia.image_index), '[]'::jsonb)
    into response_assets
    from public.image_assets as ia
   where ia.analysis_id = p_analysis_id and ia.household_id = actor_household_id;

  if jsonb_array_length(response_assets) <> asset_count then
    raise exception using errcode = '23505', message = 'analysisId has already been used with different assets';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_assets) as requested(asset)
     where not exists (
       select 1 from public.image_assets as ia
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
    'analysisId', p_analysis_id, 'status', 'created',
    'assets', response_assets, 'replayed', inserted_count = 0
  );
end;
$$;

revoke all on function public.record_privacy_consent(text) from public, anon, authenticated;
grant execute on function public.record_privacy_consent(text) to authenticated;
revoke all on function public.create_analysis(uuid, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.create_analysis(uuid, jsonb, uuid) to authenticated;

comment on function public.record_privacy_consent(text) is
  'Idempotently records the current version-two provider-routing first-scan disclosure for the active household; v1 evidence remains historical.';
comment on function public.create_analysis(uuid, jsonb, uuid) is
  'Atomically creates an analysis only after the caller records the version-two provider-routing disclosure.';
