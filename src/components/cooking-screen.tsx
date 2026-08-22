"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Check } from "lucide-react";
import type { InventoryCommand, RecipeAssessment } from "@/contracts/domain";
import {
  allocateIngredientAcrossLots,
  cookLotChoiceKey,
  type CookLotAllocation,
} from "@/domain/cook-allocation";
import { ApiClientError, reconcileCookSession, type ReconciliationChange } from "@/lib/client/api";
import { loadCookSession, loadRecipeAssessment } from "@/lib/client/recipe-cache";
import { amountText, locationNames, numberWord } from "./format";
import { useOfflineInventory } from "./offline-provider";
import { Button, Field, Page, Section, StateNotice, cn, inputClass } from "./ui";

type Choice = { action: "no_change" | "used_some" | "used_up"; quantity: string };

const noChangeChoice: Choice = { action: "no_change", quantity: "" };

const actionLabels = {
  no_change: "no change",
  used_some: "used some",
  used_up: "used up",
} as const;

function suggestedChoice(allocation: CookLotAllocation | undefined): Choice {
  if (allocation?.suggestedAction === "used_up") return { action: "used_up", quantity: "" };
  if (allocation?.suggestedAction === "used_some" && allocation.suggestedQuantity !== null) {
    return { action: "used_some", quantity: allocation.suggestedQuantity.toString() };
  }
  return noChangeChoice;
}

