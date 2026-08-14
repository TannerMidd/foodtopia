import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export type HouseholdAiProvider = "openai" | "openrouter";

type CredentialContext = {
  householdId: string;
  provider: HouseholdAiProvider;
};

type CredentialKeyring = {
  activeKeyId: string;
  keys: Map<string, Buffer>;
};

type CredentialKeyringStatus = {
  available: boolean;
  activeKeyId: string | null;
};

const KEYRING_ENV = "HOUSEHOLD_AI_CREDENTIAL_KEYRING";
const ACTIVE_KEY_ID_ENV = "HOUSEHOLD_AI_CREDENTIAL_ACTIVE_KEY_ID";
const ENVELOPE_VERSION = "v1";
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const KEY_BYTES = 32;
const MAX_API_KEY_LENGTH = 4096;
const safeKeyId = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const base64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const base64Url = /^[A-Za-z0-9_-]+$/;

export class HouseholdAiCredentialError extends Error {
  constructor(message = "Household AI credentials are unavailable.") {
    super(message);
    this.name = "HouseholdAiCredentialError";
  }
}

const fail = (): never => {
  throw new HouseholdAiCredentialError();
};

const required = <T>(value: T | null | undefined): T =>
  value === null || value === undefined ? fail() : value;

const assertContext = ({ householdId, provider }: CredentialContext) => {
  if (
    !householdId ||
    householdId !== householdId.trim() ||
    householdId.length > 128 ||
    /[\u0000-\u001f\u007f]/.test(householdId) ||
    (provider !== "openai" && provider !== "openrouter")
  ) {
    fail();
  }
};

const parseJsonString = (
  source: string,
  start: number,
): { value: string; next: number } => {
  let index = start + 1;
  let escaped = false;
  while (index < source.length) {
    const char = source.charAt(index);
    if (escaped) {
      escaped = false;
    } else if (char === "\\") {
      escaped = true;
    } else if (char === '"') {
      const token = source.slice(start, index + 1);
      try {
        return { value: JSON.parse(token) as string, next: index + 1 };
      } catch {
        return fail();
      }
    } else if (char && char.charCodeAt(0) < 0x20) {
      fail();
    }
    index += 1;
  }
  throw new HouseholdAiCredentialError();
};

/** Validates JSON nesting and rejects duplicate object keys before JSON.parse loses them. */
const rejectDuplicateJsonKeys = (source: string) => {
  let index = 0;
  const whitespace = /[\u0009\u000a\u000d\u0020]/;
  const skipWhitespace = () => {
    while (index < source.length && whitespace.test(source[index] ?? "")) {
      index += 1;
    }
  };
  const parseValue = (): void => {
    skipWhitespace();
    const char = source.charAt(index);
    if (char === "{") {
      index += 1;
      skipWhitespace();
      const keys = new Set<string>();
      if (source[index] === "}") {
        index += 1;
        return;
      }
      while (true) {
        skipWhitespace();
        if (source.charAt(index) !== '"') fail();
        const key = parseJsonString(source, index);
        index = key.next;
        if (keys.has(key.value)) fail();
        keys.add(key.value);
        skipWhitespace();
        if (source.charAt(index) !== ":") fail();
        index += 1;
        parseValue();
        skipWhitespace();
        if (source.charAt(index) === "}") {
          index += 1;
          return;
        }
        if (source.charAt(index) !== ",") fail();
        index += 1;
      }
    }
    if (char === "[") {
      index += 1;
      skipWhitespace();
      if (source.charAt(index) === "]") {
        index += 1;
        return;
      }
      while (true) {
        parseValue();
        skipWhitespace();
        if (source.charAt(index) === "]") {
          index += 1;
          return;
        }
        if (source.charAt(index) !== ",") fail();
        index += 1;
      }
    }
    if (char === '"') {
      index = parseJsonString(source, index).next;
      return;
    }
    const nextDelimiter = source.slice(index).search(/[\],}\s]/);
    const token = source.slice(
      index,
      nextDelimiter === -1 ? source.length : index + nextDelimiter,
    );
    if (!token) fail();
    index += token.length;
  };

  parseValue();
  skipWhitespace();
  if (index !== source.length) fail();
};

