import { describe, expect, it } from "vitest";
import {
  convertQuantity,
  normalizeUnit,
  sumConvertibleQuantities,
} from "./units";

describe("unit conversion", () => {
  it("normalizes common unit aliases", () => {
    expect(normalizeUnit("tablespoons")).toBe("tbsp");
    expect(normalizeUnit("LBS.")).toBe("lb");
  });

  it("converts within mass, volume, and count families", () => {
    expect(convertQuantity(16, "oz", "lb")).toBeCloseTo(1, 8);
    expect(convertQuantity(1, "cup", "tbsp")).toBeCloseTo(16, 8);
    expect(convertQuantity(2, "dozen", "count")).toBe(24);
  });

  it("never converts across unit families", () => {
    expect(convertQuantity(1, "cup", "g")).toBeNull();
    expect(convertQuantity(1, "count", "ml")).toBeNull();
  });

  it("refuses a sum if any value is not safely convertible", () => {
    expect(
      sumConvertibleQuantities(
        [
          { quantity: 8, unit: "oz" },
          { quantity: 0.5, unit: "lb" },
        ],
        "oz",
      ),
    ).toBeCloseTo(16, 8);
    expect(
      sumConvertibleQuantities(
        [
          { quantity: 1, unit: "cup" },
          { quantity: 100, unit: "g" },
        ],
        "ml",
      ),
    ).toBeNull();
  });
});