export function CookingScreen({ slug }: { slug: string }) {
  const { lots, online, queueCommand, refresh } = useOfflineInventory();
  const [assessment, setAssessment] = useState<RecipeAssessment | null | undefined>(undefined);
  const [sessionId, setSessionId] = useState("");
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [reconciling, setReconciling] = useState(false);
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [undoCommands, setUndoCommands] = useState<InventoryCommand[]>([]);
  const [undoing, setUndoing] = useState(false);
  const [undone, setUndone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setAssessment(loadRecipeAssessment(slug));
      setSessionId(loadCookSession(slug) ?? "");
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [slug]);

  const reconcilable = useMemo(
    () => assessment?.evidence.filter((item) => item.lotIds.length > 0) ?? [],
    [assessment],
  );
  const lotsById = useMemo(() => new Map(lots.map((lot) => [lot.id, lot])), [lots]);
  const allocationsByChoice = useMemo(() => {
    const result: Record<string, CookLotAllocation> = {};
    if (!assessment) return result;
    const ingredientsById = new Map(
      assessment.recipe.ingredients.map((ingredient) => [ingredient.id, ingredient]),
    );

    for (const evidence of assessment.evidence) {
      const ingredient = ingredientsById.get(evidence.ingredientId);
      if (!ingredient) continue;
      const evidenceLots = evidence.lotIds.flatMap((lotId) => {
        const lot = lotsById.get(lotId);
        return lot ? [lot] : [];
      });
      for (const allocation of allocateIngredientAcrossLots(ingredient, evidenceLots)) {
        result[cookLotChoiceKey(evidence.ingredientId, allocation.lotId)] = allocation;
      }
    }
    return result;
  }, [assessment, lotsById]);

  if (assessment === undefined) {
    return (
      <Page className="max-w-[42rem]">
        <div className="skeleton h-4 w-40" />
        <div className="skeleton mt-6 h-9 w-72" />
        <div className="skeleton mt-8 h-40" />
      </Page>
    );
  }

  if (!assessment || !sessionId) {
    return (
      <Page className="max-w-[42rem]">
        <p className="ml">cooking</p>
        <h1 className="hd mt-3 text-[26px]">No cooking session here.</h1>
        <p className="bd mt-2.5 max-w-md">
          Open a recipe from the suggestions and choose Cook this. Foodtopia will not invent a local
          session, because settling the kitchen afterwards needs a matching server session.
        </p>
        <Link
          href="/recipes"
          className="glow mt-7 inline-flex min-h-11 items-center rounded-[3px] px-[18px] text-[15px] font-light"
        >
          Find a recipe
        </Link>
      </Page>
    );
  }

  async function undoReconciliation() {
    if (!online) {
      setError("Reconnect before undoing these shared inventory changes.");
      return;
    }
    setUndoing(true);
    setError(null);
    try {
      for (const command of undoCommands) {
        await queueCommand(command);
        // Wait for each lot to settle before replaying the next inverse. This
        // keeps the ordered outbox deterministic if a shared edit conflicts.
        await refresh(true);
      }
      setUndoCommands([]);
      setUndone(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The kitchen update could not be undone.");
    } finally {
      setUndoing(false);
    }
  }

  if (done) {
    return (
      <Page className="max-w-[42rem]">
        <p className="ml">the ingredient check · done</p>
        <h1 className="hd mt-3 text-[26px]">{undone ? "Kitchen changes undone" : "Kitchen updated"}</h1>
        <p className="bd mt-2.5 max-w-md">
          {undone
            ? "The prior amounts and presence were restored through new inventory events."
            : "Your choices were settled against the latest household inventory."}
        </p>
        {error && (
          <div className="mt-6">
            <StateNotice title="Undo needs attention" tone="error">
              {error}
            </StateNotice>
          </div>
        )}
        <div className="mt-7 flex flex-wrap items-center gap-6">
          <Link
            href="/inventory"
            className="glow inline-flex min-h-11 items-center rounded-[3px] px-[18px] text-[15px] font-light"
          >
            Open the kitchen
          </Link>
          {!undone && undoCommands.length > 0 && (
            <button
              type="button"
              className="m border-b border-[var(--edge-strong)] pb-0.5 text-[11px] text-[var(--ink-4)] hover:text-[var(--ink)] disabled:opacity-40"
              disabled={!online || undoing}
              onClick={() => void undoReconciliation()}
            >
              undo inventory changes
            </button>
          )}
        </div>
      </Page>
    );
  }

  const recipe = assessment.recipe;

  function setChoice(id: string, update: Partial<Choice>, fallback: Choice) {
    setChoices((current) => ({ ...current, [id]: { ...(current[id] ?? fallback), ...update } }));
  }

  async function saveReconciliation() {
    if (!online) {
      setError("Connect to settle shared inventory. Your cooking checklist stays on this screen.");
      return;
    }
    const changes: ReconciliationChange[] = [];
    const inverses: InventoryCommand[] = [];
    for (const evidence of reconcilable) {
      for (const lotId of evidence.lotIds) {
        const choiceKey = cookLotChoiceKey(evidence.ingredientId, lotId);
        const allocation = allocationsByChoice[choiceKey];
        const choice = choices[choiceKey] ?? suggestedChoice(allocation);
        const lot = lotsById.get(lotId);
        if (!lot) {
          setError(`${evidence.ingredientName} changed in the household. Refresh the kitchen and review again.`);
          return;
        }
        if (choice.action === "used_some" && (!choice.quantity || Number(choice.quantity) <= 0)) {
          setError(`Enter how much ${evidence.ingredientName} was used from ${lot.name}.`);
          return;
        }
        if (choice.action === "used_some" && !allocation?.canUseSome) {
          setError(
            `Choose “used up” or “no change” for ${lot.name}, because its amount is unknown or incompatible with the recipe unit.`,
          );
          return;
        }
        if (choice.action === "used_some" && lot.quantity !== null && Number(choice.quantity) >= lot.quantity) {
          setError(`Choose “used up” for ${lot.name} when the whole lot was used.`);
          return;
        }
        changes.push({
          ingredientId: evidence.ingredientId,
          lotId: lot.id,
          action: choice.action,
          quantity: choice.action === "used_some" ? Number(choice.quantity) : null,
          unit: choice.action === "used_some" ? lot.unit : null,
          expectedVersion: lot.version,
        });
        if (choice.action === "used_up") {
          inverses.push({
            commandId: crypto.randomUUID(),
            type: "restore",
            expectedVersion: lot.version + 1,
            payload: { lotId: lot.id },
          });
        } else if (choice.action === "used_some") {
          inverses.push({
            commandId: crypto.randomUUID(),
            type: "adjust",
            expectedVersion: lot.version + 1,
            payload: {
              lotId: lot.id,
              quantityStatus: lot.quantityStatus,
              quantity: lot.quantity,
              unit: lot.unit,
            },
          });
        }
      }
    }
    setSaving(true);
    setError(null);
    try {
      await reconcileCookSession(sessionId, changes);
      await refresh(true);
      setUndoCommands(inverses);
      setDone(true);
    } catch (caught) {
      if (caught instanceof ApiClientError && caught.status === 409)
        setError(
          "Someone changed an ingredient while you cooked. Refresh the kitchen, then review these amounts against the latest version.",
        );
      else setError(caught instanceof Error ? caught.message : "The kitchen could not be updated.");
    } finally {
      setSaving(false);
    }
  }

  /* Step two: the only screen in the app that writes to shared inventory. */
  if (reconciling) {
    const lotCount = reconcilable.reduce((total, evidence) => total + evidence.lotIds.length, 0);
    return (
      <Page className="max-w-[42rem]">
        <header>
          <p className="ml">the ingredient check</p>
          <h1 className="hd mt-3 text-[clamp(1.5rem,6vw,1.65rem)]">What did you use?</h1>
          <p className="bd mt-2.5 max-w-[30rem]">
            {lotCount
              ? `${numberWord(lotCount)} lot${lotCount === 1 ? "" : "s"} to settle. Leave one alone if you are not sure — “no change” is always fine.`
              : "Nothing here is linked to the kitchen, so finishing changes nothing."}
          </p>
        </header>

        {!online && (
          <div className="mt-6">
            <StateNotice title="Connect to save household changes" tone="warning">
              Settling writes to shared inventory and is not queued offline.
            </StateNotice>
          </div>
        )}
        {error && (
          <div className="mt-6">
            <StateNotice title="Review needed" tone="error">
              {error}
            </StateNotice>
          </div>
        )}

        <div className="mt-9 flex flex-col gap-8">
          {reconcilable.map((evidence) => (
            <Section
              key={evidence.ingredientId}
              label={evidence.ingredientName.toLowerCase()}
              labelWidth="78px"
            >
              {evidence.lotIds.map((lotId) => {
                const choiceKey = cookLotChoiceKey(evidence.ingredientId, lotId);
                const lot = lotsById.get(lotId);
                const allocation = allocationsByChoice[choiceKey];
                const fallback = suggestedChoice(allocation);
                const choice = choices[choiceKey] ?? fallback;

                if (!lot) {
                  return (
                    <p key={choiceKey} className="bd py-4 text-[var(--time)]">
                      This inventory lot changed or is no longer available.
                    </p>
                  );
                }

                const suggestion =
                  allocation?.suggestedAction === "used_up"
                    ? "The recipe would use the whole lot."
                    : allocation?.suggestedAction === "used_some" && allocation.suggestedQuantity !== null
                      ? `The recipe would use about ${allocation.suggestedQuantity} ${lot.unit ?? ""}.`.trim()
                      : allocation?.canUseSome
                        ? "The recipe amount comes from earlier matched lots."
                        : "A partial amount is unavailable, because this amount is unknown or incompatible with the recipe unit.";

                return (
                  <div key={choiceKey} className="border-b border-[var(--hairline)] py-4 last:border-b-0">
                    <div className="flex items-baseline justify-between gap-4">
                      <h2 className="nm">
                        {lot.name}{" "}
                        <span className="m text-[10.5px] text-[var(--ink-6)]">
                          {locationNames[lot.location]}
                        </span>
                      </h2>
                      <span
                        className={cn(
                          "m flex-none text-[11px]",
                          lot.quantityStatus === "unknown" ? "text-[var(--ink-6)]" : "text-[var(--ink-2)]",
                        )}
                      >
                        {amountText(lot)}
                      </span>
                    </div>
                    <p className="bd mt-2 text-[12px] text-[var(--ink-6)]">{suggestion}</p>

                    <div
                      className="mt-4 flex flex-wrap gap-x-7 gap-y-2"
                      role="radiogroup"
                      aria-label={`Amount of ${evidence.ingredientName} used from ${lot.name}`}
                    >
                      {(["no_change", "used_some", "used_up"] as const).map((action) => {
                        const selected = choice.action === action;
                        return (
                          <button
                            type="button"
                            role="radio"
                            aria-checked={selected}
                            key={action}
                            disabled={action === "used_some" && !allocation?.canUseSome}
                            onClick={() => setChoice(choiceKey, { action }, fallback)}
                            className={cn(
                              "m min-h-9 pb-0.5 text-[11px] transition disabled:cursor-not-allowed disabled:opacity-35",
                              selected
                                ? "border-b border-[var(--accent-rule)] text-[var(--ink)]"
                                : "text-[var(--ink-5)] hover:text-[var(--ink-2)]",
                            )}
                          >
                            {actionLabels[action]}
                          </button>
                        );
                      })}
                    </div>

                    {choice.action === "used_some" && (
                      <div className="mt-4 max-w-[14rem]">
                        <Field
                          label={`Amount used${lot.unit ? ` · ${lot.unit}` : ""}`}
                          htmlFor={`used-${evidence.ingredientId}-${lot.id}`}
                        >
                          <input
                            id={`used-${evidence.ingredientId}-${lot.id}`}
                            className={inputClass}
                            type="number"
                            min="0.01"
                            step="any"
                            inputMode="decimal"
                            value={choice.quantity}
                            onChange={(event) => setChoice(choiceKey, { quantity: event.target.value }, fallback)}
                          />
                        </Field>
                      </div>
                    )}
                  </div>
                );
              })}
            </Section>
          ))}
        </div>

        <div className="mt-9 flex flex-wrap items-center justify-between gap-5 border-t border-[var(--hairline)] pt-4.5">
          <span className="m text-[10.5px] text-[var(--ink-4)]">undo stays available afterwards</span>
          <div className="flex items-center gap-6">
            <button
              type="button"
              className="m text-[11px] text-[var(--ink-4)] hover:text-[var(--ink)]"
              onClick={() => setReconciling(false)}
            >
              back to steps
            </button>
            <Button disabled={!online} busy={saving} onClick={() => void saveReconciliation()}>
              Update the kitchen
            </Button>
          </div>
        </div>
      </Page>
    );
  }

  /* Step one: local ticks only. Nothing here touches the kitchen. */
  const progress = recipe.steps.length ? checked.size / recipe.steps.length : 0;

  return (
    <Page className="max-w-[42rem]">
      <header>
        <p className="ml">
          cooking · step {checked.size >= recipe.steps.length ? "done" : `${Math.min(checked.size + 1, recipe.steps.length)} of ${recipe.steps.length}`}
        </p>
        <h1 className="hd mt-3 text-[clamp(1.5rem,6vw,1.65rem)]">{recipe.title}</h1>
      </header>

      <div className="mt-6 h-px bg-[var(--hairline)]">
        <div
          className="h-px bg-[var(--accent-rule)] shadow-[0_0_8px_1px_var(--accent-halo)] transition-all"
          style={{ width: `${progress * 100}%` }}
        />
      </div>

      <ol>
        {recipe.steps.map((step, index) => {
          const complete = checked.has(index);
          return (
            <li key={`${index}-${step}`} className="border-b border-[var(--hairline)] last:border-b-0">
              <button
                type="button"
                className="flex w-full items-start gap-4 py-5 text-left"
                aria-pressed={complete}
                onClick={() =>
                  setChecked((current) => {
                    const next = new Set(current);
                    if (next.has(index)) next.delete(index);
                    else next.add(index);
                    return next;
                  })
                }
              >
                <span
                  className={cn(
                    "mt-1 flex size-[18px] flex-none items-center justify-center rounded-[2px]",
                    complete
                      ? "bg-[var(--accent-solid)] text-[var(--accent-on)]"
                      : "m border border-[var(--edge-strong)] text-[10px] text-[var(--ink-4)]",
                  )}
                >
                  {complete ? <Check className="size-3" aria-hidden="true" /> : index + 1}
                </span>
                <span className={cn("bd flex-1", complete ? "text-[var(--ink-6)]" : "text-[var(--ink)]")}>
                  {step}
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-5 border-t border-[var(--hairline)] pt-4.5">
        <p className="bd max-w-[16rem] text-[12px] text-[var(--ink-6)]">
          Ticks stay on this device. The kitchen only changes in the next step.
        </p>
        <Button onClick={() => setReconciling(true)}>Done cooking</Button>
      </div>
    </Page>
  );
}
