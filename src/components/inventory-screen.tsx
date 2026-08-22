"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Check, Pencil, Plus, RotateCcw, Search, Trash2, X } from "lucide-react";
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
import {
  amountText,
  capitalNumberWord,
  dateText,
  formText,
  isDatePressing,
  locationNames,
  locationOrder,
  numberWord,
} from "./format";
import { useOfflineInventory } from "./offline-provider";
import {
  Button,
  Field,
  Modal,
  Page,
  Section,
  StateNotice,
  cn,
  inputClass,
  selectClass,
} from "./ui";

type UndoAction = { label: string; command: InventoryCommand };
type MutationPayload = Extract<InventoryCommand, { type: "adjust" }>["payload"];

function statusCommand(lot: InventoryLot, type: "consume" | "discard" | "restore"): InventoryCommand {
  return {
    commandId: crypto.randomUUID(),
    type,
    expectedVersion: lot.version,
    payload: { lotId: lot.id },
  };
}

function ConflictRow({ record }: { record: OutboxRecord }) {
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
    <div className="row min-h-0 flex-col items-start gap-4 py-5 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <p className="nm">
          {record.status === "conflict" ? "Household update collided" : "Queued change was rejected"}
        </p>
        <p className="bd mt-1.5 text-[12px]">
          {record.status === "conflict"
            ? `Item ${lotId.slice(0, 8)} changed after this device last saw it. The ordered outbox paused here instead of overwriting the newer version.`
            : `${record.lastError ?? "This command could not be applied."} The outbox is paused so a permanent failure is not sent repeatedly.`}
        </p>
      </div>
      <div className="flex flex-none items-center gap-5">
        <button
          type="button"
          className="m text-[11px] text-[var(--ink-4)] hover:text-[var(--ink)] disabled:opacity-40"
          disabled={busy !== null}
          onClick={() => void resolve("discard")}
        >
          {record.status === "conflict" ? "use latest" : "discard change"}
        </button>
        <button
          type="button"
          className="m border-b border-[var(--accent-rule)] pb-0.5 text-[11px] text-[var(--ink)] disabled:opacity-40"
          disabled={busy !== null}
          onClick={() => void resolve("retry")}
        >
          retry mine
        </button>
      </div>
    </div>
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
      setError("Enter a positive amount, or leave the amount untracked.");
      return;
    }
    if (dateLabelType !== "none" && !dateLabel) {
      setError("Choose the printed date, or remove date tracking.");
      return;
    }
    const identity =
      normalizeFoodLabel(trimmedName) === normalizeFoodLabel(lot.name)
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
    <Modal
      open
      title={`Adjust ${lot.name}`}
      description="Changes appear immediately on this device and sync in order."
      onClose={onClose}
    >
      <div className="grid gap-6 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="Food name" htmlFor="adjust-food-name">
            <input
              id="adjust-food-name"
              className={inputClass}
              maxLength={120}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
        </div>
        <Field label="Amount tracking" htmlFor="adjust-quantity-status">
          <select
            id="adjust-quantity-status"
            className={selectClass}
            value={quantityStatus}
            onChange={(event) => setQuantityStatus(event.target.value as QuantityStatus)}
          >
            <option value="unknown">Don&rsquo;t track amount</option>
            <option value="estimated">Estimated amount</option>
            <option value="known">Known amount</option>
          </select>
        </Field>
        {quantityStatus !== "unknown" && (
          <div className="grid grid-cols-2 gap-4">
            <Field label="Quantity" htmlFor="adjust-quantity">
              <input
                id="adjust-quantity"
                className={inputClass}
                type="number"
                min="0.01"
                step="any"
                inputMode="decimal"
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
              />
            </Field>
            <Field label="Unit" htmlFor="adjust-unit">
              <input
                id="adjust-unit"
                className={inputClass}
                maxLength={24}
                placeholder="items"
                value={unit}
                onChange={(event) => setUnit(event.target.value)}
              />
            </Field>
          </div>
        )}
        <Field label="Form" htmlFor="adjust-form">
          <select
            id="adjust-form"
            className={selectClass}
            value={form}
            onChange={(event) => setForm(event.target.value as FoodForm)}
          >
            <option value="unspecified">Not specified</option>
            <option value="fresh">Fresh</option>
            <option value="frozen">Frozen</option>
            <option value="canned">Canned</option>
            <option value="dried">Dried</option>
            <option value="cooked">Cooked</option>
            <option value="opened">Opened</option>
          </select>
        </Field>
        <Field label="Location" htmlFor="adjust-location">
          <select
            id="adjust-location"
            className={selectClass}
            value={location}
            onChange={(event) => setLocation(event.target.value as FoodLocation)}
          >
            {locationOrder.map((value) => (
              <option key={value} value={value}>
                {locationNames[value]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Printed date type" htmlFor="adjust-date-type">
          <select
            id="adjust-date-type"
            className={selectClass}
            value={dateLabelType}
            onChange={(event) => setDateLabelType(event.target.value as DateLabelType | "none")}
          >
            <option value="none">No date recorded</option>
            <option value="best_before">Best before</option>
            <option value="sell_by">Sell by</option>
            <option value="use_by">Use by</option>
            <option value="unknown">Label type unclear</option>
          </select>
        </Field>
        {dateLabelType !== "none" && (
          <Field label="Printed date" htmlFor="adjust-date">
            <input
              id="adjust-date"
              type="date"
              className={inputClass}
              value={dateLabel}
              onChange={(event) => setDateLabel(event.target.value)}
            />
          </Field>
        )}
      </div>
      <p className="bd mt-7 text-[12px] text-[var(--time)]">
        Foodtopia records the package label as written. It does not determine whether food is safe.
        When in doubt, follow official storage guidance and use your senses.
      </p>
      {error && (
        <p className="bd mt-4 text-[var(--time)]" role="alert">
          {error}
        </p>
      )}
      <div className="mt-8 flex items-center justify-end gap-6">
        <button type="button" className="m text-[11px] text-[var(--ink-4)] hover:text-[var(--ink)]" onClick={onClose}>
          cancel
        </button>
        <Button busy={saving} onClick={() => void save()}>
          Save change
        </Button>
      </div>
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
      setError("Enter a positive amount, or leave the amount untracked.");
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
    <Modal
      open
      title="Add one item"
      description="Useful for a missed item or an offline correction. Photo batches still review fastest."
      onClose={onClose}
    >
      <div className="grid gap-6 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="Food name" htmlFor="manual-food-name">
            <input
              id="manual-food-name"
              autoFocus
              className={inputClass}
              maxLength={120}
              placeholder="e.g. Greek yogurt"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
        </div>
        <Field label="Amount tracking" htmlFor="manual-quantity-state">
          <select
            id="manual-quantity-state"
            className={selectClass}
            value={quantityStatus}
            onChange={(event) => setQuantityStatus(event.target.value as QuantityStatus)}
          >
            <option value="unknown">Don&rsquo;t track amount</option>
            <option value="estimated">Estimated amount</option>
            <option value="known">Known amount</option>
          </select>
        </Field>
        {quantityStatus !== "unknown" && (
          <div className="grid grid-cols-2 gap-4">
            <Field label="Quantity" htmlFor="manual-quantity">
              <input
                id="manual-quantity"
                className={inputClass}
                type="number"
                min="0.01"
                step="any"
                inputMode="decimal"
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
              />
            </Field>
            <Field label="Unit" htmlFor="manual-unit">
              <input
                id="manual-unit"
                className={inputClass}
                maxLength={24}
                placeholder="items"
                value={unit}
                onChange={(event) => setUnit(event.target.value)}
              />
            </Field>
          </div>
        )}
        <Field label="Form" htmlFor="manual-form">
          <select
            id="manual-form"
            className={selectClass}
            value={form}
            onChange={(event) => setForm(event.target.value as FoodForm)}
          >
            <option value="unspecified">Not specified</option>
            <option value="fresh">Fresh</option>
            <option value="frozen">Frozen</option>
            <option value="canned">Canned</option>
            <option value="dried">Dried</option>
            <option value="cooked">Cooked</option>
            <option value="opened">Opened</option>
          </select>
        </Field>
        <Field label="Location" htmlFor="manual-location">
          <select
            id="manual-location"
            className={selectClass}
            value={location}
            onChange={(event) => setLocation(event.target.value as FoodLocation)}
          >
            {locationOrder.map((value) => (
              <option value={value} key={value}>
                {locationNames[value]}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {error && (
        <p className="bd mt-4 text-[var(--time)]" role="alert">
          {error}
        </p>
      )}
      <div className="mt-8 flex items-center justify-end gap-6">
        <button type="button" className="m text-[11px] text-[var(--ink-4)] hover:text-[var(--ink)]" onClick={onClose}>
          cancel
        </button>
        <Button busy={saving} onClick={() => void save()}>
          Add item
        </Button>
      </div>
    </Modal>
  );
}

/* One lot, one line. Every column is a single recorded fact. */
function LotRow({
  lot,
  onAdjust,
  onAction,
}: {
  lot: InventoryLot;
  onAdjust: (lot: InventoryLot) => void;
  onAction: (lot: InventoryLot, action: "consume" | "discard") => void;
}) {
  const printed = dateText(lot);
  return (
    <article
      id={`lot-${lot.id}`}
      className="row row-link min-h-[56px] flex-wrap gap-x-4 gap-y-1 px-1 py-3 sm:flex-nowrap sm:gap-4 sm:py-0"
    >
      <h3 className="nm min-w-0 flex-1 truncate">{lot.name}</h3>
      <span className="m order-3 w-full text-[11px] text-[var(--ink-6)] sm:order-none sm:w-[150px] sm:truncate">
        {formText(lot)}
      </span>
      <span
        className={cn(
          "m order-4 whitespace-nowrap text-[11px] sm:order-none sm:w-[134px]",
          printed ? (isDatePressing(lot) ? "text-[var(--time)]" : "text-[var(--ink-4)]") : "text-[var(--ink-6)]",
        )}
      >
        {printed ?? "—"}
      </span>
      <span
        className={cn(
          "m w-[76px] text-right text-[12px]",
          lot.quantityStatus === "unknown"
            ? "text-[11px] text-[var(--ink-6)]"
            : lot.quantityStatus === "estimated"
              ? "text-[var(--ink-2)]"
              : "text-[var(--ink)]",
        )}
      >
        {amountText(lot)}
      </span>
      <span className="flex flex-none items-center gap-3.5 text-[var(--ink-5)]">
        <button
          type="button"
          className="flex size-7 items-center justify-center hover:text-[var(--ink)]"
          onClick={() => onAdjust(lot)}
          aria-label={`Adjust ${lot.name}`}
        >
          <Pencil className="size-3.5" aria-hidden="true" />
        </button>
        <button
          type="button"
          className="flex size-7 items-center justify-center hover:text-[var(--ink)]"
          onClick={() => onAction(lot, "consume")}
          aria-label={`Mark ${lot.name} used up`}
        >
          <Check className="size-3.5" aria-hidden="true" />
        </button>
        <button
          type="button"
          className="flex size-7 items-center justify-center hover:text-[var(--time)]"
          onClick={() => onAction(lot, "discard")}
          aria-label={`Discard ${lot.name}`}
        >
          <Trash2 className="size-3.5" aria-hidden="true" />
        </button>
      </span>
    </article>
  );
}

export function InventoryScreen() {
  const { lots, hydrated, conflicts, outbox, queueCommand, activeHouseholdId } = useOfflineInventory();
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

  const active = useMemo(() => lots.filter((lot) => lot.status === "active"), [lots]);
  const filtered = active.filter((lot) => {
    const matchesQuery = `${lot.name} ${lot.category}`.toLowerCase().includes(query.trim().toLowerCase());
    return matchesQuery && (filter === "all" || lot.location === filter);
  });
  const shelves = locationOrder.filter((location) => filtered.some((lot) => lot.location === location));
  const removed = lots
    .filter((lot) => lot.status !== "active")
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 8);
  const failed = outbox.filter((record) => record.status === "failed");

  async function applyStatus(lot: InventoryLot, type: "consume" | "discard") {
    setActionError(null);
    try {
      await queueCommand(statusCommand(lot, type));
      setUndo({
        label: `${lot.name} → ${type === "consume" ? "used up" : "discarded"}`,
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
    const amount = amountText({
      quantityStatus: payload.quantityStatus ?? lot.quantityStatus,
      quantity: payload.quantity ?? null,
      unit: payload.unit ?? null,
    });
    setUndo({ label: `${payload.name ?? lot.name} → ${amount}`, command: inverse });
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
      <header className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="ml">the kitchen</p>
          <h1 className="hd mt-3 text-[clamp(1.6rem,6vw,1.75rem)]">
            {hydrated
              ? active.length
                ? `${capitalNumberWord(active.length)} thing${active.length === 1 ? "" : "s"}, on ${numberOfShelves(active)}.`
                : "Nothing on the shelves yet."
              : " "}
          </h1>
        </div>
        <div className="flex items-center gap-5">
          <button
            type="button"
            className="m text-[11px] text-[var(--ink-5)] hover:text-[var(--ink)]"
            onClick={() => setAdding(true)}
          >
            add one by hand
          </button>
          <Link
            href="/capture"
            className="glow inline-flex min-h-10 items-center gap-2.5 rounded-[3px] px-4 text-[14px] font-light"
          >
            <Plus className="size-4 text-[var(--accent-ink)]" aria-hidden="true" />
            Photograph a batch
          </Link>
        </div>
      </header>

      {/* Search and shelf filters share one hairline. */}
      <div className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-3 border-b border-[var(--hairline)] pb-3.5">
        <div className="flex min-w-[12rem] flex-1 items-center gap-2.5">
          <Search className="size-4 flex-none text-[var(--ink-6)]" aria-hidden="true" />
          <input
            type="search"
            className="bd min-h-9 w-full bg-transparent text-[var(--ink)] focus:outline-none"
            placeholder="Find something…"
            aria-label="Search the kitchen"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {query && (
            <button
              type="button"
              className="flex size-7 flex-none items-center justify-center text-[var(--ink-6)] hover:text-[var(--ink)]"
              onClick={() => setQuery("")}
              aria-label="Clear search"
            >
              <X className="size-3.5" aria-hidden="true" />
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2" role="group" aria-label="Filter by shelf">
          {(["all", ...locationOrder] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={filter === value}
              className={cn(
                "m pb-1 text-[10.5px] transition",
                filter === value
                  ? "border-b border-[var(--accent)] text-[var(--ink)]"
                  : "text-[var(--ink-5)] hover:text-[var(--ink-2)]",
              )}
              onClick={() => setFilter(value)}
            >
              {value === "all" ? "everywhere" : locationNames[value]}
            </button>
          ))}
        </div>
      </div>

      {actionError && (
        <div className="mt-6">
          <StateNotice title="Change not saved" tone="error">
            {actionError}
          </StateNotice>
        </div>
      )}

      {(conflicts.length > 0 || failed.length > 0) && (
        <div className="mt-8">
          <Section label="resolve" id="sync-conflicts">
            {conflicts.map((record) => (
              <ConflictRow key={record.commandId} record={record} />
            ))}
            {failed.map((record) => (
              <ConflictRow key={record.commandId} record={record} />
            ))}
          </Section>
        </div>
      )}

      {!hydrated ? (
        <div className="mt-9 space-y-3">
          <div className="skeleton h-14" />
          <div className="skeleton h-14" />
          <div className="skeleton h-14" />
        </div>
      ) : shelves.length ? (
        <div className="mt-9 flex flex-col gap-9">
          {shelves.map((location) => {
            const group = filtered.filter((lot) => lot.location === location);
            return (
              <Section
                key={location}
                id={`shelf-${location}`}
                label={locationNames[location]}
                meta={String(group.length)}
              >
                {group.map((lot) => (
                  <LotRow
                    key={lot.id}
                    lot={lot}
                    onAdjust={setAdjusting}
                    onAction={(item, action) => void applyStatus(item, action)}
                  />
                ))}
              </Section>
            );
          })}
        </div>
      ) : (
        <div className="mt-9 border-t border-[var(--hairline)] py-10">
          <h2 className="hd text-[20px]">
            {query || filter !== "all" ? "Nothing matches." : "The kitchen is empty."}
          </h2>
          <p className="bd mt-2 max-w-md">
            {query || filter !== "all"
              ? "Try another search, or a different shelf."
              : "Start with one clear photo of a staged grocery or fridge batch."}
          </p>
          {!query && filter === "all" && (
            <Link
              href="/capture"
              className="glow mt-6 inline-flex min-h-11 items-center gap-2.5 rounded-[3px] px-[18px] text-[15px] font-light"
            >
              Photograph a batch
            </Link>
          )}
        </div>
      )}

      {removed.length > 0 && (
        <div className="mt-11">
          <Section label="lately gone">
            {removed.map((lot) => (
              <div key={lot.id} className="row px-1">
                <span className="nm min-w-0 flex-1 truncate text-[var(--ink-5)]">{lot.name}</span>
                <span className="m text-[10.5px] text-[var(--ink-6)]">{lot.status}</span>
                <button
                  type="button"
                  className="m inline-flex min-h-9 items-center gap-2 text-[10.5px] text-[var(--ink-4)] hover:text-[var(--ink)]"
                  onClick={() => void queueCommand(statusCommand(lot, "restore"))}
                >
                  <RotateCcw className="size-3" aria-hidden="true" /> put back
                </button>
              </div>
            ))}
          </Section>
        </div>
      )}

      {/* The closing line: the standing promise, and the last thing that moved. */}
      <div className="mt-11 flex flex-col gap-4 border-t border-[var(--hairline)] pt-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="bd max-w-[32rem] text-[12px] text-[var(--ink-6)]">
          Only presence is required. Amount, form, place and printed dates stay optional, and unknown
          stays unknown so a recipe never assumes more than you entered.
        </p>
        {undo && (
          <p className="m flex-none text-[10.5px] text-[var(--ink-4)]" role="status">
            last change · {undo.label} ·{" "}
            <button
              type="button"
              className="border-b border-[var(--accent-rule)] text-[var(--accent-ink)]"
              onClick={() => void undoLast()}
            >
              undo
            </button>
          </p>
        )}
      </div>

      {adjusting && (
        <AdjustItemModal
          key={adjusting.id}
          lot={adjusting}
          onClose={() => setAdjusting(null)}
          onSave={saveAdjustment}
        />
      )}
      {adding && (
        <AddItemModal
          householdId={activeHouseholdId}
          onClose={() => setAdding(false)}
          onSave={async (command) => {
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
          }}
        />
      )}
    </Page>
  );
}

/** "two shelves" — how many places actually hold something right now. */
function numberOfShelves(active: InventoryLot[]) {
  const count = new Set(active.map((lot) => lot.location)).size;
  return count === 1 ? "one shelf" : `${numberWord(count)} shelves`;
}
