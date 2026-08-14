export type UnitFamily = "mass" | "volume" | "count";

export type UnitDefinition = Readonly<{
  id: string;
  family: UnitFamily;
  toBase: number;
  aliases: readonly string[];
}>;

export const UNIT_DEFINITIONS = [
  { id: "mg", family: "mass", toBase: 0.001, aliases: ["milligram", "milligrams"] },
  { id: "g", family: "mass", toBase: 1, aliases: ["gram", "grams"] },
  { id: "kg", family: "mass", toBase: 1000, aliases: ["kilogram", "kilograms"] },
  { id: "oz", family: "mass", toBase: 28.349523125, aliases: ["ounce", "ounces"] },
  { id: "lb", family: "mass", toBase: 453.59237, aliases: ["pound", "pounds", "lbs"] },
  { id: "ml", family: "volume", toBase: 1, aliases: ["milliliter", "milliliters", "millilitre", "millilitres"] },
  { id: "l", family: "volume", toBase: 1000, aliases: ["liter", "liters", "litre", "litres"] },
  { id: "tsp", family: "volume", toBase: 4.92892159375, aliases: ["teaspoon", "teaspoons"] },
  { id: "tbsp", family: "volume", toBase: 14.78676478125, aliases: ["tablespoon", "tablespoons"] },
  { id: "fl-oz", family: "volume", toBase: 29.5735295625, aliases: ["fluid ounce", "fluid ounces", "fl oz"] },
  { id: "cup", family: "volume", toBase: 236.5882365, aliases: ["cups"] },
  { id: "pint", family: "volume", toBase: 473.176473, aliases: ["pints", "pt"] },
  { id: "quart", family: "volume", toBase: 946.352946, aliases: ["quarts", "qt"] },
  { id: "gallon", family: "volume", toBase: 3785.411784, aliases: ["gallons", "gal"] },
  { id: "count", family: "count", toBase: 1, aliases: ["each", "piece", "pieces", "item", "items", "clove", "cloves", "slice", "slices", "can", "cans"] },
  { id: "dozen", family: "count", toBase: 12, aliases: ["dozens"] },
] as const satisfies readonly UnitDefinition[];

const normalizeUnitLabel = (value: string): string =>
  value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en-US")
    .replace(/\./g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");

const definitionsByAlias = (() => {
  const result = new Map<string, UnitDefinition>();

  for (const definition of UNIT_DEFINITIONS) {
    for (const alias of [definition.id, ...definition.aliases]) {
      result.set(normalizeUnitLabel(alias), definition);
    }
  }

  return result;
})();

export function getUnitDefinition(unit: string): UnitDefinition | undefined {
  return definitionsByAlias.get(normalizeUnitLabel(unit));
}

export function normalizeUnit(unit: string): string | undefined {
  return getUnitDefinition(unit)?.id;
}

/** Returns null for unknown units or any cross-family request. */
export function convertQuantity(
  quantity: number,
  fromUnit: string,
  toUnit: string,
): number | null {
  if (!Number.isFinite(quantity) || quantity < 0) {
    return null;
  }

  const from = getUnitDefinition(fromUnit);
  const to = getUnitDefinition(toUnit);

  if (!from || !to || from.family !== to.family) {
    return null;
  }

  return (quantity * from.toBase) / to.toBase;
}

export type QuantityValue = Readonly<{ quantity: number; unit: string }>;

/** Returns null as soon as one value cannot be converted to the target unit. */
export function sumConvertibleQuantities(
  values: readonly QuantityValue[],
  targetUnit: string,
): number | null {
  let total = 0;

  for (const value of values) {
    const converted = convertQuantity(value.quantity, value.unit, targetUnit);
    if (converted === null) {
      return null;
    }
    total += converted;
  }

  return total;
}
