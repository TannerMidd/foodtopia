-- Admin-enabled accounts (open-beta signups approved at /admin/beta) hold no
-- personal beta invitation token, so the token-only bootstrap path left them
-- permanently unable to create a household. Keep the invitation-token path
-- unchanged and add a tokenless path gated on an administrator-enabled
-- profile; nothing here widens access for pending or disabled accounts.

create or replace function public.bootstrap_household(p_name text, p_beta_token text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_email text := lower(nullif(btrim(auth.jwt() ->> 'email'), ''));
  invite public.beta_invites%rowtype;
  has_token boolean := coalesce(btrim(coalesce(p_beta_token, '')), '') <> '';
  existing_household_id uuid;
  new_household_id uuid;
begin
  if actor_id is null or actor_email is null then
    raise exception using errcode = '28000', message = 'authenticated user with a verified email required';
  end if;
  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 80 then
    raise exception using errcode = '22023', message = 'household name must be between 1 and 80 characters';
  end if;

  if has_token then
    -- Invitation claim remains the operator's pre-approval path: a valid,
    -- unclaimed personal token enables the account on first bootstrap.
    if char_length(p_beta_token) not between 20 and 512 then
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

    update public.beta_invites
       set claimed_by = actor_id,
           claimed_at = coalesce(claimed_at, now())
     where id = invite.id;
  else
    -- Tokenless path: only an administrator-enabled profile may proceed.
    if not exists (
      select 1
        from public.profiles as p
       where p.id = actor_id
         and p.status = 'enabled'
    ) then
      raise exception using errcode = '28000', message = 'account is not enabled yet';
    end if;
  end if;

  update public.profiles
     set status = 'enabled',
         enabled_at = coalesce(enabled_at, clock_timestamp())
   where id = actor_id
     and status <> 'enabled';

  select hm.household_id
    into existing_household_id
    from public.household_members as hm
   where hm.user_id = actor_id;
  if found then
    if not has_token or invite.claimed_by = actor_id then
      return existing_household_id;
    end if;
    raise exception using errcode = '23505', message = 'V1 supports one household per user';
  end if;

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

comment on function public.bootstrap_household(text, text) is
  'Creates the caller''s sole household. With a personal beta invitation token, claims it and enables the account (legacy pre-approval path). Without one, requires an administrator-enabled profile so open-beta approvals can onboard.';
