# Foodtopia

Foodtopia is an invite-only, mobile-first household food inventory PWA. Its dependable loop is:

**Photograph food → review AI suggestions → update shared inventory → choose a feasible recipe → reconcile what was used.**

The repository is a single TypeScript application built with Next.js App Router, Tailwind CSS, Supabase Auth/Postgres/Storage, Inngest, OpenAI/OpenRouter provider adapters, Serwist, Dexie, Vitest, and Playwright.

## What is implemented

- Touch-first home, capture, review, inventory, recipe, cooking, household, settings, authentication, onboarding, and privacy screens.
- Client-side JPEG re-encoding at a 1600 px maximum edge, EXIF removal through canvas re-encoding, and a 5 MB post-encode limit.
- A review-first vision flow. Model output is a draft and cannot mutate inventory until batch confirmation.
- Inventory lots, immutable events, idempotent commands, optimistic versions, undo/restore semantics, and explicit unknown/estimated/known quantities.
- Installable PWA shell with a static, data-free offline fallback; authenticated pages and API responses are network-only.
- Dexie snapshot/outbox sync on launch, focus, reconnect, and every 15 seconds while foregrounded. Logout clears household rows and Foodtopia caches.
- 80 original project-owned recipe drafts, 103 normalized food concepts, 304 aliases, deterministic evidence-based matching, prompt parsing, and cooking reconciliation.
- Passwordless Supabase Auth for invited households, an optional server-mapped administrator password login for testing, beta and household invite gates, one-household membership, RLS, and private raw-image storage policies.
- Durable Inngest analysis and purge functions with household-selectable OpenAI/OpenRouter adapters and strict Zod validation.
- A local demo that needs no cloud account and a fail-closed production mode that requires real credentials.

## Run the local demo

Requirements: Node.js 22+ and pnpm 11.19.0.

```bash
pnpm install --frozen-lockfile
pnpm dev -p 3100
```

Open `http://localhost:3100`. When Supabase variables are absent, development automatically uses the in-memory demo and local vision/recipe assistants. Raw image bytes are not retained by the demo.

Copy `.env.example` to `.env.local` only when connecting cloud services. `FOODTOPIA_DEMO_MODE=true` may enable a non-production preview, but it is ignored by Vercel production deployments.

## Production setup

1. Create a Supabase project and apply every migration in `supabase/migrations/` in filename order.
2. Load `supabase/seed.sql` for the global food concepts and aliases.
3. In Supabase Auth, enable email OTP/magic links and configure the `before-user-created` hook documented in the migration. Add the deployed `/auth/callback` URL to the redirect allowlist.
4. Confirm the private `raw-images` bucket and storage policies created by the migration. Never make this bucket public.
5. After genuine recipe review metadata is committed, generate and apply the reviewed-recipe import with `pnpm generate:recipe-import -- --output path/to/reviewed-recipes.sql`. The command validates every source YAML file in publication mode and refuses to write SQL while any recipe remains a draft.
6. Create an Inngest application pointed at `/api/inngest` and set its event/signing keys.
7. Configure at least one platform provider key. Direct OpenAI uses synchronous Responses requests with `store: false`; OpenRouter uses its OpenAI-compatible Chat Completions endpoint with structured outputs, zero-data-retention routing, and provider data collection denied. Owners select the provider and both model IDs in Settings.
8. To allow owner-supplied household keys, configure the AES-GCM keyring described below. Household keys are optional and are never returned after saving.
9. Deploy the Next.js application to Vercel and set the environment variables below. Do not set demo mode in production.
10. Create beta invite rows through a controlled operator process, then share `/onboarding/{raw-token}` only with the invited email owner. Raw tokens are stored only as hashes in Postgres.
11. Run the security, retention, device, and content gates in `docs/beta-runbook.md` before admitting a household.

Production environment variables (provider and household-key entries are
conditional as described below):

