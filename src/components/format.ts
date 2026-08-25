import type { DateLabelType, FoodLocation, InventoryLot } from "@/contracts/domain";

export const locationOrder: FoodLocation[] = ["fridge", "freezer", "pantry", "other", "unknown"];

/* Lowercase throughout: these are labels, and labels do not shout. */
export const locationNames: Record<FoodLocation, string> = {
  fridge: "fridge",
  freezer: "freezer",
  pantry: "pantry",
  other: "other",
  unknown: "unplaced",
};

const dateLabelNames: Record<DateLabelType, string> = {
  best_before: "best before",
  sell_by: "sell by",
  use_by: "use by",
  unknown: "printed date",
};

/** The shortest true reading of a label type — what fits on a disc. */
export function dateKindShort(type: DateLabelType | null | undefined) {
  if (type === "best_before") return "best by";
  if (type === "sell_by") return "sell by";
  if (type === "use_by") return "use by";
  return "date";
}

/** Whole days from today until a printed date, negative once it has passed. */
export function daysUntil(date: string) {
  const target = new Date(`${date}T12:00:00`);
  return Math.ceil((target.getTime() - Date.now()) / 86_400_000);
}

/** "tomorrow", "+2d", "3d past" — the shortest true reading of a printed date. */
export function relativeDate(date: string) {
  const days = daysUntil(date);
  if (days < 0) return `${Math.abs(days)}d past`;
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  return `+${days}d`;
}

/** "use by · tomorrow". The label type is recorded as written on the package. */
export function dateText(lot: Pick<InventoryLot, "dateLabel" | "dateLabelType">) {
  if (!lot.dateLabel) return null;
  const kind = lot.dateLabelType ? dateLabelNames[lot.dateLabelType] : "printed date";
  return `${kind} · ${relativeDate(lot.dateLabel)}`;
}

/** A printed date reads as time-bound only when it is close or already past. */
export function isDatePressing(lot: Pick<InventoryLot, "dateLabel">) {
  return lot.dateLabel != null && daysUntil(lot.dateLabel) <= 2;
}

/** "4 count", "about 6 oz", "unknown" — unknown stays unknown. */
export function amountText(lot: Pick<InventoryLot, "quantityStatus" | "quantity" | "unit">) {
  if (lot.quantityStatus === "unknown" || lot.quantity == null) return "unknown";
  const value = `${lot.quantity}${lot.unit ? ` ${lot.unit}` : ""}`;
  return lot.quantityStatus === "estimated" ? `about ${value}` : value;
}

/** "fresh · produce" — the two facts that describe a lot at a glance. */
export function formText(lot: Pick<InventoryLot, "form" | "category">) {
  const form = lot.form === "unspecified" ? null : lot.form;
  // Metadata is set lowercase throughout; the stored category keeps its case.
  return [form, lot.category.toLowerCase()].filter(Boolean).join(" · ");
}

export function clockTime(value: string | number | Date) {
  return new Date(value).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** "tuesday, 22 august" — the date, set the way the design writes it. */
export function longDate(value: Date = new Date()) {
  const weekday = value.toLocaleDateString("en-GB", { weekday: "long" });
  const day = value.toLocaleDateString("en-GB", { day: "numeric", month: "long" });
  return `${weekday}, ${day}`.toLowerCase();
}

const words = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];

/** Small counts read better as words in a sentence; digits stay for the rest. */
export function numberWord(count: number) {
  return words[count] ?? String(count);
}

/** Sentence-leading form of the same. */
export function capitalNumberWord(count: number) {
  const word = numberWord(count);
  return word.charAt(0).toUpperCase() + word.slice(1);
}
