"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  ArrowRight,
  Camera,
  Check,
  Clock3,
  PackageOpen,
  Sparkles,
  Soup,
} from "lucide-react";
import { getCurrentHousehold, getUnfinishedAnalyses } from "@/lib/client/api";
import { useOfflineInventory } from "./offline-provider";
import { Badge, Card, EmptyState, Page } from "./ui";

function dateDistance(date: string) {
  const target = new Date(`${date}T12:00:00`);
  return Math.ceil((target.getTime() - Date.now()) / 86_400_000);
}

function dateLabel(date: string) {
  const days = dateDistance(date);
  if (days < 0) return `${Math.abs(days)}d past label`;
  if (days === 0) return "Label date today";
  if (days === 1) return "Label date tomorrow";
  return `Label date in ${days}d`;
}

export function HomeScreen() {
  const { lots, hydrated, outbox, apiMode, online } = useOfflineInventory();
  const [unfinished, setUnfinished] = useState<
    Awaited<ReturnType<typeof getUnfinishedAnalyses>>["analyses"]
  >([]);
  const [householdName, setHouseholdName] = useState<string | null>(null);
  const active = lots.filter((lot) => lot.status === "active");
  const locations = new Set(active.filter((lot) => lot.location !== "unknown").map((lot) => lot.location));
  const dated = active
    .filter((lot) => lot.dateLabel && dateDistance(lot.dateLabel) <= 5)
    .sort((a, b) => (a.dateLabel ?? "").localeCompare(b.dateLabel ?? ""))
    .slice(0, 3);
  const recent = [...lots]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, 3);

  useEffect(() => {
    if (!online) return;
    let cancelled = false;
    void Promise.allSettled([getUnfinishedAnalyses(), getCurrentHousehold()])
      .then(([analysesResult, householdResult]) => {
        if (cancelled) return;
        if (analysesResult.status === "fulfilled") {
          setUnfinished(analysesResult.value.analyses);
        }
        if (householdResult.status === "fulfilled") {
          setHouseholdName(householdResult.value.name);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [online]);

  return (
    <Page>
      <header className="mb-6">
        <p className="text-sm font-bold text-[var(--tomato)]">
          {householdName ? `${householdName} kitchen` : apiMode === "demo" ? "Maple Street kitchen" : "Your kitchen"}
        </p>
        <h1 className="mt-1 max-w-xl text-[clamp(2.15rem,9vw,3.5rem)] font-extrabold leading-[0.98] tracking-[-0.06em]">
          What’s in the kitchen?
        </h1>
        <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
          {apiMode === "demo" ? "Private beta demo" : "Shared household"} · {outbox.length ? `${outbox.length} change${outbox.length === 1 ? "" : "s"} waiting to sync` : "Everything on this device is saved"}
        </p>
      </header>

      <section className="relative overflow-hidden rounded-[2rem] bg-[var(--leaf)] p-6 text-white shadow-[0_20px_50px_rgba(35,89,67,0.2)] sm:p-8">
        <div className="absolute -right-10 -top-10 size-40 rounded-full bg-[#4f876e] opacity-55" />
        <div className="absolute -bottom-14 right-20 size-32 rounded-full bg-[var(--sun)] opacity-20" />
        <div className="relative max-w-md">
          <span className="mb-5 flex size-12 items-center justify-center rounded-2xl bg-white/14">
            <Camera className="size-6" aria-hidden="true" />
          </span>
          <h2 className="text-2xl font-extrabold tracking-[-0.035em]">Put groceries away once.</h2>
          <p className="mt-2 text-sm leading-6 text-white/76">
            Stage 1–3 clear photos. Foodtopia suggests the items; you review every one before it joins the household inventory.
          </p>
          <Link href="/capture" className="mt-6 inline-flex min-h-12 items-center gap-2 rounded-full bg-[var(--tomato)] px-5 font-bold text-white shadow-lg shadow-black/10">
            Photograph a batch <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        </div>
      </section>

      <section className="mt-4 grid grid-cols-3 gap-2" aria-label="Kitchen actions">
        <Link href="/capture" className="flex min-h-20 flex-col items-center justify-center gap-2 rounded-2xl border border-[var(--line)] bg-white/65 px-2 text-center text-xs font-extrabold text-[var(--leaf)]">
          <Camera className="size-5" aria-hidden="true" /> Photograph food
        </Link>
        <Link href="/inventory#add-manually" className="flex min-h-20 flex-col items-center justify-center gap-2 rounded-2xl border border-[var(--line)] bg-white/65 px-2 text-center text-xs font-extrabold text-[var(--leaf)]">
          <PackageOpen className="size-5" aria-hidden="true" /> Add manually
        </Link>
        <Link href="/recipes" className="flex min-h-20 flex-col items-center justify-center gap-2 rounded-2xl border border-[var(--line)] bg-white/65 px-2 text-center text-xs font-extrabold text-[var(--leaf)]">
          <Soup className="size-5" aria-hidden="true" /> What can I make?
        </Link>
      </section>

      {unfinished.length > 0 ? (
        <section className="mt-7">
          <h2 className="mb-3 text-xl font-extrabold tracking-tight">Unfinished photo reviews</h2>
          <div className="space-y-2">
            {unfinished.map((analysis) => (
              <Link key={analysis.id} href={`/analysis/${analysis.id}`} className="flex min-h-16 items-center gap-3 rounded-2xl border border-[var(--line)] bg-white/65 px-4 py-3">
                <Camera className="size-5 shrink-0 text-[var(--tomato)]" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block font-bold">
                    {analysis.status === "needs_review"
                      ? "Photo review waiting"
                      : analysis.status === "failed"
                        ? "Photo scan needs attention"
                        : "Photo analysis in progress"}
                  </span>
                  <span className="block text-xs text-[var(--muted)]">
                    {analysis.candidateCount > 0
                      ? `${analysis.candidateCount} suggestion${analysis.candidateCount === 1 ? "" : "s"} to check`
                      : "Open for status and next steps"}
                  </span>
                </span>
                <span className="text-xs font-extrabold text-[var(--leaf)]">Open</span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <div className="mt-4 grid grid-cols-2 gap-3">
        <Card className="p-4 shadow-none">
          <div className="flex size-9 items-center justify-center rounded-xl bg-[var(--sprout)] text-[var(--leaf)]">
            <PackageOpen className="size-4" aria-hidden="true" />
          </div>
          <p className="mt-4 text-3xl font-extrabold tracking-tight">{hydrated ? active.length : "—"}</p>
          <p className="text-xs font-semibold text-[var(--muted)]">active item{active.length === 1 ? "" : "s"}</p>
        </Card>
        <Card className="p-4 shadow-none">
          <div className="flex size-9 items-center justify-center rounded-xl bg-[#f7edc8] text-[#735d16]">
            <Sparkles className="size-4" aria-hidden="true" />
          </div>
          <p className="mt-4 text-3xl font-extrabold tracking-tight">{locations.size || "—"}</p>
          <p className="text-xs font-semibold text-[var(--muted)]">known storage area{locations.size === 1 ? "" : "s"}</p>
        </Card>
      </div>

      <section className="mt-8">
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--tomato)]">Tonight</p>
            <h2 className="text-xl font-extrabold tracking-tight">Cook from what you have</h2>
          </div>
          <Link href="/recipes" className="inline-flex min-h-11 items-center text-sm font-bold text-[var(--leaf)]">Find recipes <ArrowRight className="ml-1 size-4" aria-hidden="true" /></Link>
        </div>
        <Link href="/recipes" className="flex min-h-28 items-center gap-4 rounded-[1.65rem] border border-[var(--line)] bg-[var(--card)] p-5 shadow-[var(--shadow)] transition hover:border-[var(--leaf)]">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-[var(--tomato-soft)] text-[var(--tomato)]"><Soup aria-hidden="true" /></span>
          <span className="min-w-0 flex-1">
            <span className="block font-extrabold">“Something cozy in 30 minutes”</span>
            <span className="mt-1 block text-sm leading-5 text-[var(--muted)]">Ask naturally. Every result shows what’s present, uncertain, or missing.</span>
          </span>
          <ArrowRight className="size-5 shrink-0 text-[var(--muted)]" aria-hidden="true" />
        </Link>
      </section>

      {recent.length > 0 ? (
        <section className="mt-8">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-xl font-extrabold tracking-tight">Recent household changes</h2>
            <Link href="/inventory" className="inline-flex min-h-11 items-center text-sm font-bold text-[var(--leaf)]">View inventory</Link>
          </div>
          <div className="overflow-hidden rounded-3xl border border-[var(--line)] bg-white/65">
            {recent.map((lot, index) => (
              <Link key={lot.id} href={`/inventory#lot-${lot.id}`} className={`flex min-h-16 items-center gap-3 px-4 py-3 ${index ? "border-t border-[var(--line)]" : ""}`}>
                <PackageOpen className="size-5 shrink-0 text-[var(--leaf)]" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-bold">{lot.name}</span>
                  <span className="block text-xs capitalize text-[var(--muted)]">{lot.version === 0 ? "Added" : "Updated"} · {lot.status}</span>
                </span>
                <Badge>{lot.location === "unknown" ? "No location" : lot.location}</Badge>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <section className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xl font-extrabold tracking-tight">Use soon</h2>
          <Link href="/inventory" className="inline-flex min-h-11 items-center text-sm font-bold text-[var(--leaf)]">View all</Link>
        </div>
        {dated.length ? (
          <div className="space-y-2">
            {dated.map((lot) => (
              <Link href={`/inventory#lot-${lot.id}`} key={lot.id} className="flex min-h-16 items-center gap-3 rounded-2xl border border-[var(--line)] bg-white/65 px-4 py-3">
                <Clock3 className="size-5 shrink-0 text-[var(--tomato)]" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-bold">{lot.name}</span>
                  <span className="block text-xs capitalize text-[var(--muted)]">{lot.location} · date label only</span>
                </span>
                <Badge tone={dateDistance(lot.dateLabel!) <= 1 ? "orange" : "yellow"}>{dateLabel(lot.dateLabel!)}</Badge>
              </Link>
            ))}
            <p className="px-1 pt-1 text-xs leading-5 text-[var(--muted)]">Date labels are quality cues, not a safety determination. Check the food and follow official storage guidance.</p>
          </div>
        ) : (
          <EmptyState
            icon={<Check className="size-6" aria-hidden="true" />}
            title={active.length ? "No nearby date labels" : "Your kitchen starts here"}
            description={active.length ? "Nothing with a recorded date label is coming up in the next five days." : "Photograph a staged batch to build the household inventory."}
          />
        )}
      </section>
    </Page>
  );
}
