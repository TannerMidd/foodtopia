"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  ArchiveRestore,
  Camera,
  Check,
  CircleHelp,
  Edit3,
  PackageOpen,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import type {
  DateLabelType,
  FoodForm,
  FoodLocation,
  InventoryCommand,
  InventoryLot,
  QuantityStatus,
} from "@/contracts/domain";
import { normalizeFoodLabel, resolveFoodIdentity } from "@/domain/normalization";
import type { OutboxRecord } from "@/lib/offline/db";
import { useOfflineInventory } from "./offline-provider";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  inputClass,
  Modal,
  Page,
  PageHeader,
  selectClass,
  StateNotice,
  cn,
} from "./ui";

const locationOrder: FoodLocation[] = ["fridge", "freezer", "pantry", "other", "unknown"];
const locationNames: Record<FoodLocation, string> = {
  fridge: "Fridge",
  freezer: "Freezer",
  pantry: "Pantry",
  other: "Other storage",
  unknown: "Location not set",
};

type UndoAction = { label: string; command: InventoryCommand };
type MutationPayload = Extract<InventoryCommand, { type: "adjust" }>["payload"];

function amountLabel(lot: InventoryLot) {
  if (lot.quantityStatus === "unknown") return "Amount not tracked";
  const value = lot.quantity == null ? "Amount missing" : `${lot.quantity}${lot.unit ? ` ${lot.unit}` : ""}`;
  return lot.quantityStatus === "estimated" ? `About ${value}` : value;
}

function quantityTone(lot: InventoryLot): "neutral" | "green" | "yellow" {
  if (lot.quantityStatus === "known") return "green";
  if (lot.quantityStatus === "estimated") return "yellow";
  return "neutral";
}

function statusCommand(lot: InventoryLot, type: "consume" | "discard" | "restore"): InventoryCommand {
  return {
    commandId: crypto.randomUUID(),
    type,
    expectedVersion: lot.version,
    payload: { lotId: lot.id },
  };
}

function ConflictCard({ record }: { record: OutboxRecord }) {
  const { resolveConflict } = useOfflineInventory();
  const [busy, setBusy] = useState<"retry" | "discard" | null>(null);
  const lotId = record.command.type === "add" ? record.command.payload.id : record.command.payload.lotId;
  async function resolve(strategy: "retry" | "discard") {
    setBusy(strategy);
    try {
      await resolveConflict(record, strategy);
    } finally {
      setBusy(null);
    }
  }
  return (
    <Card className="border-[#efb6a8] bg-[#fff8f5] p-4 shadow-none">
      <p className="text-sm font-extrabold">{record.status === "conflict" ? "Household update collided" : "Queued change was rejected"}</p>
      <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{record.status === "conflict" ? `Item ${lotId.slice(0, 8)} changed after this device last saw it. Foodtopia paused the ordered outbox at this 409 instead of overwriting the newer version.` : `${record.lastError ?? "This command could not be applied."} The ordered outbox is paused so this permanent failure is not sent repeatedly.`}</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button size="small" variant="secondary" busy={busy === "discard"} onClick={() => void resolve("discard")}>{record.status === "conflict" ? "Use latest" : "Discard change"}</Button>
        <Button size="small" busy={busy === "retry"} onClick={() => void resolve("retry")}>Retry mine</Button>
      </div>
    </Card>
  );
}

