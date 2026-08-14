-- Global, service-only fixed-window counters for the optional pre-auth admin
-- password endpoint. No IP address, username, email, or submitted credential
-- is stored. The endpoint is intentionally rare, so a global bucket is both a
-- privacy-preserving control and an effective brute-force bound.

create table private.pre_auth_rate_limits (
  bucket text not null,
  window_seconds integer not null,
  window_started_at timestamptz not null,
  request_count bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (bucket, window_seconds, window_started_at),
  constraint pre_auth_rate_limits_bucket check (
    bucket = 'admin_password_login'
  ),
  constraint pre_auth_rate_limits_window check (
    window_seconds in (900, 3600)
  ),
  constraint pre_auth_rate_limits_count check (request_count >= 1)
);

create index pre_auth_rate_limits_expiry_idx
  on private.pre_auth_rate_limits (window_started_at, window_seconds);

revoke all on table private.pre_auth_rate_limits
  from public, anon, authenticated;

create function public.consume_pre_auth_rate_limit(
  p_bucket text,
  p_limit integer,
  p_window_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  observed_at timestamptz := clock_timestamp();
  window_start timestamptz;
  consumed_count bigint;
  is_allowed boolean;
  retry_seconds integer;
begin
  if p_bucket <> 'admin_password_login' then
    raise exception using errcode = '22023', message = 'unsupported pre-auth rate-limit bucket';
  end if;
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception using errcode = '22023', message = 'pre-auth rate-limit maximum must be between 1 and 100';
  end if;
  if p_window_seconds is null or p_window_seconds not in (900, 3600) then
    raise exception using errcode = '22023', message = 'unsupported pre-auth rate-limit window';
  end if;

  window_start := to_timestamp(
    floor(extract(epoch from observed_at) / p_window_seconds) * p_window_seconds
  );

  insert into private.pre_auth_rate_limits (
    bucket,
    window_seconds,
    window_started_at,
    request_count,
    updated_at
  ) values (
    p_bucket,
    p_window_seconds,
    window_start,
    1,
    observed_at
  )
  on conflict (bucket, window_seconds, window_started_at)
  do update
     set request_count = private.pre_auth_rate_limits.request_count + 1,
         updated_at = observed_at
  returning request_count into consumed_count;

  delete from private.pre_auth_rate_limits
   where window_started_at + make_interval(secs => window_seconds)
         < observed_at - interval '1 day';

  is_allowed := consumed_count <= p_limit;
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
    'remaining', greatest(p_limit::bigint - consumed_count, 0),
    'retryAfterSeconds', retry_seconds
  );
end;
$$;

revoke all on function public.consume_pre_auth_rate_limit(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.consume_pre_auth_rate_limit(text, integer, integer)
  to service_role;

comment on function public.consume_pre_auth_rate_limit(text, integer, integer) is
  'Service-only atomic fixed-window throttle for the optional admin password endpoint; stores no request identity or credential data.';
