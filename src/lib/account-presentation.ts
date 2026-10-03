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
 * Selects an explicit frontend-only collection state for visual verification.
 * Normal page loads use `populated`; this does not emulate a backend request.
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

/** Client-side UX check only; this function never authenticates or stores data. */
export function getPasswordConfirmationError(
  password: string,
  confirmation: string,
): string | undefined {
  return password === confirmation
    ? undefined
    : "Passwords do not match. Check both fields.";
}
