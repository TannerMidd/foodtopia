# Open-beta acceptance runbook

## Before the five-household beta

- [ ] Apply the migration to a disposable Supabase project and run the RLS/storage security suite with two real users in two households.
- [ ] Configure and exercise the Auth before-user-created hook, the open-beta signup window (open and closed), pending-account waiting screen, admin batch enable/disable at `/admin/beta`, beta onboarding, household invite acceptance, expiry, wrong-email rejection, and one-household constraint.
- [ ] Verify all 160 public recipes pass `pnpm validate:recipes:publication`: reviewed recipes have genuine reviewer metadata, while initial-seed recipes use `seeded` with no synthetic review claim.
- [ ] Import reviewed and initial-seed recipes as `published` rows, verify every ingredient resolves to a global food concept, and confirm seeded recipes are visibly labeled as initial catalog content.
- [ ] Flag one reviewed and one seeded recipe from a household member account; verify duplicate submission is idempotent, another household cannot read the flag, and no free-form feedback is retained.
- [ ] Build the consented 100-batch image benchmark and meet at least 90% proposal precision and 80% recall.
- [ ] Verify immediate apply/cancel deletion and the one-hour/24-hour purge deadlines against the real private bucket.
- [ ] Run `pnpm check`, `pnpm build`, `docker compose build`, and both Playwright mobile projects.
- [ ] Reset and start the full local Compose stack; verify Supabase migrations, seed/catalog import, email Auth, Storage, Inngest registration, `/~offline`, and `/api/v1/recipes`.
- [ ] Build the production `Dockerfile` separately, confirm it runs as a non-root user, and rehearse graceful stop and rollback.
- [ ] Manually install and exercise camera/offline/reconnect behavior on current iOS Safari and Android Chrome.
- [ ] Configure the operational alerts in `docs/operations.md` and rehearse household deletion.
- [ ] Exercise OpenAI and OpenRouter with encrypted household credentials; verify a missing/invalid selected key never falls back to another provider or any deployment key.
- [ ] Force a zero-match recipe search for each provider; verify only one strict AI draft appears, generation is separately rate-limited, approve creates a reusable private draft recipe, deny clears payload, and another/disabled household member cannot address the proposal.
- [ ] Review the provider-inclusive privacy notice with the beta coordinator and obtain `vision-v2` first-scan consent before any production photo. Confirm the current provider/model route is visible before consent.

## Two-week success gates

- Credible recipe shortlist within two minutes for a new user.
- Median review of ten visible foods at or below 20 seconds and two corrections.
- At least 70% of participants find a desirable meal in the first three suggestions.
- Day-seven physical audits reach at least 80% inventory presence/absence agreement.
- At least half of households repeat the complete capture-to-cook loop twice after onboarding.
- Zero raw application-storage photos older than 24 hours.

Do not expand from five to twenty households until every engineering gate passes and the product outcomes are measured from privacy-safe event counts/timings. Never record raw photos, household labels, ingredient text, email addresses, or prompt text in product telemetry.
