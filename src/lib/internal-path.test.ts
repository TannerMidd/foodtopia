import { describe, expect, it } from "vitest";

import { normalizeInternalPath } from "./internal-path";

describe("normalizeInternalPath", () => {
  it("keeps and canonicalizes same-origin application paths", () => {
    expect(normalizeInternalPath("/")).toBe("/");
    expect(normalizeInternalPath("/inventory?location=fridge#latest")).toBe(
      "/inventory?location=fridge#latest",
    );
    expect(normalizeInternalPath("/capture/../inventory")).toBe("/inventory");
    expect(normalizeInternalPath("/search?q=100%25")).toBe(
      "/search?q=100%25",
    );
    expect(normalizeInternalPath("/recipes/caf%C3%A9")).toBe(
      "/recipes/caf%C3%A9",
    );
  });

  it.each([
    undefined,
    null,
    "",
    "inventory",
    "https://attacker.example/path",
    "//attacker.example/path",
    "///attacker.example/path",
    "\\\\attacker.example/path",
    "/\\\\attacker.example/path",
    "/%5c%5cattacker.example/path",
    "/%255c%255cattacker.example/path",
    "/%2f%2fattacker.example/path",
    "/safe\n//attacker.example/path",
    "/%0d%0aLocation%3a%20https%3a%2f%2fattacker.example",
    "/%250aattacker.example",
    "/safe\u2028path",
  ])("falls back to root for unsafe redirect input %j", (value) => {
    expect(normalizeInternalPath(value)).toBe("/");
  });
});