function AdjustItemModal({
  lot,
  onClose,
  onSave,
}: {
  lot: InventoryLot;
  onClose: () => void;
  onSave: (lot: InventoryLot, payload: MutationPayload) => Promise<void>;
}) {
  const [name, setName] = useState(lot.name);
  const [quantityStatus, setQuantityStatus] = useState<QuantityStatus>(lot.quantityStatus);
  const [quantity, setQuantity] = useState(lot.quantity?.toString() ?? "");
  const [unit, setUnit] = useState(lot.unit ?? "");
  const [form, setForm] = useState<FoodForm>(lot.form);
  const [location, setLocation] = useState<FoodLocation>(lot.location);
  const [dateLabelType, setDateLabelType] = useState<DateLabelType | "none">(lot.dateLabelType ?? "none");
  const [dateLabel, setDateLabel] = useState(lot.dateLabel ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Enter a food name.");
      return;
    }
    if (quantityStatus !== "unknown" && (!quantity || Number(quantity) <= 0)) {
      setError("Enter a positive amount, or choose “Don’t track amount.”");
      return;
    }
    if (dateLabelType !== "none" && !dateLabel) {
      setError("Choose the printed date, or remove date tracking.");
      return;
    }
    const identity = normalizeFoodLabel(trimmedName) === normalizeFoodLabel(lot.name)
      ? { foodConceptId: lot.foodConceptId, category: lot.category }
      : resolveFoodIdentity(trimmedName);
    setSaving(true);
    await onSave(lot, {
      lotId: lot.id,
      name: trimmedName,
      foodConceptId: identity.foodConceptId,
      category: identity.category,
      quantityStatus,
      quantity: quantityStatus === "unknown" ? null : Number(quantity),
      unit: quantityStatus === "unknown" ? null : unit.trim() || null,
      form,
      location,
      dateLabelType: dateLabelType === "none" ? null : dateLabelType,
      dateLabel: dateLabelType === "none" ? null : dateLabel,
    });
    setSaving(false);
    onClose();
  }

  return (
    <Modal open title={`Adjust ${lot.name}`} description="Changes appear immediately on this device and sync in order." onClose={onClose}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="Food name" htmlFor="adjust-food-name">
            <input id="adjust-food-name" className={inputClass} maxLength={120} value={name} onChange={(event) => setName(event.target.value)} />
          </Field>
        </div>
        <Field label="Amount tracking" htmlFor="adjust-quantity-status">
          <select id="adjust-quantity-status" className={selectClass} value={quantityStatus} onChange={(event) => setQuantityStatus(event.target.value as QuantityStatus)}>
            <option value="unknown">Don’t track amount</option>
            <option value="estimated">Estimated amount</option>
            <option value="known">Known amount</option>
          </select>
        </Field>
        {quantityStatus !== "unknown" && (
          <div className="grid grid-cols-2 gap-2">
            <Field label="Quantity" htmlFor="adjust-quantity"><input id="adjust-quantity" className={inputClass} type="number" min="0.01" step="any" inputMode="decimal" value={quantity} onChange={(event) => setQuantity(event.target.value)} /></Field>
            <Field label="Unit" htmlFor="adjust-unit"><input id="adjust-unit" className={inputClass} maxLength={24} placeholder="items" value={unit} onChange={(event) => setUnit(event.target.value)} /></Field>
          </div>
        )}
        <Field label="Form" htmlFor="adjust-form">
          <select id="adjust-form" className={selectClass} value={form} onChange={(event) => setForm(event.target.value as FoodForm)}>
            <option value="unspecified">Not specified</option><option value="fresh">Fresh</option><option value="frozen">Frozen</option><option value="canned">Canned</option><option value="dried">Dried</option><option value="cooked">Cooked</option><option value="opened">Opened</option>
          </select>
        </Field>
        <Field label="Location" htmlFor="adjust-location">
          <select id="adjust-location" className={selectClass} value={location} onChange={(event) => setLocation(event.target.value as FoodLocation)}>
            {locationOrder.map((value) => <option key={value} value={value}>{locationNames[value]}</option>)}
          </select>
        </Field>
        <Field label="Printed date type" htmlFor="adjust-date-type">
          <select id="adjust-date-type" className={selectClass} value={dateLabelType} onChange={(event) => setDateLabelType(event.target.value as DateLabelType | "none")}>
            <option value="none">No date recorded</option><option value="best_before">Best before</option><option value="sell_by">Sell by</option><option value="use_by">Use by</option><option value="unknown">Label type unclear</option>
          </select>
        </Field>
        {dateLabelType !== "none" && <Field label="Printed date" htmlFor="adjust-date"><input id="adjust-date" type="date" className={inputClass} value={dateLabel} onChange={(event) => setDateLabel(event.target.value)} /></Field>}
      </div>
      <p className="mt-4 rounded-xl bg-[#fff7d9] p-3 text-xs leading-5 text-[#69551a]">Foodtopia records the package label as written. It does not determine whether food is safe. When in doubt, follow official storage guidance and use your senses.</p>
      {error && <p className="mt-3 text-sm font-semibold text-[var(--tomato)]" role="alert">{error}</p>}
      <div className="mt-5 grid grid-cols-2 gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button busy={saving} onClick={() => void save()}>Save change</Button></div>
    </Modal>
  );
}

