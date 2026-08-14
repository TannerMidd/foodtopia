import { afterEach, describe, expect, it } from "vitest";

import {
  decryptHouseholdApiKey,
  encryptHouseholdApiKey,
  getCredentialKeyringStatus,
  needsCredentialRotation,
} from "./household-ai-credentials";

const KEYRING_ENV = "HOUSEHOLD_AI_CREDENTIAL_KEYRING";
const ACTIVE_KEY_ID_ENV = "HOUSEHOLD_AI_CREDENTIAL_ACTIVE_KEY_ID";
const originalKeyring = process.env[KEYRING_ENV];
const originalActiveKey = process.env[ACTIVE_KEY_ID_ENV];
const keyA = Buffer.alloc(32, 7).toString("base64");
const keyB = Buffer.alloc(32, 8).toString("base64");

const setKeyring = (keys: Record<string, string>, activeKeyId = "primary") => {
  process.env[KEYRING_ENV] = JSON.stringify(keys);
  process.env[ACTIVE_KEY_ID_ENV] = activeKeyId;
};

afterEach(() => {
  if (originalKeyring === undefined) delete process.env[KEYRING_ENV];
  else process.env[KEYRING_ENV] = originalKeyring;
  if (originalActiveKey === undefined) delete process.env[ACTIVE_KEY_ID_ENV];
  else process.env[ACTIVE_KEY_ID_ENV] = originalActiveKey;
});

describe.sequential("household AI credential encryption", () => {
  it.each(["openai", "openrouter"] as const)(
    "round-trips %s credentials with household/provider-bound encryption",
    (provider) => {
      setKeyring({ primary: keyA });
      const stored = encryptHouseholdApiKey("sk-private-value", {
        householdId: "household-1",
        provider,
      });

      expect(stored.encryptionKeyId).toBe("primary");
      expect(stored.encryptedApiKey).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
      expect(
        decryptHouseholdApiKey(stored, { householdId: "household-1", provider }),
      ).toBe("sk-private-value");
    },
  );

  it("rejects wrong household, provider, and ciphertext tampering", () => {
    setKeyring({ primary: keyA });
    const stored = encryptHouseholdApiKey("sk-private-value", {
      householdId: "household-1",
      provider: "openai",
    });

    expect(() =>
      decryptHouseholdApiKey(stored, {
        householdId: "household-2",
        provider: "openai",
      }),
    ).toThrow("credentials are unavailable");
    expect(() =>
      decryptHouseholdApiKey(stored, {
        householdId: "household-1",
        provider: "openrouter",
      }),
    ).toThrow("credentials are unavailable");
    expect(() =>
      decryptHouseholdApiKey(
        { ...stored, encryptedApiKey: `${stored.encryptedApiKey}x` },
        { householdId: "household-1", provider: "openai" },
      ),
    ).toThrow("credentials are unavailable");
  });

  it("detects key rotation and rejects credentials when an old key is unavailable", () => {
    setKeyring({ primary: keyA, previous: keyB });
    const stored = encryptHouseholdApiKey("sk-private-value", {
      householdId: "household-1",
      provider: "openai",
    });
    expect(needsCredentialRotation(stored.encryptionKeyId)).toBe(false);

    process.env[ACTIVE_KEY_ID_ENV] = "previous";
    expect(needsCredentialRotation(stored.encryptionKeyId)).toBe(true);
    expect(
      decryptHouseholdApiKey(stored, {
        householdId: "household-1",
        provider: "openai",
      }),
    ).toBe("sk-private-value");

    setKeyring({ previous: keyB }, "previous");
    expect(() =>
      decryptHouseholdApiKey(stored, {
        householdId: "household-1",
        provider: "openai",
      }),
    ).toThrow("credentials are unavailable");
  });

  it("fails closed for malformed keyrings, bad key IDs, and duplicate JSON keys", () => {
    process.env[ACTIVE_KEY_ID_ENV] = "primary";
    process.env[KEYRING_ENV] = '{"primary":"not-base64"}';
    expect(getCredentialKeyringStatus()).toEqual({
      available: false,
      activeKeyId: null,
    });

    process.env[KEYRING_ENV] = JSON.stringify({ primary: Buffer.alloc(31).toString("base64") });
    expect(getCredentialKeyringStatus().available).toBe(false);

    process.env[KEYRING_ENV] = `{"primary":"${keyA}","primary":"${keyB}"}`;
    expect(getCredentialKeyringStatus().available).toBe(false);

    setKeyring({ "bad key": keyA });
    expect(getCredentialKeyringStatus().available).toBe(false);
  });
});
