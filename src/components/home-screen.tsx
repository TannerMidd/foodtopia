"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Camera } from "lucide-react";
import { getCurrentHousehold, getUnfinishedAnalyses } from "@/lib/client/api";
import type { FoodLocation } from "@/contracts/domain";
import {
  amountText,
  capitalNumberWord,
  clockTime,
  dateText,
  daysUntil,
  isDatePressing,
  locationNames,
  longDate,
} from "./format";
import { useOfflineInventory } from "./offline-provider";
import { Page, Section, cn } from "./ui";

const shelves: FoodLocation[] = ["fridge", "pantry", "freezer"];

function headline(pressing: number, active: number) {
  if (!active) return "The kitchen is empty.";
  if (!pressing) return "Nothing wants using this week.";
  return `${capitalNumberWord(pressing)} thing${pressing === 1 ? "" : "s"} want${pressing === 1 ? "s" : ""} using this week.`;
}

export function HomeScreen() {
  const { lots, hydrated, outbox, apiMode, online } = useOfflineInventory();
  const [unfinished, setUnfinished] = useState<
    Awaited<ReturnType<typeof getUnfinishedAnalyses>>["analyses"]
  >([]);
  const [householdName, setHouseholdName] = useState<string | null>(null);

  const active = lots.filter((lot) => lot.status === "active");
  const pressing = active
    .filter((lot) => lot.dateLabel && daysUntil(lot.dateLabel) <= 5)
    .sort((a, b) => (a.dateLabel ?? "").localeCompare(b.dateLabel ?? ""))
    .slice(0, 4);
  const recent = [...lots]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, 3);

  useEffect(() => {
    if (!online) return;
    let cancelled = false;
    void Promise.allSettled([getUnfinishedAnalyses(), getCurrentHousehold()]).then(
      ([analysesResult, householdResult]) => {
        if (cancelled) return;
        if (analysesResult.status === "fulfilled") setUnfinished(analysesResult.value.analyses);
        if (householdResult.status === "fulfilled") setHouseholdName(householdResult.value.name);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [online]);

  const kitchen = householdName ?? (apiMode === "demo" ? "Maple Street" : "your kitchen");

  return (
    <Page>
      <header>
        <p className="ml">{longDate()}</p>
        <h1 className="hd mt-3 text-[clamp(1.75rem,6vw,1.9rem)]">
          {hydrated ? headline(pressing.length, active.length) : " "}
        </h1>
        <p className="bd mt-2.5 max-w-[32rem]">
          Everything else in {kitchen} is fine. Nothing here changes without you.
        </p>
      </header>

      <div className="mt-11 flex flex-col gap-10 lg:flex-row lg:gap-9">
        <div className="flex min-w-0 flex-1 flex-col gap-10">
          {unfinished.length > 0 && (
            <Section label="waiting">
              {unfinished.map((analysis) => (
                <Link key={analysis.id} href={`/analysis/${analysis.id}`} className="row row-link px-1">
                  <span className="nm flex-1 truncate">
                    {analysis.status === "needs_review"
                      ? "Photo review waiting"
                      : analysis.status === "failed"
                        ? "Photo scan needs attention"
                        : "Photo analysis in progress"}
                  </span>
                  <span className="m text-[11px] text-[var(--ink-6)]">
                    {analysis.candidateCount > 0
                      ? `${analysis.candidateCount} to check`
                      : "open for status"}
                  </span>
                </Link>
              ))}
            </Section>
          )}

          <Section label="use soon">
            {pressing.length ? (
              <>
                {pressing.map((lot) => (
                  <Link key={lot.id} href={`/inventory#lot-${lot.id}`} className="row row-link px-1">
                    <span className="nm min-w-0 flex-1 truncate">{lot.name}</span>
                    <span className="m hidden text-[11px] text-[var(--ink-6)] sm:inline">
                      {locationNames[lot.location]}
                      {lot.quantityStatus !== "unknown" ? ` · ${amountText(lot)}` : ""}
                    </span>
                    <span
                      className={cn(
                        "m w-[132px] whitespace-nowrap text-right text-[11px]",
                        isDatePressing(lot) ? "text-[var(--time)]" : "text-[var(--ink-4)]",
                      )}
                    >
                      {dateText(lot)}
                    </span>
                  </Link>
                ))}
                <p className="bd pt-3.5 text-[12px] leading-relaxed text-[var(--ink-6)]">
                  Printed dates are recorded as written — a quality cue, not a safety decision.
                </p>
              </>
            ) : (
              <p className="bd py-4 text-[var(--ink-4)]">
                {active.length
                  ? "Nothing with a recorded date is coming up in the next five days."
                  : "Photograph a staged batch to start the household inventory."}
              </p>
            )}
          </Section>

          <Section label="on the shelves">
            {shelves.map((location) => {
              const group = active.filter((lot) => lot.location === location);
              const untracked = group.filter((lot) => lot.quantityStatus === "unknown").length;
              return (
                <Link
                  key={location}
                  href={`/inventory#shelf-${location}`}
                  className="row row-link px-1"
                >
                  <span className={cn("nm flex-1 capitalize", !group.length && "text-[var(--ink-5)]")}>
                    {locationNames[location]}
                  </span>
                  <span className="m text-[11px] text-[var(--ink-6)]">
                    {group.length
                      ? `${group.length} item${group.length === 1 ? "" : "s"}${untracked ? ` · ${untracked} amount unknown` : ""}`
                      : "empty"}
                  </span>
                </Link>
              );
            })}
          </Section>

          {recent.length > 0 && (
            <Section label="lately">
              {recent.map((lot) => (
                <Link key={lot.id} href={`/inventory#lot-${lot.id}`} className="row row-link min-h-11 px-1">
                  <span className="m w-[46px] flex-none text-[10.5px] text-[var(--ink-6)]">
                    {clockTime(lot.updatedAt)}
                  </span>
                  <span className="bd min-w-0 flex-1 truncate text-[var(--ink-2)]">
                    {lot.name} {lot.version === 0 ? "added to" : "updated in"} the{" "}
                    {locationNames[lot.location]}
                  </span>
                </Link>
              ))}
            </Section>
          )}
        </div>

        {/* The right margin holds what to do next, never more facts. */}
        <aside className="flex w-full flex-col gap-9 lg:w-[270px] lg:flex-none">
          <div>
            <p className="ml">when you get home</p>
            <p className="bd mt-3">
              Photograph the bags on the counter. Foodtopia proposes the items; you keep or drop each
              one before anything is saved.
            </p>
            <Link
              href="/capture"
              className="glow mt-4 inline-flex min-h-11 items-center gap-2.5 rounded-[3px] px-[18px] text-[15px] font-light"
            >
              <Camera className="size-4 text-[var(--accent-ink)]" aria-hidden="true" />
              Photograph a batch
            </Link>
          </div>

          <div className="border-t border-[var(--hairline)] pt-5">
            <p className="ml">tonight</p>
            <p className="bd mt-3">
              Ask for what sounds good. Every result shows what is present, uncertain, or missing.
            </p>
            <Link
              href="/recipes"
              className="nm mt-4 inline-flex min-h-11 items-center border-b border-[var(--accent-rule)] pb-0.5 text-[var(--ink)]"
            >
              Find something to cook
            </Link>
          </div>

          {outbox.length > 0 && (
            <p className="m border-t border-[var(--hairline)] pt-5 text-[10.5px] leading-relaxed text-[var(--ink-6)]">
              {outbox.length} change{outbox.length === 1 ? "" : "s"} queued on this device
            </p>
          )}
        </aside>
      </div>
    </Page>
  );
}