function AddItemModal({
  householdId,
  onClose,
  onSave,
}: {
  householdId: string;
  onClose: () => void;
  onSave: (command: InventoryCommand) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [quantityStatus, setQuantityStatus] = useState<QuantityStatus>("unknown");
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState("");
  const [location, setLocation] = useState<FoodLocation>("unknown");
  const [form, setForm] = useState<FoodForm>("unspecified");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!name.trim()) {
      setError("Enter a food name.");
      return;
    }
    if (quantityStatus !== "unknown" && (!quantity || Number(quantity) <= 0)) {
      setError("Enter a positive amount, or choose “Don’t track amount.”");
      return;
    }
    const id = crypto.randomUUID();
    const trimmedName = name.trim();
    const identity = resolveFoodIdentity(trimmedName);
    const command: InventoryCommand = {
      commandId: crypto.randomUUID(),
      type: "add",
      expectedVersion: null,
      payload: {
        id,
        householdId,
        foodConceptId: identity.foodConceptId,
        name: trimmedName,
        category: identity.category,
        quantityStatus,
        quantity: quantityStatus === "unknown" ? null : Number(quantity),
        unit: quantityStatus === "unknown" ? null : unit.trim() || null,
        form,
        location,
        dateLabelType: null,
        dateLabel: null,
        status: "active",
      },
    };
    setSaving(true);
    try {
      await onSave(command);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The item could not be queued.");
      setSaving(false);
    }
  }

  return (
    <Modal open title="Add one item" description="Useful for a missed item or an offline correction. Photo batches still provide the fastest review flow." onClose={onClose}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2"><Field label="Food name" htmlFor="manual-food-name"><input id="manual-food-name" autoFocus className={inputClass} maxLength={120} placeholder="e.g. Greek yogurt" value={name} onChange={(event) => setName(event.target.value)} /></Field></div>
        <Field label="Amount tracking" htmlFor="manual-quantity-state"><select id="manual-quantity-state" className={selectClass} value={quantityStatus} onChange={(event) => setQuantityStatus(event.target.value as QuantityStatus)}><option value="unknown">Don’t track amount</option><option value="estimated">Estimated amount</option><option value="known">Known amount</option></select></Field>
        {quantityStatus !== "unknown" && <div className="grid grid-cols-2 gap-2"><Field label="Quantity" htmlFor="manual-quantity"><input id="manual-quantity" className={inputClass} type="number" min="0.01" step="any" inputMode="decimal" value={quantity} onChange={(event) => setQuantity(event.target.value)} /></Field><Field label="Unit" htmlFor="manual-unit"><input id="manual-unit" className={inputClass} maxLength={24} placeholder="items" value={unit} onChange={(event) => setUnit(event.target.value)} /></Field></div>}
        <Field label="Form" htmlFor="manual-form"><select id="manual-form" className={selectClass} value={form} onChange={(event) => setForm(event.target.value as FoodForm)}><option value="unspecified">Not specified</option><option value="fresh">Fresh</option><option value="frozen">Frozen</option><option value="canned">Canned</option><option value="dried">Dried</option><option value="cooked">Cooked</option><option value="opened">Opened</option></select></Field>
        <Field label="Location" htmlFor="manual-location"><select id="manual-location" className={selectClass} value={location} onChange={(event) => setLocation(event.target.value as FoodLocation)}>{locationOrder.map((value) => <option value={value} key={value}>{locationNames[value]}</option>)}</select></Field>
      </div>
      {error && <p className="mt-3 text-sm font-semibold text-[var(--tomato)]" role="alert">{error}</p>}
      <div className="mt-5 grid grid-cols-2 gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button busy={saving} onClick={() => void save()}>Add item</Button></div>
    </Modal>
  );
}