```dotenv
NEXT_PUBLIC_APP_URL=https://your-foodtopia.example
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
# Optional testing-only username alias. Set its password directly on the mapped
# Supabase Auth user; never store the password in Vercel or this repository.
FOODTOPIA_ADMIN_LOGIN_ENABLED=true
FOODTOPIA_ADMIN_USERNAME=Admin
FOODTOPIA_ADMIN_EMAIL=admin@example.com
OPENAI_API_KEY=...
OPENAI_VISION_MODEL=gpt-5.6-terra
OPENAI_RECIPE_MODEL=gpt-5.6-luna
OPENROUTER_API_KEY=...
OPENROUTER_VISION_MODEL=provider/vision-model
OPENROUTER_RECIPE_MODEL=provider/recipe-model
HOUSEHOLD_AI_CREDENTIAL_KEYRING={"2026-08":"<32-byte-base64-key>"}
HOUSEHOLD_AI_CREDENTIAL_ACTIVE_KEY_ID=2026-08
INNGEST_EVENT_KEY=...
INNGEST_SIGNING_KEY=...
```

`NEXT_PUBLIC_SUPABASE_ANON_KEY` remains supported as a compatibility alias for the publishable key.

When the administrator login flag is `true` and both mapping variables are
valid, `/sign-in` exposes a testing-only username/password form. The username
is resolved to the configured email only on the server; authentication still
uses the normal Supabase user session and does not grant service-role or
cross-household access.

Only the provider selected by a household needs a platform key. If the selected
source is `platform` and that provider key is absent, or the selected source is
`household` and its encrypted credential cannot be opened, AI calls fail closed;
they never fall back to another provider or deployment key.

Generate every keyring value from 32 random bytes and keep the JSON and active
key ID in server-only environment variables. To rotate, deploy the old and new
keys together with the new ID active. Runtime access re-encrypts old rows with a
compare-and-swap database update. Before removing an old key, verify that
`private.household_ai_credentials` contains zero rows for its
`encryption_key_id`. A malformed or incomplete keyring disables household-key
use rather than exposing or silently replacing a credential.

## Verification

```bash
pnpm check
pnpm build
pnpm test:e2e
pnpm validate:recipes:publication
pnpm generate:recipe-import -- --output path/to/reviewed-recipes.sql
pnpm eval:vision path/to/manifest.json path/to/vision-results.json
```

- `pnpm check` runs ESLint, TypeScript, unit tests, and preview recipe validation.
- `pnpm build` uses webpack because the Serwist integration generates the production service worker there.
- Playwright exercises Pixel 7 and iPhone 15 profiles. CI installs both Chromium and WebKit.
- Publication validation is expected to fail while any recipe lacks a genuine human reviewer and review date.
- Reviewed-recipe import generation has the same publication gate; omit `--output` to print SQL to stdout.
- The vision evaluation requires the consented, non-production 100-batch benchmark. The repository includes the input-manifest specification and a scorer for analyzer result JSON; a benchmark runner and the private photos must be supplied before the gate can run.

## Repository map

- `src/app` — App Router pages, manifest/icons, and internal HTTP endpoints.
- `src/components` — mobile product screens and accessible UI primitives.
- `src/contracts` — shared Zod HTTP and domain contracts.
- `src/domain` — inventory reduction, normalization, unit families, and deterministic recipe assessment/ranking.
- `src/server` — AI adapters, request authorization, repositories/services, and local demo state.
- `src/inngest` — durable analysis and purge functions.
- `src/lib/offline` — Dexie snapshot, cursor, ordered outbox, conflict handling, and cleanup.
- `src/sw.ts` — static-only caching and the `/~offline` navigation fallback.
- `content/recipes` — source-controlled original recipe YAML.
- `supabase` — SQL migrations and deterministic global concept/alias seed.
- `evals/vision` — benchmark manifest specification and scoring workflow.
- `docs` — beta acceptance and operational procedures.

## Deliberate boundaries

Foodtopia does not claim allergen safety, nutrition accuracy, freshness, edibility, or printed-date safety. The initial release also excludes barcode/receipt OCR, automatic date extraction, substitutions, generated recipes, shopping lists, meal calendars, nutrition optimization, push reminders, billing, native apps, and multi-household switching.

See `docs/operations.md` for raw-image retention, incident handling, and deletion procedures, and `src/app/privacy/page.tsx` for the user-facing beta notice.
