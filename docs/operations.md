# Foodtopia beta operations

## Raw-image retention

Raw images live only in the private `raw-images` Supabase bucket. The normal path deletes each object immediately after a batch is applied or cancelled. The Inngest sweeper claims any remaining asset at its `purge_after` deadline, deletes the object, and marks the row deleted. Incomplete uploads are eligible after one hour; no uploaded object may remain after 24 hours.

Daily beta checks. The first query measures worker state after the signed-upload
replay quarantine and one full 15-minute continuation window; a normal
`purge_pending` row before that point is not itself evidence that bytes remain.
The second query is the authoritative 24-hour application-storage check and
must run with the narrowly controlled operator/service role:

```sql
select count(*) as overdue_assets
from public.image_assets ia
join public.analyses a on a.id = ia.analysis_id
where ia.status <> 'deleted'
  and greatest(
    a.purge_after,
    ia.upload_authorization_expires_at + interval '15 minutes'
  ) <= now();

select count(*) as raw_objects_older_than_24h
from storage.objects
where bucket_id = 'raw-images'
  and created_at <= now() - interval '24 hours';
```

Any non-zero value is an incident: pause new capture at the deployment boundary, inspect Inngest failures, run the authorized purge worker, verify the bucket directly, and record only counts/correlation IDs in the incident note.

## Alerts

Configure alerts before the first household for:

- analysis failure rate above 10% over 15 minutes;
- the oldest queued analysis above five minutes;
- any overdue raw-image asset;
- HTTP 5xx rate above 2% over 15 minutes;
- stale inventory-conflict growth above the beta baseline;
- daily OpenAI and OpenRouter spend or request volume above twice the seven-day moving expectation.

Logs and telemetry must not include photos, signed URLs/tokens, inventory labels, email addresses, prompt text, provider response bodies, or service-role credentials. Use the API correlation ID and internal UUIDs for diagnosis.

## Household deletion

1. Authenticate the owner request through the established beta support channel.
2. Have the owner use **Delete household**, or issue the authenticated `DELETE /api/v1/households/current` request on their behalf. The expected first response is HTTP `202` with `status: "deletion_pending"` and `finalizeAfter`; it is not a failure.
3. Confirm the household is immediately quarantined: ordinary RLS reads/writes and new Storage authorizations must fail, and outstanding invitations must no longer be usable.
4. The request and 15-minute Inngest purge continuation delete the exact `raw-images/<household-id>/…` objects returned by the database manifest. Never construct paths from unverified input.
5. Wait until `finalizeAfter` (currently 2 hours 15 minutes, chosen to outlive issued upload credentials). The 15-minute continuation re-lists known objects and invokes the service-only finalizer; it must not finalize early or while a raw object remains.
6. After the next 15-minute continuation, verify the household row and its Storage prefix are absent. If either remains, invoke the authorized continuation again and inspect only counts and correlation IDs. A retryable response before the quarantine expires is expected; a response after expiry is an incident to investigate.
7. Clear household data on any test devices controlled by beta operations. The initiating browser clears its local household cache and signs out; other members clear their own browser data by signing out.
8. If requested, delete the corresponding Supabase Auth users separately after confirming they do not own another retained resource.
9. Record request time, `finalizeAfter`, completion time, operator, object/row counts, and correlation IDs—never the deleted food data.

## Provider or analysis incident

Permanent refusals and malformed structured responses are non-retryable. Transient failures retry at most three times with the analysis ID as the idempotency key. A failed batch never mutates inventory; the user can retry or enter foods manually.

If the provider is impaired, keep manual inventory available, use the deployment platform's authenticated maintenance response for `/capture` and the analysis-create endpoint, leave queued jobs durable, and avoid replaying a batch under a different analysis ID. This repository does not include a capture feature flag; do not claim capture is disabled unless that platform rule has been applied and verified.

Provider selection and credential handling are household-scoped. Never copy a
household API key into an incident note, log, query result, browser store, or
Inngest event. A missing selected platform key, an unavailable household
credential, an unknown encryption key ID, or an unsupported model must fail
closed without trying a different provider.

For credential-key rotation, deploy the old and new entries together in
`HOUSEHOLD_AI_CREDENTIAL_KEYRING`, set the new
`HOUSEHOLD_AI_CREDENTIAL_ACTIVE_KEY_ID`, and exercise the controlled runtime
resolver so compare-and-swap re-encryption can complete. Check retirement with
a service/operator-only query:

```sql
select encryption_key_id, count(*)
from private.household_ai_credentials
group by encryption_key_id;
```

Remove an old key only after its count is zero. The query output contains no API
key or ciphertext and must remain in the controlled operator channel.

## Recovery checks

- Confirm one account cannot select, mutate, subscribe to, or sign storage paths for another household.
- Confirm inventory command replays return the original result and changed semantics under the same command ID are rejected.
- Confirm stale versions return 409 and do not reorder later outbox commands.
- Confirm logout leaves zero Foodtopia IndexedDB lots/outbox rows and no `foodtopia-*` cache.
- Confirm the offline fallback contains no server-rendered household payload.