function InventoryRow({ lot, onAdjust, onAction }: { lot: InventoryLot; onAdjust: (lot: InventoryLot) => void; onAction: (lot: InventoryLot, action: "consume" | "discard") => void }) {
  return (
    <article id={`lot-${lot.id}`} className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4 shadow-[0_4px_18px_rgba(42,54,44,0.04)]">
      <div className="flex items-start gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[var(--sprout)] text-lg font-black text-[var(--leaf)]" aria-hidden="true">{lot.name.charAt(0).toUpperCase()}</span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-extrabold">{lot.name}</h3>
          <p className="mt-0.5 truncate text-xs capitalize text-[var(--muted)]">{lot.form === "unspecified" ? "Form not set" : lot.form} · {lot.category}</p>
          <Badge tone={quantityTone(lot)} className="mt-2">{amountLabel(lot)}</Badge>
        </div>
        <button type="button" className="flex size-11 shrink-0 items-center justify-center rounded-full border border-[var(--line)] bg-white text-[var(--leaf)]" onClick={() => onAdjust(lot)} aria-label={`Adjust ${lot.name}`}><Edit3 className="size-4" aria-hidden="true" /></button>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 border-t border-[var(--line)] pt-3">
        <Button type="button" size="small" variant="ghost" onClick={() => onAction(lot, "consume")}><Check className="size-4" aria-hidden="true" /> Used up</Button>
        <Button type="button" size="small" variant="ghost" className="text-[#8c4434]" onClick={() => onAction(lot, "discard")}><Trash2 className="size-4" aria-hidden="true" /> Discard</Button>
      </div>
    </article>
  );
}

