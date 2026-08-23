-- Open-beta admissions: self-serve signup with administrator enablement.
--
-- Signup policy moves from "pre-approved email required" to "open while the
-- beta signup window is open, pending until an administrator enables the
-- account". Personal beta-invite tokens and household invitations remain a
-- trusted pre-approval channel: accounts created against them are enabled
-- immediately. Nothing here widens client table privileges; profiles.status is
-- writable only by the table owner (service role / vetted SQL).

create type public.account_status as enum ('pending', 'enabled', 'disabled');

alter table public.profiles
  add column status public.account_status not null default 'pending',
  add column enabled_at timestamptz,
  add column enabled_by uuid references auth.users (id) on delete set null,
  add constraint profiles_enabled_shape check ((status = 'enabled') = (enabled_at is not null));

-- Every profile that exists before this migration was admitted through the
-- original invite-only gate, so it starts enabled at its creation time.
update public.profiles
   set status = 'enabled',
       enabled_at = created_at;

comment on column public.profiles.status is
  'Admission state. pending: signed up but not yet enabled by an administrator; enabled: full access; disabled: access revoked by an administrator.';

-- Global open-beta tap. Singleton row; no client grants or policies, so only
-- the service role and vetted definer functions can read or write it.
-- Seeded CLOSED so deploying this migration changes nothing for the running
-- app: with the window closed the hook admits exactly what it did before
-- (live invitation emails). The operator opens the window from /admin/beta
-- (or an equivalent service-role update) once the admissions build is live.
create table public.beta_signup_settings (
  id integer primary key default 1 check (id = 1),
  signups_open boolean not null default false,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 0,
  constraint beta_signup_settings_version_nonnegative check (version >= 0)
);

insert into public.beta_signup_settings (id, signups_open)
values (1, false)
on conflict (id) do nothing;

alter table public.beta_signup_settings enable row level security;

revoke all on public.beta_signup_settings from anon, authenticated;

create trigger beta_signup_settings_touch before update on public.beta_signup_settings
  for each row execute function private.touch_versioned_row();

comment on table public.beta_signup_settings is
  'Singleton switch for first-time open-beta signups. When closed, before_user_created admits only live invitation emails. The row is invisible to clients.';

-- Profile bootstrap now distinguishes trusted invitations from open signups.
create or replace function private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  candidate_name text;
  candidate_email text;
  trusted_invitation boolean := false;
begin
  candidate_name := nullif(btrim(coalesce(
    new.raw_user_meta_data ->> 'display_name',
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'name',
    ''
  )), '');
  candidate_email := lower(nullif(btrim(new.email), ''));

  -- A personal beta token or household invitation for this exact email is the
  -- operator's pre-approval: the account starts enabled. Everyone else signs
  -- up pending until an administrator enables them.
  if candidate_email is not null then
    select exists (
      select 1
        from public.beta_invites as bi
       where bi.email = candidate_email
         and bi.revoked_at is null
         and bi.claimed_by is null
         and bi.expires_at > now()
    ) or exists (
      select 1
        from public.household_invites as hi
       where hi.email = candidate_email
         and hi.status = 'pending'
         and hi.expires_at > now()
    )
    into trusted_invitation;
  end if;

  insert into public.profiles (id, display_name, status, enabled_at)
  values (
    new.id,
    case when candidate_name is null then null else left(candidate_name, 80) end,
    case when trusted_invitation then 'enabled' else 'pending' end::public.account_status,
    case when trusted_invitation then clock_timestamp() else null end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Signup admission now also honors the global open-beta window.
create or replace function public.before_user_created(event jsonb)
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
    or coalesce(
      (
        select bss.signups_open
          from public.beta_signup_settings as bss
         where bss.id = 1
      ),
      false
    )
  ) then
    return '{}'::jsonb;
  end if;

  return jsonb_build_object(
    'error',
    jsonb_build_object(
      'http_code', 403,
      'message', 'Foodtopia signups are closed right now.'
    )
  );
end;
$$;

comment on function public.before_user_created(jsonb) is
  'Configure as Auth Before User Created hook (pg-functions://postgres/public/before_user_created). Allows active normalized invitation emails plus any email while the singleton open-beta signup window is open; a missing settings row fails closed.';

-- Claiming a personal beta token remains an instant-enablement path even for
-- an account that signed up pending in the meantime.
create or replace function public.bootstrap_household(p_name text, p_beta_token text)
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

  update public.beta_invites
     set claimed_by = actor_id,
         claimed_at = coalesce(claimed_at, now())
   where id = invite.id;

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
    if invite.claimed_by = actor_id then
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
