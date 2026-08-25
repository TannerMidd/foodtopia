"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Camera, Utensils } from "lucide-react";
import { getCurrentHousehold, getUnfinishedAnalyses } from "@/lib/client/api";
import { ApiClientError } from "@/lib/client/api";
import type { FoodLocation } from "@/contracts/domain";
import {
  amountText,
  capitalNumberWord,
  clockTime,
  dateKindShort,
  daysUntil,
  isDatePressing,
  locationNames,
  longDate,
  relativeDate,
} from "./format";
import { useOfflineInventory } from "./offline-provider";
import { Page, cn } from "./ui";

const shelves: FoodLocation[] = ["fridge", "pantry", "freezer"];

function headline(pressing: number, active: number) {
  if (!active) return "The kitchen is empty.";
  if (!pressing) return "Nothing wants using this week.";
  return `${capitalNumberWord(pressing)} thing${pressing === 1 ? "" : "s"} want${pressing === 1 ? "s" : ""} using this week.`;
}

/* The disc: the only shape that carries a number. */
function DateDisc({
  date,
  kind,
  pressing,
}: {
  date: string;
  kind: ReturnType<typeof dateKindShort>;
  pressing: boolean;
}) {
  return (
    <span
      className={cn(
        "disc",
        pressing ? "disc-accent" : "!bg-[var(--ground-tint)] !text-[var(--ink-2)]",
      )}
    >
      <span className="disc-num !text-[19px]">{relativeDate(date)}</span>
      <span className="disc-sub">{kind}</span>
    </span>
  );
}

