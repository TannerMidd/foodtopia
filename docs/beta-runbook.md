# Private-beta acceptance runbook

## Before the five-household beta

- [ ] Apply the migration to a disposable Supabase project and run the RLS/storage security suite with two real users in two households.
- [ ] Configure and exercise the Auth before-user-created hook, beta onboarding, household invite acceptance, expiry, wrong-email rejection, and one-household constraint.
- [ ] Human-review all 80 recipes and make `pnpm validate:recipes:publication` pass without synthetic reviewer metadata.
- [ ] Import only reviewed recipes as `published` rows and verify every ingredient resolves to a global food concept.
- [ ] Build the consented 100-batch image benchmark and meet at least 90% proposal precision and 80% recall.
- [ ] Verify immediate apply/cancel deletion and the one-hour/24-hour purge deadlines against the real private bucket.
- [ ] Run `pnpm check`, `pnpm build`, and both Playwright mobile projects.
- [ ] Manually install and exercise camera/offline/reconnect behavior on current iOS Safari and Android Chrome.
- [ ] Configure the operational alerts in `docs/operations.md` and rehearse household deletion.
- [ ] Exercise OpenAI and OpenRouter with both platform and encrypted household credentials; verify a missing/invalid selected key never falls back to the other provider.
- [ ] Review the provider-inclusive privacy notice with the beta coordinator and obtain `vision-v2` first-scan consent before any production photo. Confirm the current provider/model route is visible before consent.

## Two-week success gates

- Credible recipe shortlist within two minutes for a new user.
- Median review of ten visible foods at or below 20 seconds and two corrections.
- At least 70% of participants find a desirable meal in the first three suggestions.
- Day-seven physical audits reach at least 80% inventory presence/absence agreement.
- At least half of households repeat the complete capture-to-cook loop twice after onboarding.
- Zero raw application-storage photos older than 24 hours.

Do not expand from five to twenty households until every engineering gate passes and the product outcomes are measured from privacy-safe event counts/timings. Never record raw photos, household labels, ingredient text, email addresses, or prompt text in product telemetry.
