-- Trigger functions do not inherit a calling RPC's security-definer context.
-- Run both the initial settings write and the deferred invariant with their
-- locked-down table-owning role so legitimate authenticated owner RPCs can
-- commit. Neither function is directly executable by browser roles; both keep
-- an empty search_path and use fully qualified relation names.

alter function private.create_household_ai_settings()
  owner to postgres;

alter function private.create_household_ai_settings()
  security definer;

alter function private.enforce_household_ai_credential_shape()
  owner to postgres;

alter function private.enforce_household_ai_credential_shape()
  security definer;

revoke all on function private.create_household_ai_settings()
  from public, anon, authenticated;

revoke all on function private.enforce_household_ai_credential_shape()
  from public, anon, authenticated;

comment on function private.create_household_ai_settings() is
  'Private household trigger that creates the secret-free default AI route with table-owner privileges.';

comment on function private.enforce_household_ai_credential_shape() is
  'Private deferred AI credential invariant; security-definer execution permits trigger checks after authenticated owner RPCs return.';
