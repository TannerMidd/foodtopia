"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Check, CheckCircle2, ChefHat, Minus, Undo2, WifiOff } from "lucide-react";
import type { InventoryCommand, RecipeAssessment } from "@/contracts/domain";
import {
  allocateIngredientAcrossLots,
  cookLotChoiceKey,
  type CookLotAllocation,
} from "@/domain/cook-allocation";
import { ApiClientError, reconcileCookSession, type ReconciliationChange } from "@/lib/client/api";
import { loadCookSession, loadRecipeAssessment } from "@/lib/client/recipe-cache";
import { useOfflineInventory } from "./offline-provider";
import { Badge, Button, EmptyState, Field, inputClass, Page, PageHeader, StateNotice, cn } from "./ui";

type Choice = { action: "no_change" | "used_some" | "used_up"; quantity: string };

const noChangeChoice: Choice = { action: "no_change", quantity: "" };

function suggestedChoice(allocation: CookLotAllocation | undefined): Choice {
  if (allocation?.suggestedAction === "used_up") {
    return { action: "used_up", quantity: "" };
  }
  if (
    allocation?.suggestedAction === "used_some" &&
    allocation.suggestedQuantity !== null
  ) {
    return {
      action: "used_some",
      quantity: allocation.suggestedQuantity.toString(),
    };
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

  const reconcilable = useMemo(() => assessment?.evidence.filter((item) => item.lotIds.length > 0) ?? [], [assessment]);
  const lotsById = useMemo(
    () => new Map(lots.map((lot) => [lot.id, lot])),
    [lots],
  );
  const allocationsByChoice = useMemo(() => {
    const result: Record<string, CookLotAllocation> = {};
    if (!assessment) return result;
    const ingredientsById = new Map(
      assessment.recipe.ingredients.map((ingredient) => [
        ingredient.id,
        ingredient,
      ]),
    );

    for (const evidence of assessment.evidence) {
      const ingredient = ingredientsById.get(evidence.ingredientId);
      if (!ingredient) continue;
      const evidenceLots = evidence.lotIds.flatMap((lotId) => {
        const lot = lotsById.get(lotId);
        return lot ? [lot] : [];
      });
      for (const allocation of allocateIngredientAcrossLots(
        ingredient,
        evidenceLots,
      )) {
        result[cookLotChoiceKey(evidence.ingredientId, allocation.lotId)] =
          allocation;
      }
    }
    return result;
  }, [assessment, lotsById]);

  if (assessment === undefined) return <Page><div className="skeleton h-64 rounded-[2rem]" /></Page>;
  if (!assessment || !sessionId) return <Page><EmptyState icon={<ChefHat className="size-6" aria-hidden="true" />} title="Cooking session not found" description="Open a recipe from suggestions and choose Start cooking. Foodtopia does not invent a local session ID because reconciliation requires a matching server session." action={<Link href="/recipes" className="inline-flex min-h-12 items-center rounded-full bg-[var(--leaf)] px-5 font-bold text-white">Find a recipe</Link>} /></Page>;
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
      setError(
        caught instanceof Error
          ? caught.message
          : "The kitchen update could not be undone.",
      );
    } finally {
      setUndoing(false);
    }
  }

  if (done) {
    return (
      <Page className="flex min-h-[68dvh] items-center justify-center">
        <div className="w-full max-w-md">
          <EmptyState
            icon={<CheckCircle2 className="size-6" aria-hidden="true" />}
            title={undone ? "Kitchen changes undone" : "Kitchen updated"}
            description={undone
              ? "The prior inventory amounts and presence were restored through new inventory events."
              : "Your ingredient choices were reconciled with the latest household inventory."}
            action={(
              <div className="flex flex-col items-center gap-2">
                {!undone && undoCommands.length > 0 ? (
                  <Button
                    type="button"
                    variant="secondary"
                    busy={undoing}
                    disabled={!online}
                    onClick={() => void undoReconciliation()}
                  >
                    <Undo2 className="size-4" aria-hidden="true" /> Undo inventory changes
                  </Button>
                ) : null}
                <Link href="/inventory" className="inline-flex min-h-12 items-center rounded-full bg-[var(--leaf)] px-5 font-bold text-white">View inventory</Link>
              </div>
            )}
          />
          {error ? <div className="mt-3"><StateNotice title="Undo needs attention" tone="error">{error}</StateNotice></div> : null}
        </div>
      </Page>
    );
  }

  const recipe = assessment.recipe;
  function setChoice(
    id: string,
    update: Partial<Choice>,
    fallback: Choice,
  ) {
    setChoices((current) => ({
      ...current,
      [id]: { ...(current[id] ?? fallback), ...update },
    }));
  }

  async function saveReconciliation() {
    if (!online) {
      setError("Connect to reconcile shared inventory. Your cooking checklist stays on this screen.");
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
          setError(`${evidence.ingredientName} changed in the household. Refresh inventory and review again.`);
          return;
        }
        if (choice.action === "used_some" && (!choice.quantity || Number(choice.quantity) <= 0)) {
          setError(`Enter how much ${evidence.ingredientName} was used from ${lot.name}.`);
          return;
        }
        if (choice.action === "used_some" && !allocation?.canUseSome) {
          setError(`Choose “Used up” or “No change” for ${lot.name} because its amount is unknown or incompatible with the recipe unit.`);
          return;
        }
        if (
          choice.action === "used_some" &&
          lot.quantity !== null &&
          Number(choice.quantity) >= lot.quantity
        ) {
          setError(`Choose “Used up” for ${lot.name} when the whole lot was used.`);
          return;
        }
        changes.push({ ingredientId: evidence.ingredientId, lotId: lot.id, action: choice.action, quantity: choice.action === "used_some" ? Number(choice.quantity) : null, unit: choice.action === "used_some" ? lot.unit : null, expectedVersion: lot.version });
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
      if (caught instanceof ApiClientError && caught.status === 409) setError("Someone changed an ingredient while you cooked. Refresh inventory, then review these amounts against the latest version.");
      else setError(caught instanceof Error ? caught.message : "The inventory could not be reconciled.");
    } finally {
      setSaving(false);
    }
  }

  if (reconciling) {
    return (
      <Page>
        <PageHeader eyebrow="One quick check" title="What did you use?" description="Only the choices below can change inventory. Keep “No change” when an amount is unclear." />
        {!online && <StateNotice title="Connect to save household changes" tone="warning"><span className="inline-flex items-center gap-1"><WifiOff className="size-4" aria-hidden="true" /> Reconciliation writes to shared inventory and is not queued offline.</span></StateNotice>}
        {error && <div className="mt-3"><StateNotice title="Review needed" tone="error">{error}</StateNotice></div>}
        <div className="mt-5 space-y-3">
          {reconcilable.map((evidence) => (
            <section key={evidence.ingredientId} className="rounded-3xl border border-[var(--line)] bg-[var(--card)] p-4">
              <div>
                <h2 className="font-extrabold">{evidence.ingredientName}</h2>
                <p className="mt-1 text-xs text-[var(--muted)]">
                  {evidence.lotIds.length} matched lot{evidence.lotIds.length === 1 ? "" : "s"} · review each one
                </p>
              </div>
              <div className="mt-4 space-y-3">
                {evidence.lotIds.map((lotId, lotIndex) => {
                  const choiceKey = cookLotChoiceKey(evidence.ingredientId, lotId);
                  const lot = lotsById.get(lotId);
                  const allocation = allocationsByChoice[choiceKey];
                  const fallback = suggestedChoice(allocation);
                  const choice = choices[choiceKey] ?? fallback;
                  if (!lot) {
                    return (
                      <div key={choiceKey} className="rounded-2xl border border-[var(--line)] bg-white p-3 text-sm font-semibold text-[var(--tomato)]">
                        This inventory lot changed or is no longer available.
                      </div>
                    );
                  }
                  const suggestion = allocation?.suggestedAction === "used_up"
                    ? "Recipe allocation suggests using this lot up. Review before saving."
                    : allocation?.suggestedAction === "used_some" && allocation.suggestedQuantity !== null
                      ? `Recipe allocation suggests ${allocation.suggestedQuantity} ${lot.unit}.`
                      : allocation?.canUseSome
                        ? "The recipe amount is allocated from earlier matched lots."
                        : "A partial amount is unavailable because this quantity is unknown or incompatible.";
                  return (
                    <div key={choiceKey} className="rounded-2xl border border-[var(--line)] bg-white p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <h3 className="text-sm font-extrabold">{lot.name}</h3>
                          <p className="text-xs text-[var(--muted)]">Evidence order {lotIndex + 1} · version {lot.version}</p>
                        </div>
                        <Badge>{lot.quantityStatus === "unknown" ? "Amount unknown" : `${lot.quantity ?? "?"} ${lot.unit ?? ""}`}</Badge>
                      </div>
                      <p className="mt-2 text-xs leading-5 text-[var(--muted)]">{suggestion}</p>
                      <div className="mt-3 grid grid-cols-3 gap-2" role="radiogroup" aria-label={`Amount of ${evidence.ingredientName} used from ${lot.name}`}>
                        {(["no_change", "used_some", "used_up"] as const).map((action) => (
                          <button
                            type="button"
                            role="radio"
                            aria-checked={choice.action === action}
                            key={action}
                            disabled={action === "used_some" && !allocation?.canUseSome}
                            onClick={() => setChoice(choiceKey, { action }, fallback)}
                            className={cn("min-h-12 rounded-2xl border px-2 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-45", choice.action === action ? "border-[var(--leaf)] bg-[var(--sprout)] text-[var(--leaf)]" : "border-[var(--line)] bg-white text-[var(--muted)]")}
                          >
                            {action === "no_change" ? "No change" : action === "used_some" ? "Used some" : "Used up"}
                          </button>
                        ))}
                      </div>
                      {choice.action === "used_some" && (
                        <div className="mt-3">
                          <Field label={`Amount used${lot.unit ? ` (${lot.unit})` : ""}`} htmlFor={`used-${evidence.ingredientId}-${lot.id}`}>
                            <input id={`used-${evidence.ingredientId}-${lot.id}`} className={inputClass} type="number" min="0.01" step="any" inputMode="decimal" value={choice.quantity} onChange={(event) => setChoice(choiceKey, { quantity: event.target.value }, fallback)} />
                          </Field>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
        {!reconcilable.length && <div className="mt-5"><StateNotice title="Nothing to reconcile">This recipe has no linked inventory lots. Finishing will not change the household inventory.</StateNotice></div>}
        <div className="mt-6 grid grid-cols-2 gap-2"><Button variant="secondary" onClick={() => setReconciling(false)}>Back to steps</Button><Button disabled={!online} busy={saving} onClick={() => void saveReconciliation()}>Save kitchen</Button></div>
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader eyebrow="Cooking now" title={recipe.title} description={`${checked.size} of ${recipe.steps.length} steps checked`} />
      <div className="mb-5 h-2 overflow-hidden rounded-full bg-[var(--paper-deep)]"><div className="h-full rounded-full bg-[var(--tomato)] transition-all" style={{ width: `${(checked.size / recipe.steps.length) * 100}%` }} /></div>
      <ol className="space-y-3">
        {recipe.steps.map((step, index) => {
          const complete = checked.has(index);
          return <li key={`${index}-${step}`}><button type="button" className={cn("flex min-h-24 w-full items-start gap-4 rounded-3xl border p-4 text-left transition", complete ? "border-[#bfd8bd] bg-[#eff8ea]" : "border-[var(--line)] bg-[var(--card)]")} onClick={() => setChecked((current) => { const next = new Set(current); if (next.has(index)) next.delete(index); else next.add(index); return next; })}><span className={cn("mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-2xl border font-black", complete ? "border-[var(--leaf)] bg-[var(--leaf)] text-white" : "border-[var(--line)] bg-white text-[var(--ink)]")}>{complete ? <Check className="size-5" aria-hidden="true" /> : index + 1}</span><span className={cn("pt-1 text-sm leading-6", complete && "text-[var(--muted)] line-through")}>{step}</span></button></li>;
        })}
      </ol>
      <Button className="mt-6 w-full" onClick={() => setReconciling(true)}><Minus className="size-4" aria-hidden="true" /> Finish & update ingredients</Button>
      <p className="mt-3 text-center text-xs text-[var(--muted)]">Step checkmarks are just a local cooking aid. Inventory changes only during the final ingredient check.</p>
    </Page>
  );
}