const decodeKey = (encoded: unknown): Buffer => {
  if (typeof encoded !== "string") return fail();
  if (!base64.test(encoded)) return fail();
  const key = Buffer.from(encoded, "base64");
  if (key.length !== KEY_BYTES || key.toString("base64") !== encoded) fail();
  return key;
};

const getKeyring = (): CredentialKeyring => {
  const raw = process.env[KEYRING_ENV];
  const activeKeyId = process.env[ACTIVE_KEY_ID_ENV];
  if (!raw) return fail();
  if (!activeKeyId) return fail();
  if (!safeKeyId.test(activeKeyId)) return fail();

  try {
    rejectDuplicateJsonKeys(raw);
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") return fail();
    const entries = Object.entries(parsed as Record<string, unknown>);
    if (entries.length === 0 || entries.length > 32) return fail();
    const keys = new Map<string, Buffer>();
    for (const [keyId, encodedKey] of entries) {
      if (!safeKeyId.test(keyId)) return fail();
      keys.set(keyId, decodeKey(encodedKey));
    }
    if (!keys.has(activeKeyId)) return fail();
    return { activeKeyId, keys };
  } catch (error) {
    if (error instanceof HouseholdAiCredentialError) throw error;
    return fail();
  }
};

const aadFor = ({ householdId, provider }: CredentialContext) => {
  assertContext({ householdId, provider });
  return Buffer.from(
    `foodtopia:household-ai-credential:${ENVELOPE_VERSION}:${householdId}:${provider}`,
    "utf8",
  );
};

const decodeEnvelopePart = (value: string) => {
  if (!base64Url.test(value)) fail();
  const decoded = Buffer.from(value, "base64url");
  if (!decoded.length || decoded.toString("base64url") !== value) fail();
  return decoded;
};

const assertApiKey = (apiKey: string) => {
  if (
    !apiKey ||
    apiKey.length > MAX_API_KEY_LENGTH ||
    /[\u0000-\u001f\u007f]/.test(apiKey)
  ) {
    fail();
  }
};

export const getCredentialKeyringStatus = (): CredentialKeyringStatus => {
  try {
    const keyring = getKeyring();
    return { available: true, activeKeyId: keyring.activeKeyId };
  } catch {
    return { available: false, activeKeyId: null };
  }
};

export const encryptHouseholdApiKey = (
  apiKey: string,
  context: CredentialContext,
) => {
  assertApiKey(apiKey);
  const keyring = getKeyring();
  const key = required(keyring.keys.get(keyring.activeKeyId));

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aadFor(context));
  const ciphertext = Buffer.concat([cipher.update(apiKey, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    encryptedApiKey: [
      ENVELOPE_VERSION,
      iv.toString("base64url"),
      authTag.toString("base64url"),
      ciphertext.toString("base64url"),
    ].join("."),
    encryptionKeyId: keyring.activeKeyId,
  };
};

export const decryptHouseholdApiKey = (
  encrypted: { encryptedApiKey: string; encryptionKeyId: string },
  context: CredentialContext,
): string => {
  assertContext(context);
  if (!safeKeyId.test(encrypted.encryptionKeyId)) fail();
  const [version = "", ivPart = "", authTagPart = "", ciphertextPart = "", ...rest] =
    encrypted.encryptedApiKey.split(".");
  if (
    version !== ENVELOPE_VERSION ||
    !ivPart ||
    !authTagPart ||
    !ciphertextPart ||
    rest.length > 0
  ) {
    fail();
  }

  const keyring = getKeyring();
  const key = required(keyring.keys.get(encrypted.encryptionKeyId));
  const iv = decodeEnvelopePart(ivPart);
  const authTag = decodeEnvelopePart(authTagPart);
  const ciphertext = decodeEnvelopePart(ciphertextPart);
  if (iv.length !== IV_BYTES || authTag.length !== AUTH_TAG_BYTES) fail();

  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(aadFor(context));
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
      "utf8",
    );
    assertApiKey(plaintext);
    return plaintext;
  } catch (error) {
    if (error instanceof HouseholdAiCredentialError) throw error;
    return fail();
  }
};

export const needsCredentialRotation = (encryptionKeyId: string) => {
  if (!safeKeyId.test(encryptionKeyId)) return true;
  const status = getCredentialKeyringStatus();
  return !status.available || status.activeKeyId !== encryptionKeyId;
};
