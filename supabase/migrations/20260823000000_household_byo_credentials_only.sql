-- Household-supplied API keys become the only AI credential source. The
-- deployment never holds provider keys, so the 'platform' credential source is
-- removed entirely:
--   * existing rows migrate to 'household' (unconfigured until an owner saves
--     an encrypted key);
--   * the write RPC loses its credential-source parameter;
--   * 'clear' removes the stored household key directly instead of switching
--     to platform backing;
--   * the deferred shape invariant accepts zero credentials so an
--     unconfigured-but-BYO household is a valid durable state.

create or replace function private.enforce_household_ai_credential_shape()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- A household cascade has already removed one side of the relationship.
  if tg_op = 'DELETE' then
    select 1 from public.household_ai_settings
      where household_id = old.household_id;
    if not found then
      return null;
    end if;
  end if;

  -- A household either has not configured a key yet (zero rows) or stores
  -- exactly one encrypted envelope for its current provider. Uniqueness on
  -- private.household_ai_credentials(household_id) bounds the count above.
  return null;
end;
$$;

revoke all on function private.enforce_household_ai_credential_shape()
  from public, anon, authenticated;

update public.household_ai_settings set credential_source = 'household';

-- Flush the deferred shape triggers fired by the update above (the permissive
-- replacement accepts it) so ALTER TABLE below is not blocked by pending
-- trigger events.
set constraints all immediate;

alter table public.household_ai_settings
  alter column credential_source set default 'household';
alter table public.household_ai_settings
  drop constraint household_ai_settings_credential_source;
alter table public.household_ai_settings
  add constraint household_ai_settings_credential_source
    check (credential_source = 'household');

comment on column public.household_ai_settings.credential_source is
  'Always ''household''. The deployment never holds AI provider keys.';

create or replace function private.household_ai_settings_dto(p_settings public.household_ai_settings)
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

drop function public.write_household_ai_settings(
  text, text, text, text, text, text, text, integer
);

create function public.write_household_ai_settings(
  p_provider text,
  p_vision_model_id text,
  p_recipe_model_id text,
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
    if p_encrypted_api_key is not null or p_encryption_key_id is not null then
      raise exception using errcode = '22023', message = 'retain cannot include a credential';
    end if;
    if p_provider <> settings_row.provider then
      raise exception using errcode = '22023',
        message = 'retaining a household key requires keeping its provider';
    end if;
  elsif p_credential_action = 'replace' then
    if p_encryption_key_id is null
      or char_length(p_encryption_key_id) not between 1 and 64
      or p_encryption_key_id !~ '^[A-Za-z0-9][A-Za-z0-9_-]*$'
      or p_encrypted_api_key is null
      or char_length(p_encrypted_api_key) not between 24 and 8192
      or p_encrypted_api_key !~ '^[A-Za-z0-9][A-Za-z0-9._~-]*$'
    then
      raise exception using errcode = '22023', message = 'replace requires a valid encrypted household credential';
    end if;
  else
    if p_encrypted_api_key is not null or p_encryption_key_id is not null then
      raise exception using errcode = '22023', message = 'clear cannot include a credential';
    end if;
  end if;

  if p_credential_action = 'clear' then
    delete from private.household_ai_credentials where household_id = actor_household_id;
  end if;

  update public.household_ai_settings
     set provider = p_provider,
         vision_model_id = p_vision_model_id,
         recipe_model_id = p_recipe_model_id,
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

revoke all on function public.write_household_ai_settings(text, text, text, text, text, text, integer)
  from public, anon, authenticated;
grant execute on function public.write_household_ai_settings(text, text, text, text, text, text, integer)
  to authenticated;

create or replace function public.get_household_ai_runtime_config(p_household_id uuid)
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
    'encryptedApiKey', credential_row.encrypted_api_key,
    'encryptionKeyId', credential_row.encryption_key_id,
    'updatedAt', settings_row.updated_at,
    'version', settings_row.version
  );
end;
$$;

revoke all on function public.get_household_ai_runtime_config(uuid)
  from public, anon, authenticated;
grant execute on function public.get_household_ai_runtime_config(uuid) to service_role;
