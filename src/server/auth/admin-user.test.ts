import { describe, expect, it } from "vitest";

import { normalizeAdminEmail } from "./admin-user";

describe("normalizeAdminEmail", () => {
  it("compares emails case-insensitively with trimmed whitespace", () => {
    expect(normalizeAdminEmail("  Admin@Foodtopia.Example ")).toBe(
      normalizeAdminEmail("admin@foodtopia.example"),
    );
  });

  it("keeps distinct addresses distinct", () => {
    expect(normalizeAdminEmail("admin@foodtopia.example")).not.toBe(
      normalizeAdminEmail("owner@foodtopia.example"),
    );
  });

  it("uses the en-US locale for stable lowering", () => {
    // A Turkish locale would map "I" to a dotless character; the configured
    // comparison must not depend on the server's runtime locale.
    expect(normalizeAdminEmail("ADMIN@EXAMPLE.COM")).toBe(
      "admin@example.com",
    );
  });
});
