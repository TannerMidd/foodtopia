-- OpenRouter exposes model aliases whose IDs contain `~` (for example,
-- provider/model~alias). The public Zod contract and discovery parser have
-- accepted those IDs since 20260814, but the durable table constraints and
-- owner-only write RPC still used the older character class. Align every
-- validation boundary so selecting a discovered alias can be saved.

alter table public.household_ai_settings
  drop constraint household_ai_settings_vision_model_id,
  drop constraint household_ai_settings_recipe_model_id;

alter table public.household_ai_settings
  add constraint household_ai_settings_vision_model_id check (
    char_length(vision_model_id) between 1 and 160
    and vision_model_id ~ '^[A-Za-z0-9~][A-Za-z0-9._:/~-]*$'
  ),
  add constraint household_ai_settings_recipe_model_id check (
    char_length(recipe_model_id) between 1 and 160
    and recipe_model_id ~ '^[A-Za-z0-9~][A-Za-z0-9._:/~-]*$'
  );

create or replace function public.write_household_ai_settings(
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
    or p_vision_model_id !~ '^[A-Za-z0-9~][A-Za-z0-9._:/~-]*$'
  then
    raise exception using errcode = '22023', message = 'vision model ID is invalid';
  end if;
  if p_recipe_model_id is null
    or char_length(p_recipe_model_id) not between 1 and 160
    or p_recipe_model_id !~ '^[A-Za-z0-9~][A-Za-z0-9._:/~-]*$'
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

comment on function public.write_household_ai_settings(text, text, text, text, text, text, integer) is
  'Owner-only, version-checked atomic provider/model/credential-envelope update. Accepts OpenRouter alias IDs containing ~; plaintext credentials are never accepted.';