export function InventoryScreen() {
  const { lots, hydrated, conflicts, outbox, queueCommand, lastSyncedAt, activeHouseholdId } = useOfflineInventory();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FoodLocation | "all">("all");
  const [adjusting, setAdjusting] = useState<InventoryLot | null>(null);
  const [adding, setAdding] = useState(false);
  const [undo, setUndo] = useState<UndoAction | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (window.location.hash !== "#add-manually") return;
    const timeout = window.setTimeout(() => setAdding(true), 0);
    return () => window.clearTimeout(timeout);
  }, []);

  useEffect(() => {
    if (!undo) return;
    const timeout = window.setTimeout(() => setUndo(null), 8_000);
    return () => window.clearTimeout(timeout);
  }, [undo]);

  const active = useMemo(() => lots.filter((lot) => lot.status === "active"), [lots]);
  const filtered = active.filter((lot) => {
    const matchesQuery = `${lot.name} ${lot.category}`.toLowerCase().includes(query.trim().toLowerCase());
    return matchesQuery && (filter === "all" || lot.location === filter);
  });
  const removed = lots.filter((lot) => lot.status !== "active").sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 8);

  async function applyStatus(lot: InventoryLot, type: "consume" | "discard") {
    setActionError(null);
    try {
      await queueCommand(statusCommand(lot, type));
      setUndo({
        label: `${lot.name} marked ${type === "consume" ? "used up" : "discarded"}`,
        command: {
          commandId: crypto.randomUUID(),
          type: "restore",
          expectedVersion: lot.version + 1,
          payload: { lotId: lot.id },
        },
      });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "The change could not be queued.");
    }
  }

  async function saveAdjustment(lot: InventoryLot, payload: MutationPayload) {
    const inverse: InventoryCommand = {
      commandId: crypto.randomUUID(),
      type: "adjust",
      expectedVersion: lot.version + 1,
      payload: {
        lotId: lot.id,
        foodConceptId: lot.foodConceptId,
        name: lot.name,
        category: lot.category,
        quantityStatus: lot.quantityStatus,
        quantity: lot.quantity,
        unit: lot.unit,
        form: lot.form,
        location: lot.location,
        dateLabelType: lot.dateLabelType,
        dateLabel: lot.dateLabel,
      },
    };
    await queueCommand({ commandId: crypto.randomUUID(), type: "adjust", expectedVersion: lot.version, payload });
    setUndo({ label: `${lot.name} adjusted`, command: inverse });
  }

  async function undoLast() {
    if (!undo) return;
    const action = undo;
    setUndo(null);
    try {
      await queueCommand(action.command);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Undo could not be queued.");
    }
  }

  return (
    <Page>
      <PageHeader
        eyebrow="Shared household"
        title="Inventory"
        description={`${active.length} active item${active.length === 1 ? "" : "s"}${lastSyncedAt ? ` · refreshed ${new Date(lastSyncedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}`}
        action={<div className="flex gap-2"><button type="button" aria-label="Add food manually" className="flex size-12 items-center justify-center rounded-2xl border border-[var(--line)] bg-white text-[var(--leaf)]" onClick={() => setAdding(true)}><Plus className="size-5" aria-hidden="true" /></button><Link href="/capture" aria-label="Photograph food" className="flex size-12 items-center justify-center rounded-2xl bg-[var(--tomato)] text-white shadow-lg"><Camera className="size-5" aria-hidden="true" /></Link></div>}
      />

      <div className="relative">
        <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-[var(--muted)]" aria-hidden="true" />
        <input type="search" className={cn(inputClass, "pl-11 pr-11")} placeholder="Search food" aria-label="Search inventory" value={query} onChange={(event) => setQuery(event.target.value)} />
        {query && <button type="button" className="absolute right-1 top-1/2 flex size-10 -translate-y-1/2 items-center justify-center rounded-full" onClick={() => setQuery("")} aria-label="Clear search"><X className="size-4" aria-hidden="true" /></button>}
      </div>

      <div className="-mx-4 mt-3 overflow-x-auto px-4 pb-1 sm:-mx-6 sm:px-6" aria-label="Filter inventory by location">
        <div className="flex w-max gap-2">
          {(["all", ...locationOrder] as const).map((value) => (
            <button key={value} type="button" className={cn("min-h-11 rounded-full border px-4 text-sm font-bold transition", filter === value ? "border-[var(--leaf)] bg-[var(--leaf)] text-white" : "border-[var(--line)] bg-white/65 text-[var(--muted)]")} onClick={() => setFilter(value)}>
              {value === "all" ? "All" : locationNames[value]}
            </button>
          ))}
        </div>
      </div>

      {actionError && <div className="mt-4"><StateNotice title="Change not saved" tone="error">{actionError}</StateNotice></div>}

      <section id="sync-conflicts" className="mt-5 space-y-3">
        {conflicts.length > 0 && <h2 className="text-sm font-extrabold text-[#8c4434]">Resolve before syncing continues</h2>}
        {conflicts.map((record) => <ConflictCard key={record.commandId} record={record} />)}
        {outbox.filter((record) => record.status === "failed").map((record) => <ConflictCard key={record.commandId} record={record} />)}
      </section>

      {!hydrated ? (
        <div className="mt-5 space-y-3"><div className="skeleton h-28 rounded-3xl" /><div className="skeleton h-28 rounded-3xl" /></div>
      ) : filtered.length ? (
        <div className="mt-6 space-y-7">
          {locationOrder.map((location) => {
            const group = filtered.filter((lot) => lot.location === location);
            if (!group.length) return null;
            return (
              <section key={location}>
                <div className="mb-3 flex items-center justify-between"><h2 className="text-lg font-extrabold tracking-tight">{locationNames[location]}</h2><Badge>{group.length}</Badge></div>
                <div className="grid gap-3 sm:grid-cols-2">{group.map((lot) => <InventoryRow key={lot.id} lot={lot} onAdjust={setAdjusting} onAction={(item, action) => void applyStatus(item, action)} />)}</div>
              </section>
            );
          })}
        </div>
      ) : (
        <div className="mt-6">
          <EmptyState
            icon={query || filter !== "all" ? <Search className="size-6" aria-hidden="true" /> : <PackageOpen className="size-6" aria-hidden="true" />}
            title={query || filter !== "all" ? "No items match" : "The inventory is empty"}
            description={query || filter !== "all" ? "Try another search or location filter." : "Start with one clear photo of a staged grocery or fridge batch."}
            action={!query && filter === "all" ? <Link href="/capture" className="inline-flex min-h-12 items-center gap-2 rounded-full bg-[var(--leaf)] px-5 font-bold text-white"><Camera className="size-4" aria-hidden="true" /> Photograph food</Link> : undefined}
          />
        </div>
      )}

      {removed.length > 0 && (
        <section className="mt-9">
          <h2 className="mb-3 text-lg font-extrabold tracking-tight">Recently removed</h2>
          <div className="overflow-hidden rounded-3xl border border-[var(--line)] bg-white/55">
            {removed.map((lot, index) => (
              <div key={lot.id} className={cn("flex min-h-16 items-center gap-3 px-4 py-3", index > 0 && "border-t border-[var(--line)]")}>
                <ArchiveRestore className="size-5 shrink-0 text-[var(--muted)]" aria-hidden="true" />
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">{lot.name}</p><p className="text-xs capitalize text-[var(--muted)]">{lot.status}</p></div>
                <Button size="small" variant="ghost" onClick={() => void queueCommand(statusCommand(lot, "restore"))}><RotateCcw className="size-4" aria-hidden="true" /> Restore</Button>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="mt-7 flex items-start gap-2 rounded-2xl bg-white/40 p-4 text-xs leading-5 text-[var(--muted)]"><CircleHelp className="mt-0.5 size-4 shrink-0" aria-hidden="true" /><p>Presence is the only required inventory fact. Amount, form, location, and printed dates are optional. “Unknown” is kept explicit so recipes do not pretend to know more than the household entered.</p></div>

      {undo && (
        <div className="safe-bottom fixed inset-x-4 bottom-[6.3rem] z-50 mx-auto flex max-w-md items-center gap-3 rounded-2xl bg-[var(--ink)] px-4 py-3 text-white shadow-2xl md:bottom-8" role="status">
          <Undo2 className="size-4 shrink-0" aria-hidden="true" /><p className="min-w-0 flex-1 truncate text-sm font-semibold">{undo.label}</p><button type="button" className="min-h-11 px-2 text-sm font-extrabold text-[#d9efcb]" onClick={() => void undoLast()}>Undo</button>
        </div>
      )}

      {adjusting && <AdjustItemModal key={adjusting.id} lot={adjusting} onClose={() => setAdjusting(null)} onSave={saveAdjustment} />}
      {adding && <AddItemModal householdId={activeHouseholdId} onClose={() => setAdding(false)} onSave={async (command) => {
        await queueCommand(command);
        if (command.type === "add") {
          setUndo({
            label: `${command.payload.name} added`,
            command: {
              commandId: crypto.randomUUID(),
              type: "discard",
              expectedVersion: 0,
              payload: { lotId: command.payload.id },
            },
          });
        }
      }} />}
    </Page>
  );
}
