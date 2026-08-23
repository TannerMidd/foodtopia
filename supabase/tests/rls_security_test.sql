begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(75);

-- Stable fixture identifiers make failures and Storage paths easy to inspect.
insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
values
  ('a0000000-0000-0000-0000-000000000001', 'alpha@example.test', '{}'::jsonb, '{}'::jsonb),
  ('b0000000-0000-0000-0000-000000000002', 'bravo@example.test', '{}'::jsonb, '{}'::jsonb),
  ('c0000000-0000-0000-0000-000000000003', 'charlie@example.test', '{}'::jsonb, '{}'::jsonb),
  ('d0000000-0000-0000-0000-000000000004', 'delta@example.test', '{}'::jsonb, '{}'::jsonb);

insert into public.beta_invites (id, email, token_hash, expires_at)
values (
  'd1000000-0000-0000-0000-000000000004',
  'delta@example.test',
  encode(extensions.digest('delta-bootstrap-token-1234567890', 'sha256'), 'hex'),
  now() + interval '1 day'
);

insert into public.households (id, name, created_by)
values
  ('10000000-0000-0000-0000-000000000001', 'Alpha household', 'a0000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-000000000002', 'Bravo household', 'b0000000-0000-0000-0000-000000000002');

insert into public.household_members (household_id, user_id, role)
values
  ('10000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'owner'),
  ('10000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000003', 'member'),
  ('20000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000002', 'owner');

-- An invited member account: the profile trigger must pre-approve it.
insert into public.household_invites (
  id, household_id, email, token_hash, expires_at, created_by
)
values (
  'e1000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  'echo@example.test',
  encode(extensions.digest('echo-household-token-123456789', 'sha256'), 'hex'),
  now() + interval '7 days',
  'a0000000-0000-0000-0000-000000000001'
);

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
values
  ('e0000000-0000-0000-0000-000000000001', 'echo@example.test', '{}'::jsonb, '{}'::jsonb);

-- An invitation-only email used by the closed-window hook test below.
insert into public.household_invites (
  id, household_id, email, token_hash, expires_at, created_by
)
values (
  'f1000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  'foxtrot@example.test',
  encode(extensions.digest('foxtrot-household-token-12345678', 'sha256'), 'hex'),
  now() + interval '7 days',
  'a0000000-0000-0000-0000-000000000001'
);

select is(
  (select status::text from public.profiles where id = 'a0000000-0000-0000-0000-000000000001'),
  'pending',
  'open-beta signups start pending until an administrator enables them'
);
select is(
  (select status::text from public.profiles where id = 'e0000000-0000-0000-0000-000000000001'),
  'enabled',
  'a live invitation pre-approves the invited account'
);

insert into public.privacy_consents (user_id, household_id, consent_version)
values (
  'a0000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  'vision-v2'
);

insert into public.household_custom_food_concepts (
  id, household_id, normalized_name, display_name, category, created_by
)
values
  (
    '11100000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    'alpha fixture',
    'Alpha fixture',
    'Other',
    'a0000000-0000-0000-0000-000000000001'
  ),
  (
    '22200000-0000-0000-0000-000000000002',
    '20000000-0000-0000-0000-000000000002',
    'bravo fixture',
    'Bravo fixture',
    'Other',
    'b0000000-0000-0000-0000-000000000002'
  );

insert into public.inventory_lots (id, household_id, custom_food_concept_id, name, created_by)
values
  (
    '11000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    '11100000-0000-0000-0000-000000000001',
    'Alpha fixture',
    'a0000000-0000-0000-0000-000000000001'
  ),
  (
    '22000000-0000-0000-0000-000000000002',
    '20000000-0000-0000-0000-000000000002',
    '22200000-0000-0000-0000-000000000002',
    'Bravo fixture',
    'b0000000-0000-0000-0000-000000000002'
  );

insert into public.analyses (id, household_id, status, image_count, created_by)
values
  (
    '13000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    'queued',
    1,
    'a0000000-0000-0000-0000-000000000001'
  ),
  (
    '23000000-0000-0000-0000-000000000002',
    '20000000-0000-0000-0000-000000000002',
    'queued',
    1,
    'b0000000-0000-0000-0000-000000000002'
  );

insert into public.image_assets (
  id, household_id, analysis_id, image_index, object_path,
  original_filename, content_type, byte_size, status, created_by
)
values
  (
    '14000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    '13000000-0000-0000-0000-000000000001',
    0,
    '10000000-0000-0000-0000-000000000001/a0000000-0000-0000-0000-000000000001/13000000-0000-0000-0000-000000000001/14000000-0000-0000-0000-000000000001.jpg',
    'alpha.jpg',
    'image/jpeg',
    100,
    'uploaded',
    'a0000000-0000-0000-0000-000000000001'
  ),
  (
    '24000000-0000-0000-0000-000000000002',
    '20000000-0000-0000-0000-000000000002',
    '23000000-0000-0000-0000-000000000002',
    0,
    '20000000-0000-0000-0000-000000000002/b0000000-0000-0000-0000-000000000002/23000000-0000-0000-0000-000000000002/24000000-0000-0000-0000-000000000002.jpg',
    'bravo.jpg',
    'image/jpeg',
    100,
    'uploaded',
    'b0000000-0000-0000-0000-000000000002'
  );

-- Leave Bravo one analysis-creation slot. The first consented call below
-- consumes it; a second direct RPC call must be rejected at the DB boundary.
insert into public.api_rate_limits (
  household_id,
  user_id,
  action,
  window_seconds,
  window_started_at,
  request_count
) values (
  '20000000-0000-0000-0000-000000000002',
  'b0000000-0000-0000-0000-000000000002',
  'analysis_create',
  3600,
  to_timestamp(floor(extract(epoch from clock_timestamp()) / 3600) * 3600),
  9
);

insert into storage.objects (bucket_id, name)
values
  (
    'raw-images',
    '10000000-0000-0000-0000-000000000001/a0000000-0000-0000-0000-000000000001/13000000-0000-0000-0000-000000000001/14000000-0000-0000-0000-000000000001.jpg'
  ),
  (
    'raw-images',
    '20000000-0000-0000-0000-000000000002/b0000000-0000-0000-0000-000000000002/23000000-0000-0000-0000-000000000002/24000000-0000-0000-0000-000000000002.jpg'
  );

select set_config(
  'request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000001","email":"alpha@example.test","role":"authenticated"}',
  true
);
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select is(
  (select count(*) from public.inventory_lots where household_id = '10000000-0000-0000-0000-000000000001'),
  1::bigint,
  'alpha can select its own inventory row'
);
select is(
  (select count(*) from public.inventory_lots where household_id = '20000000-0000-0000-0000-000000000002'),
  0::bigint,
  'alpha cannot select bravo inventory'
);
select is(
  (select count(*) from public.household_custom_food_concepts where household_id = '10000000-0000-0000-0000-000000000001'),
  1::bigint,
  'alpha can select its own custom food concepts'
);
select is(
  (select count(*) from public.household_custom_food_concepts where household_id = '20000000-0000-0000-0000-000000000002'),
  0::bigint,
  'alpha cannot select bravo custom food concepts'
);
select is(
  (select count(*) from storage.objects where name like '10000000-0000-0000-0000-000000000001/%'),
  1::bigint,
  'alpha can select its own uploaded raw object'
);
select is(
  (select count(*) from storage.objects where name like '20000000-0000-0000-0000-000000000002/%'),
  0::bigint,
  'alpha cannot select or sign bravo raw objects'
);
select is(
  private.can_read_raw_image(
    '20000000-0000-0000-0000-000000000002/b0000000-0000-0000-0000-000000000002/23000000-0000-0000-0000-000000000002/24000000-0000-0000-0000-000000000002.jpg'
  ),
  false,
  'the raw-image signing predicate rejects another tenant path'
);
select is(
  (
    with changed as (
      update public.households
         set name = 'cross-tenant mutation'
       where id = '20000000-0000-0000-0000-000000000002'
      returning 1
    )
    select count(*) from changed
  ),
  0::bigint,
  'alpha cannot update bravo household'
);
select is(
  (
    with removed as (
      delete from storage.objects
       where name like '20000000-0000-0000-0000-000000000002/%'
      returning 1
    )
    select count(*) from removed
  ),
  0::bigint,
  'alpha cannot delete bravo raw objects'
);
select throws_ok(
  $$update public.inventory_lots set name = 'forbidden' where id = '11000000-0000-0000-0000-000000000001'$$,
  '42501',
  'permission denied for table inventory_lots',
  'authenticated users cannot bypass the inventory command RPC'
);
select throws_ok(
  $$select * from public.household_ai_settings$$,
  '42501',
  'permission denied for table household_ai_settings',
  'authenticated users cannot directly read household AI settings'
);
select throws_ok(
  $$select * from private.household_ai_credentials$$,
  '42501',
  'permission denied for table household_ai_credentials',
  'authenticated users cannot directly read encrypted household credentials'
);
select ok(
  not (public.get_household_ai_settings() ? 'encryptedApiKey')
    and public.get_household_ai_settings() ->> 'provider' = 'openai'
    and (public.get_household_ai_settings() ->> 'householdCredentialConfigured')::boolean = false,
  'member-readable AI settings DTO is secret-free and starts platform-backed'
);
select ok(
  public.write_household_ai_settings(
    'openrouter',
    'openrouter/vision-v1',
    'openrouter/recipe-v1',
    'household',
    'replace',
    'v1.aabbccddeeff.aabbccddeeff.ciphertextmore',
    'test-key-v1',
    1
  ) ->> 'provider' = 'openrouter'
  and (public.get_household_ai_settings() ->> 'householdCredentialConfigured')::boolean,
  'owner atomically writes an OpenRouter configuration and encrypted credential envelope'
);
select throws_ok(
  $$select public.get_household_ai_runtime_config('10000000-0000-0000-0000-000000000001')$$,
  '42501',
  'permission denied for function get_household_ai_runtime_config',
  'authenticated users cannot invoke the service-only runtime credential resolver'
);
select is(
  (
    select count(*)
      from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename in (
         'inventory_lots', 'inventory_events', 'analyses',
         'analysis_candidates', 'cook_sessions'
       )
  ),
  5::bigint,
  'only the intended tenant streams are published for realtime'
);
select ok(
  (
    select bool_and(c.relrowsecurity)
      from pg_publication_tables as pt
      join pg_namespace as n on n.nspname = pt.schemaname
      join pg_class as c on c.relnamespace = n.oid and c.relname = pt.tablename
     where pt.pubname = 'supabase_realtime'
       and pt.schemaname = 'public'
  ),
  'every published realtime table has RLS enabled'
);
select throws_ok(
  $$select public.apply_inventory_command(
    '15000000-0000-0000-0000-000000000001',
    'adjust',
    0,
    '{"lotId":"22000000-0000-0000-0000-000000000002","name":"spoof"}'::jsonb
  )$$,
  'P0002',
  'inventory lot not found',
  'inventory RPC cannot target another household lot'
);
select is(
  (
    public.apply_inventory_command(
      '15000000-0000-0000-0000-000000000002',
      'add',
      null,
      '{"id":"15000000-0000-0000-0000-000000000003","householdId":"20000000-0000-0000-0000-000000000002","name":"Derived tenant"}'::jsonb
    ) #>> '{lot,householdId}'
  )::uuid,
  '10000000-0000-0000-0000-000000000001'::uuid,
  'inventory RPC ignores a spoofed householdId and derives alpha'
);
select is(
  (select household_id from public.inventory_lots where id = '15000000-0000-0000-0000-000000000003'),
  '10000000-0000-0000-0000-000000000001'::uuid,
  'the spoofed inventory payload persisted only in alpha'
);
select ok(
  (
    select food_concept_id is null and custom_food_concept_id is not null
      from public.inventory_lots
     where id = '15000000-0000-0000-0000-000000000003'
  ),
  'an unmatched inventory add atomically receives an alpha custom concept'
);
select is(
  (
    public.create_analysis(
      '16000000-0000-0000-0000-000000000001',
      '[{"id":"16000000-0000-0000-0000-000000000002","imageIndex":0,"originalFilename":"scan.jpg","contentType":"image/jpeg","byteSize":100}]'::jsonb,
      '16000000-0000-0000-0000-000000000001'
    ) ->> 'analysisId'
  )::uuid,
  '16000000-0000-0000-0000-000000000001'::uuid,
  'analysis creation succeeds after alpha consent'
);
select is(
  (select household_id from public.analyses where id = '16000000-0000-0000-0000-000000000001'),
  '10000000-0000-0000-0000-000000000001'::uuid,
  'analysis RPC derives alpha without a household argument'
);
select is(
  public.create_household_invite(
    'nobody@example.test',
    'wrong-email-token-000000000000000000',
    now() + interval '1 day'
  ) is not null,
  true,
  'an active member may create a household invite'
);
select throws_ok(
  $$select public.accept_household_invite('wrong-email-token-000000000000000000')$$,
  '28000',
  'household invitation is invalid',
  'an invite cannot be accepted under a different signed email'
);
select is(
  jsonb_array_length(public.list_household_members() -> 'members'),
  2,
  'member listing is scoped to alpha'
);
select ok(
  not exists (
    select 1
      from jsonb_array_elements(public.list_household_members() -> 'members') as member(value)
     where member.value ? 'email'
  ),
  'member DTOs do not expose auth email addresses'
);
reset role;
select set_config(
  'request.jwt.claims',
  '{"sub":"c0000000-0000-0000-0000-000000000003","email":"charlie@example.test","role":"authenticated"}',
  true
);
select set_config('request.jwt.claim.sub', 'c0000000-0000-0000-0000-000000000003', true);
set local role authenticated;

select ok(
  public.get_household_ai_settings() ->> 'provider' = 'openrouter'
    and not (public.get_household_ai_settings() ? 'encryptedApiKey'),
  'a non-owner can read its household provider choice but never the credential'
);
select throws_ok(
  $$select public.write_household_ai_settings('openrouter', 'openrouter/vision-v1', 'openrouter/recipe-v1', 'household', 'retain', null, null, 2)$$,
  '42501',
  'owner household role required',
  'a household member cannot change provider or credential settings'
);

reset role;
select set_config(
  'request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000001","email":"alpha@example.test","role":"authenticated"}',
  true
);
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000001', true);
set local role authenticated;
select throws_ok(
  $$select public.remove_household_member('a0000000-0000-0000-0000-000000000001')$$,
  '22023',
  'owners cannot remove themselves',
  'an owner cannot remove itself'
);
select is(
  (public.remove_household_member('c0000000-0000-0000-0000-000000000003') ->> 'removed')::boolean,
  true,
  'an owner can remove another household member'
);

reset role;
select set_config(
  'request.jwt.claims',
  '{"sub":"c0000000-0000-0000-0000-000000000003","email":"charlie@example.test","role":"authenticated"}',
  true
);
select set_config('request.jwt.claim.sub', 'c0000000-0000-0000-0000-000000000003', true);
set local role authenticated;

select is(private.current_household_id(), null::uuid, 'removed member has no active household');
select is((select count(*) from public.inventory_lots), 0::bigint, 'removed member immediately loses inventory reads');
select is((select count(*) from storage.objects where bucket_id = 'raw-images'), 0::bigint, 'removed member immediately loses raw object reads/signing');

reset role;
select set_config(
  'request.jwt.claims',
  '{"sub":"b0000000-0000-0000-0000-000000000002","email":"bravo@example.test","role":"authenticated"}',
  true
);
select set_config('request.jwt.claim.sub', 'b0000000-0000-0000-0000-000000000002', true);
set local role authenticated;

select is(
  (select count(*) from public.inventory_lots where household_id = '10000000-0000-0000-0000-000000000001'),
  0::bigint,
  'bravo cannot select alpha inventory'
);
select is(
  (select count(*) from public.household_custom_food_concepts where household_id = '10000000-0000-0000-0000-000000000001'),
  0::bigint,
  'bravo cannot select alpha custom food concepts'
);
select is(
  (select count(*) from public.household_custom_food_concepts where household_id = '20000000-0000-0000-0000-000000000002'),
  1::bigint,
  'bravo can select its own custom food concepts'
);
select is(
  (select count(*) from public.inventory_lots where household_id = '20000000-0000-0000-0000-000000000002'),
  1::bigint,
  'bravo can select its own inventory'
);
select ok(
  public.get_household_ai_settings() ->> 'provider' = 'openai'
    and not (public.get_household_ai_settings() ? 'encryptedApiKey'),
  'bravo receives only its own default secret-free provider configuration'
);
select is(
  (select count(*) from storage.objects where name like '10000000-0000-0000-0000-000000000001/%'),
  0::bigint,
  'bravo cannot select or sign alpha raw objects'
);
select is(
  private.can_read_raw_image(
    '10000000-0000-0000-0000-000000000001/a0000000-0000-0000-0000-000000000001/13000000-0000-0000-0000-000000000001/14000000-0000-0000-0000-000000000001.jpg'
  ),
  false,
  'bravo signing predicate rejects alpha paths'
);
select throws_ok(
  $$select public.create_analysis(
    '26000000-0000-0000-0000-000000000001',
    '[{"id":"26000000-0000-0000-0000-000000000002","imageIndex":0,"originalFilename":"scan.jpg","contentType":"image/jpeg","byteSize":100}]'::jsonb,
    '26000000-0000-0000-0000-000000000001'
  )$$,
  '42501',
  'vision-v2 privacy consent required before image analysis',
  'first scan is blocked until the current consent version is recorded'
);
select is(
  public.record_privacy_consent('vision-v2') ->> 'consentVersion',
  'vision-v2',
  'bravo can record only the supported consent version'
);
select is(
  (
    public.create_analysis(
      '26000000-0000-0000-0000-000000000001',
      '[{"id":"26000000-0000-0000-0000-000000000002","imageIndex":0,"originalFilename":"scan.jpg","contentType":"image/jpeg","byteSize":100}]'::jsonb,
      '26000000-0000-0000-0000-000000000001'
    ) ->> 'analysisId'
  )::uuid,
  '26000000-0000-0000-0000-000000000001'::uuid,
  'analysis creation succeeds after bravo consent'
);
select throws_ok(
  $$select public.create_analysis(
    '27000000-0000-0000-0000-000000000001',
    '[{"id":"27000000-0000-0000-0000-000000000002","imageIndex":0,"originalFilename":"bypass.jpg","contentType":"image/jpeg","byteSize":100}]'::jsonb,
    '27000000-0000-0000-0000-000000000001'
  )$$,
  'PT429',
  'Analysis creation rate limit exceeded',
  'direct analysis RPC cannot bypass the cost-bearing creation limit'
);
select throws_ok(
  $$select public.complete_analysis(
    '26000000-0000-0000-0000-000000000001',
    array['26000000-0000-0000-0000-000000000002'::uuid]
  )$$,
  '22023',
  'uploaded object metadata does not match its verified descriptor',
  'direct completion cannot queue a missing private object'
);

reset role;
select set_config(
  'request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000001","email":"alpha@example.test","role":"authenticated"}',
  true
);
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select throws_ok(
  $$select public.record_product_event('analysis_created', '{"rawLabel":"secret"}'::jsonb)$$,
  '22023',
  'event property is not allowlisted: rawLabel',
  'telemetry rejects arbitrary household content'
);
select ok(
  (public.record_product_event(
    'analysis_created',
    '{"imageCount":1,"offline":false}'::jsonb,
    '17000000-0000-4000-8000-000000000001',
    '17000000-0000-4000-8000-000000000002'
  ) ->> 'eventId') is not null,
  'telemetry accepts only an allowlisted count/boolean payload'
);
select is(
  (public.consume_rate_limit('analysis_create', 2, 60) ->> 'allowed')::boolean,
  true,
  'durable rate limit derives and allows alpha'
);
select ok(
  jsonb_array_length(public.request_household_deletion() -> 'objectPaths') >= 1,
  'owner deletion request returns a raw object manifest'
);
select is(private.current_household_id(), null::uuid, 'deletion request quarantines the household helper');
select is((select count(*) from public.inventory_lots), 0::bigint, 'deletion quarantine hides prior inventory');
select is((select count(*) from storage.objects where bucket_id = 'raw-images'), 0::bigint, 'deletion quarantine revokes raw object reads/signing');
select throws_ok(
  $$select public.create_analysis(
    '18000000-0000-0000-0000-000000000001',
    '[{"id":"18000000-0000-0000-0000-000000000002","imageIndex":0,"originalFilename":"late.jpg","contentType":"image/jpeg","byteSize":100}]'::jsonb,
    '18000000-0000-0000-0000-000000000001'
  )$$,
  '28000',
  'active household session required',
  'quarantined household cannot start new analysis work'
);

reset role;
set local role anon;
select throws_ok(
  $$select public.consume_pre_auth_rate_limit('admin_password_login', 5, 900)$$,
  '42501',
  'permission denied for function consume_pre_auth_rate_limit',
  'anonymous clients cannot consume or inspect the admin login throttle'
);

reset role;
set local role authenticated;
select throws_ok(
  $$select public.consume_pre_auth_rate_limit('admin_password_login', 5, 900)$$,
  '42501',
  'permission denied for function consume_pre_auth_rate_limit',
  'authenticated clients cannot bypass the service-only admin login throttle'
);

reset role;
set local role service_role;
select is(
  (public.consume_pre_auth_rate_limit('admin_password_login', 5, 900) ->> 'allowed')::boolean,
  true,
  'the service role can atomically consume the privacy-safe admin login allowance'
);

reset role;
select set_config(
  'request.jwt.claims',
  '{"sub":"d0000000-0000-0000-0000-000000000004","email":"delta@example.test","role":"authenticated"}',
  true
);
select set_config('request.jwt.claim.sub', 'd0000000-0000-0000-0000-000000000004', true);
set local role authenticated;

select lives_ok(
  $$select public.bootstrap_household('Delta household', 'delta-bootstrap-token-1234567890')$$,
  'authenticated beta onboarding can create a household after the deferred AI invariant fires'
);
select lives_ok(
  $$set constraints all immediate$$,
  'deferred AI credential invariants can run after authenticated owner RPCs return'
);
select is(
  (select count(*) from public.household_members where user_id = auth.uid() and role = 'owner'),
  1::bigint,
  'household bootstrap grants the invited user owner membership'
);
select is(
  (
    select count(*)
      from public.household_ai_settings as settings
      join public.household_members as member
        on member.household_id = settings.household_id
     where member.user_id = auth.uid()
  ),
  1::bigint,
  'household bootstrap creates the required secret-free AI settings row'
);
select is(
  (select status::text from public.profiles where id = auth.uid()),
  'enabled',
  'claiming a personal beta token enables the operator-approved account'
);
select is(
  (
    select p.prosecdef
      from pg_proc as p
      join pg_namespace as n on n.oid = p.pronamespace
     where n.nspname = 'private'
       and p.proname = 'create_household_ai_settings'
       and p.pronargs = 0
  ),
  true,
  'the default household AI settings trigger runs as its locked-down owner'
);
select is(
  (
    select p.prosecdef
      from pg_proc as p
      join pg_namespace as n on n.oid = p.pronamespace
     where n.nspname = 'private'
       and p.proname = 'enforce_household_ai_credential_shape'
       and p.pronargs = 0
  ),
  true,
  'the deferred AI credential invariant runs as its locked-down owner'
);
select ok(
  not has_function_privilege('authenticated', 'private.create_household_ai_settings()', 'EXECUTE'),
  'authenticated users cannot directly execute the default AI settings trigger function'
);
select ok(
  not has_function_privilege('authenticated', 'private.enforce_household_ai_credential_shape()', 'EXECUTE'),
  'authenticated users cannot directly execute the deferred AI credential invariant'
);

-- Open-beta admissions: the before_user_created hook honors the singleton
-- signup window, invitation emails stay authoritative, and clients can neither
-- read the switch nor change their own admission state.
reset role;
select is(
  public.before_user_created('{"user":{"email":"golf@example.test"}}'::jsonb),
  '{}'::jsonb,
  'the hook admits a fresh email while the signup window is open'
);
update public.beta_signup_settings set signups_open = false where id = 1;
select is(
  public.before_user_created('{"user":{"email":"hotel@example.test"}}'::jsonb) -> 'error' ->> 'http_code',
  '403',
  'the hook rejects fresh emails once the window closes'
);
select is(
  public.before_user_created('{"user":{"email":"foxtrot@example.test"}}'::jsonb),
  '{}'::jsonb,
  'the hook still admits live invitation emails while the window is closed'
);
update public.beta_signup_settings set signups_open = true where id = 1;

reset role;
set local role service_role;
select is(
  (select count(*) from public.beta_signup_settings),
  1::bigint,
  'the service role retains singleton signup-window control'
);

reset role;
select set_config(
  'request.jwt.claims',
  '{"sub":"c0000000-0000-0000-0000-000000000003","email":"charlie@example.test","role":"authenticated"}',
  true
);
select set_config('request.jwt.claim.sub', 'c0000000-0000-0000-0000-000000000003', true);
set local role authenticated;
select throws_ok(
  $$select status from public.beta_signup_settings$$,
  '42501',
  'permission denied for table beta_signup_settings',
  'clients cannot read the signup-window switch'
);
select throws_ok(
  $$update public.profiles set status = 'disabled' where id = auth.uid()$$,
  '42501',
  'permission denied for table profiles',
  'clients cannot change their own admission state'
);

select * from finish();
rollback;
