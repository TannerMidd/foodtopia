import type { Metadata } from "next";
import Link from "next/link";

import { Card, Page, PageHeader, StateNotice } from "@/components/ui";

export const metadata: Metadata = {
  title: "Beta privacy notice",
  description: "How Foodtopia handles grocery photos, inventory, prompts, and offline data during the private beta.",
};

export default function PrivacyPage() {
  return (
    <Page>
      <PageHeader
        eyebrow="Private beta"
        title="Privacy notice"
        description="Plain-language handling rules for household data during the US-English beta. Last updated August 14, 2026."
      />

      <StateNotice title="Photos are temporary drafts" tone="success">
        Uploaded grocery photos are private processing inputs. Foodtopia requests deletion as soon as a batch is applied or cancelled, and the retention sweeper targets every remaining raw object no later than 24 hours after upload. Structured review candidates may remain in the household record.
      </StateNotice>

      <Card className="mt-4 space-y-5 text-sm leading-6 text-[var(--muted)]">
        <section>
          <h2 className="text-lg font-extrabold text-[var(--ink)]">Cloud AI processing</h2>
          <p className="mt-1">A household owner chooses OpenAI directly or OpenRouter in Settings, along with separate vision and recipe model IDs. Foodtopia shows the current route before first-scan consent. The owner may change that household route later; the consent notice covers both routes and OpenRouter&apos;s selected underlying model provider.</p>
          <p className="mt-2">Foodtopia sends the one to three photos in a batch through the selected route. When you enter a meal prompt, it also sends that prompt for intent parsing and sends a limited set of recipe titles, times, tiers, and per-ingredient evidence so the provider can explain deterministic results. The provider does not decide eligibility or change recipe content.</p>
          <p className="mt-2">For direct OpenAI requests, Foodtopia disables response storage. OpenAI states API data is not used to train its models unless the organization opts in; default abuse-monitoring logs may be retained for up to 30 days. For OpenRouter, Foodtopia requests zero-data-retention routing, requires supported structured-output parameters, and denies provider data collection. Route availability and the underlying provider&apos;s handling can vary, so these controls are requests rather than a blanket retention promise.</p>
          <p className="mt-2">Production photos and meal prompts must never be enrolled in training or evaluation. Suggestions can be incomplete or wrong and remain drafts until reviewed.</p>
        </section>
        <section>
          <h2 className="text-lg font-extrabold text-[var(--ink)]">Household records</h2>
          <p className="mt-1">Inventory, review candidates, preferences, AI provider metadata, invitations, cooking reconciliations, and audit events are stored for the active household. Access is limited by authenticated household membership and database row-level security. An optional household provider API key is encrypted with a server-held keyring, is editable only by the owner, and is never returned to the browser after saving. Foodtopia does not make freshness, edibility, nutrition, or allergen-safety claims.</p>
        </section>
        <section>
          <h2 className="text-lg font-extrabold text-[var(--ink)]">This device</h2>
          <p className="mt-1">The PWA keeps the active household&apos;s recent inventory snapshot, sync cursor, and pending commands in IndexedDB. It does not put raw photos in that offline database. Signing out clears Foodtopia&apos;s IndexedDB rows and caches on the device.</p>
        </section>
        <section>
          <h2 className="text-lg font-extrabold text-[var(--ink)]">Product telemetry</h2>
          <p className="mt-1">Beta telemetry may record event names, counts, timings, correction actions, recipe openings, cooking, reconciliation, and operational correlation IDs. It must never contain raw photos, inventory labels, ingredient names entered by a household, email addresses, or prompt text.</p>
        </section>
        <section>
          <h2 className="text-lg font-extrabold text-[var(--ink)]">Deletion and beta support</h2>
          <p className="mt-1">A household owner can start deletion from the Household screen. Access is quarantined immediately, private objects are removed, and permanent database deletion follows after outstanding photo-upload links expire. Operations record only completion metadata, never the deleted food data. Supabase Auth account deletion is handled separately when requested.</p>
        </section>
      </Card>

      <Link href="/settings" className="mt-5 inline-flex min-h-12 items-center rounded-full border border-[var(--line)] bg-white px-5 font-bold text-[var(--leaf)]">Back to settings</Link>
    </Page>
  );
}
