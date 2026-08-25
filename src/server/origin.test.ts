import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiFault } from "@/server/http";
import { assertSameOrigin } from "./origin";

const mocks = vi.hoisted(() => ({
  serverEnv: { appUrl: null as string | null },
}));

vi.mock("@/lib/env", () => ({ serverEnv: mocks.serverEnv }));

const APP_URL = "https://foodtopia.example";

function request(origin?: string) {
  return new NextRequest("https://foodtopia.example/api/v1/admin/enable", {
    method: "POST",
    headers: origin ? { origin } : {},
  });
}

describe("assertSameOrigin", () => {
  beforeEach(() => {
    mocks.serverEnv.appUrl = APP_URL;
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("accepts a matching https origin", () => {
    expect(() => assertSameOrigin(request(APP_URL))).not.toThrow();
  });

  it("allows http only for a localhost app URL", () => {
    mocks.serverEnv.appUrl = "http://localhost:3000";
    expect(() =>
      assertSameOrigin(
        new NextRequest("http://localhost:3000/api/v1/admin/enable", {
          method: "POST",
          headers: { origin: "http://localhost:3000" },
        }),
      ),
    ).not.toThrow();
  });

  it("rejects a mismatched origin with INVALID_ORIGIN", async () => {
    expect.assertions(4);
    try {
      assertSameOrigin(request("https://evil.example"));
    } catch (error) {
      expect(error).toBeInstanceOf(ApiFault);
      expect((error as ApiFault).code).toBe("INVALID_ORIGIN");
      expect((error as ApiFault).status).toBe(403);
      expect((error as ApiFault).retryable).toBe(false);
    }
  });

  it("rejects a missing Origin header with INVALID_ORIGIN and warns distinctly", () => {
    expect.assertions(3);
    try {
      assertSameOrigin(request());
    } catch (error) {
      expect((error as ApiFault).code).toBe("INVALID_ORIGIN");
      expect((error as ApiFault).status).toBe(403);
      expect(console.warn).toHaveBeenCalledWith(
        "Same-origin check rejected a request without an Origin header",
        expect.objectContaining({ path: "/api/v1/admin/enable" }),
      );
    }
  });

  it("fails with AUTH_CONFIGURATION_ERROR when NEXT_PUBLIC_APP_URL is unset", async () => {
    mocks.serverEnv.appUrl = null;
    expect.assertions(3);
    try {
      assertSameOrigin(request(APP_URL));
    } catch (error) {
      expect((error as ApiFault).code).toBe("AUTH_CONFIGURATION_ERROR");
      expect((error as ApiFault).status).toBe(503);
      expect(String((error as ApiFault).message)).toContain(
        "NEXT_PUBLIC_APP_URL",
      );
    }
  });

  it("fails with AUTH_CONFIGURATION_ERROR when the app URL is unparseable or insecure", () => {
    const invalidUrls = ["not-a-url", "http://foodtopia.example"];
    for (const appUrl of invalidUrls) {
      mocks.serverEnv.appUrl = appUrl;
      try {
        assertSameOrigin(request(appUrl === "not-a-url" ? APP_URL : appUrl));
        expect.unreachable(`expected ${appUrl} to be rejected`);
      } catch (error) {
        expect((error as ApiFault).code).toBe("AUTH_CONFIGURATION_ERROR");
      }
    }
  });
});