export function HomeScreen() {
  const { lots, hydrated, outbox, apiMode, online } = useOfflineInventory();
  const [unfinished, setUnfinished] = useState<
    Awaited<ReturnType<typeof getUnfinishedAnalyses>>["analyses"]
  >([]);
  const [householdName, setHouseholdName] = useState<string | null>(null);
  const [needsHousehold, setNeedsHousehold] = useState(false);

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
        else if (
          householdResult.reason instanceof ApiClientError &&
          householdResult.reason.code === "HOUSEHOLD_ACCESS_DENIED"
        ) {
          // Authenticated and enabled, but no household membership yet.
          setNeedsHousehold(true);
        }
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
        <p className="ml !text-[var(--accent)]">{longDate()}</p>
        <h1 className="hd mt-3 max-w-[24rem] text-[clamp(2rem,7.5vw,2.4rem)]">
          {hydrated ? headline(pressing.length, active.length) : " "}
        </h1>
        <p className="bd mt-3 max-w-[32rem] text-[15px]">
          Everything else in {kitchen} is fine. Nothing here changes without you.
        </p>
      </header>

      <div className="mt-10 flex flex-col gap-12 lg:flex-row lg:gap-10">
        <div className="flex min-w-0 flex-1 flex-col gap-10">
          {unfinished.length > 0 && (
            <section className="flex flex-col gap-3">
              <p className="ml">waiting</p>
              {unfinished.map((analysis) => (
                <Link
                  key={analysis.id}
                  href={`/analysis/${analysis.id}`}
                  className="row row-link"
                >
                  <span className="nm min-w-0 flex-1 truncate">
                    {analysis.status === "needs_review"
                      ? "Photo review waiting"
                      : analysis.status === "failed"
                        ? "Photo scan needs attention"
                        : "Photo analysis in progress"}
                  </span>
                  <span className="m text-[11px] text-[var(--ink-5)]">
                    {analysis.candidateCount > 0
                      ? `${analysis.candidateCount} to check`
                      : "open for status"}
                  </span>
                </Link>
              ))}
            </section>
          )}

          {needsHousehold && (
            <section className="flex flex-col gap-3">
              <p className="ml">get started</p>
              <div className="row">
                <span className="nm min-w-0 flex-1">Create your household</span>
                <Link
                  href="/onboarding"
                  className="m shrink-0 text-[12px] font-semibold text-[var(--accent)] underline underline-offset-2"
                >
                  set up
                </Link>
              </div>
              <p className="bd text-[12.5px] leading-relaxed text-[var(--ink-5)]">
                Your account is active but no kitchen is linked to it yet. Create one to start
                capturing inventory.
              </p>
            </section>
          )}

          <section className="flex flex-col gap-3">
            <p className="ml">use soon</p>
            {pressing.length ? (
              <>
                {pressing.map((lot) => (
                  <Link key={lot.id} href={`/inventory#lot-${lot.id}`} className="row row-link">
                    <span className="min-w-0 flex-1">
                      <span className="nm block truncate font-[family-name:var(--font-familjen)] text-[19px]">
                        {lot.name}
                      </span>
                      <span className="m mt-1 block truncate text-[11px] font-semibold uppercase tracking-[0.13em] text-[var(--ink-5)]">
                        {locationNames[lot.location]}
                        {lot.quantityStatus !== "unknown" ? ` · ${amountText(lot)}` : " · amount unknown"}
                      </span>
                    </span>
                    {lot.dateLabel && (
                      <DateDisc
                        date={lot.dateLabel}
                        kind={dateKindShort(lot.dateLabelType)}
                        pressing={isDatePressing(lot)}
                      />
                    )}
                  </Link>
                ))}
                <p className="bd px-1 pt-1 text-[12.5px] leading-relaxed text-[var(--ink-5)]">
                  Printed dates are recorded as written — a quality cue, not a safety decision.
                </p>
              </>
            ) : (
              <div className="row min-h-0 items-start">
                <p className="bd">
                  {active.length
                    ? "Nothing with a recorded date is coming up in the next five days."
                    : "Photograph a staged batch to start the household inventory."}
                </p>
              </div>
            )}
          </section>

          <section className="flex flex-col gap-3">
            <p className="ml">on the shelves</p>
            <div className="flex gap-2.5">
              {shelves.map((location) => {
                const group = active.filter((lot) => lot.location === location);
                const untracked = group.filter((lot) => lot.quantityStatus === "unknown").length;
                const empty = group.length === 0;
                return (
                  <Link
                    key={location}
                    href={`/inventory#shelf-${location}`}
                    className={cn(
                      "row-link flex min-w-0 flex-1 flex-col items-center rounded-[20px] px-3 py-[18px] text-center transition",
                      empty ? "bg-[var(--ground)]" : "bg-[var(--ground-hi)]",
                    )}
                  >
                    <span
                      className={cn(
                        "disc !size-[52px]",
                        empty && "!bg-[var(--ground-tint)]",
                      )}
                    >
                      <span
                        className={cn(
                          "disc-num !text-[20px]",
                          empty && "!text-[var(--ink-6)]",
                        )}
                      >
                        {String(group.length).padStart(2, "0")}
                      </span>
                    </span>
                    <span className="m mt-3 text-[14px] font-semibold capitalize">{locationNames[location]}</span>
                    <span className="m mt-1 text-[11px] text-[var(--ink-5)]">
                      {empty
                        ? "empty"
                        : untracked
                          ? `${untracked} unknown`
                          : "all tracked"}
                    </span>
                  </Link>
                );
              })}
            </div>
          </section>

          {recent.length > 0 && (
            <section className="flex flex-col gap-2">
              <p className="ml">lately</p>
              {recent.map((lot) => (
                <div
                  key={lot.id}
                  className="flex items-center gap-3.5 rounded-[16px] bg-[var(--ground)] px-[18px] py-3"
                >
                  <span className="m w-[38px] flex-none text-[11px] font-semibold text-[var(--sage)]">
                    {clockTime(lot.updatedAt)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[14px] text-[var(--ink-2)]">
                    {lot.name} {lot.version === 0 ? "added to" : "updated in"} the{" "}
                    {locationNames[lot.location]}
                  </span>
                </div>
              ))}
            </section>
          )}
        </div>

        {/* The right margin holds what to do next, never more facts. */}
        <aside className="flex w-full flex-col gap-9 lg:w-[280px] lg:flex-none">
          <div className="rounded-[26px] bg-[var(--accent)] p-6 text-[var(--accent-ink)]">
            <p className="ml !text-[var(--accent-deep)]">when you get home</p>
            <p className="hd mt-2.5 text-[24px] !text-[var(--accent-ink)]">
              Put the bags down. Shoot the counter.
            </p>
            <p className="mt-2.5 text-[13.5px] leading-relaxed text-[var(--accent-deep-2)]">
              Foodtopia proposes the items; you keep or drop each one before anything is saved.
            </p>
            <Link
              href="/capture"
              className="mt-4 inline-flex min-h-[52px] w-full items-center justify-center gap-2.5 rounded-full bg-[var(--page)] px-5 text-[15px] font-semibold text-[var(--ink)] transition hover:bg-black"
            >
              <Camera className="size-[18px] text-[var(--accent)]" aria-hidden="true" />
              Photograph a batch
            </Link>
          </div>

          <div>
            <p className="ml !text-[var(--sage)]">tonight</p>
            <p className="hd mt-2.5 text-[20px]">Ask for what sounds good.</p>
            <p className="bd mt-2 text-[13.5px]">
              Every result shows what is present, uncertain, or missing.
            </p>
            <Link
              href="/recipes"
              className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-full bg-[var(--ground-hi)] px-5 text-[14.5px] font-semibold text-[var(--ink)] transition hover:bg-[var(--ground-tint)]"
            >
              <Utensils className="size-4 text-[var(--sage)]" aria-hidden="true" />
              Find something to cook
            </Link>
          </div>

          {outbox.length > 0 && (
            <p className="m rounded-[16px] bg-[var(--ground)] px-4 py-3 text-[10.5px] leading-relaxed text-[var(--ink-5)]">
              {outbox.length} change{outbox.length === 1 ? "" : "s"} queued on this device
            </p>
          )}
        </aside>
      </div>
    </Page>
  );
}
