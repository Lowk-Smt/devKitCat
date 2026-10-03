export type AccountCollectionPreviewState =
  | "populated"
  | "empty"
  | "loading"
  | "error";

const COLLECTION_STATES: readonly AccountCollectionPreviewState[] = [
  "populated",
  "empty",
  "loading",
  "error",
];

/**
 * Selects an explicit visual-only collection state (`?preview=…`) for design
 * verification. Real page loads use the customer's own data with `populated` as
 * the default; this never emulates or replaces a database request.
 */
export function parseAccountCollectionPreviewState(
  value: string | string[] | undefined,
): AccountCollectionPreviewState {
  const candidate = Array.isArray(value) ? value[0] : value;
  return COLLECTION_STATES.find((state) => state === candidate) ?? "populated";
}

/** Coerces a possibly repeated URL query parameter to its first string value. */
export function firstSearchParam(
  value: string | string[] | undefined,
): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Shared confirmation check: instant client feedback before submit, and part of
 * the server-side registration validation. It never authenticates or stores
 * anything.
 */
export function getPasswordConfirmationError(
  password: string,
  confirmation: string,
): string | undefined {
  return password === confirmation
    ? undefined
    : "Passwords do not match. Check both fields.";
}

/**
 * Initials for the account avatar: the first letter of the first and last word,
 * or the first two letters of a single-word name.
 */
export function customerInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toLocaleUpperCase("en-US");

  const first = words[0]?.[0] ?? "";
  const last = words[words.length - 1]?.[0] ?? "";
  return (first + last).toLocaleUpperCase("en-US") || "?";
}

/** Calendar date (YYYY-MM-DD) in UTC, for `<time>` attributes and formatting. */
export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export interface AuthNotice {
  tone: "info" | "warning";
  title: string;
  body: string;
}

const AUTH_NOTICES: Record<string, AuthNotice> = {
  "signed-out": {
    tone: "info",
    title: "You are signed out",
    body: "Your session ended. Sign in again to open your purchases and library.",
  },
  "service-unavailable": {
    tone: "warning",
    title: "Account services unavailable",
    body: "This deployment has no PostgreSQL database configured, so accounts and sessions cannot be verified. Set DATABASE_URL, then run the Prisma migration and seed.",
  },
};

/**
 * Turns the `/login` and `/register` query parameters into a single notice.
 * Unknown values are ignored rather than echoed back into the page.
 */
export function resolveAuthNotice(
  params: Record<string, string | string[] | undefined>,
): AuthNotice | null {
  if (firstSearchParam(params["signed-out"]) === "1") {
    return AUTH_NOTICES["signed-out"];
  }

  const error = firstSearchParam(params.error);
  return error ? (AUTH_NOTICES[error] ?? null) : null;
}
