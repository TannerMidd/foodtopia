const INTERNAL_ORIGIN = "https://foodtopia.invalid";
const MAX_INTERNAL_PATH_LENGTH = 4_096;
const FORBIDDEN_CHARACTERS =
  /[\u0000-\u001f\u007f-\u009f\u2028\u2029\\]/;
const FORBIDDEN_PERCENT_ESCAPE =
  /%(?:0[0-9a-f]|1[0-9a-f]|5c|7f)|%c2%(?:8[0-9a-f]|9[0-9a-f])|%e2%80%(?:a8|a9)/i;
const ENCODED_LEADING_SEPARATOR = /^\/%(?:2f|5c)/i;

function containsEncodedRedirectSyntax(value: string): boolean {
  let inspected = value;

  // Search through percent-encoded percent signs so double-encoded separators
  // cannot become significant after another URL-decoding boundary. A normal
  // encoded percent (for example, `?amount=100%25`) remains valid.
  for (let depth = 0; depth < 8; depth += 1) {
    if (
      FORBIDDEN_PERCENT_ESCAPE.test(inspected) ||
      ENCODED_LEADING_SEPARATOR.test(inspected)
    ) {
      return true;
    }

    const unwrapped = inspected.replace(/%25/gi, "%");
    if (unwrapped === inspected) return false;
    inspected = unwrapped;
  }

  // Excessive encoding is ambiguous and unnecessary for application routes.
  return true;
}

/**
 * Canonicalizes a same-origin absolute application path. Untrusted values that
 * could be parsed as an authority, including browser-normalized backslashes or
 * control characters, collapse to the application root.
 */
export function normalizeInternalPath(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_INTERNAL_PATH_LENGTH ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    FORBIDDEN_CHARACTERS.test(value) ||
    containsEncodedRedirectSyntax(value)
  ) {
    return "/";
  }

  try {
    const parsed = new URL(value, INTERNAL_ORIGIN);
    if (parsed.origin !== INTERNAL_ORIGIN) return "/";

    const normalized = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    return normalized.startsWith("/") &&
      !normalized.startsWith("//") &&
      !FORBIDDEN_CHARACTERS.test(normalized)
      ? normalized
      : "/";
  } catch {
    return "/";
  }
}
