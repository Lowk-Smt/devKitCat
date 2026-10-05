import "server-only";
import { isValidEmailAddress, normalizeEmail } from "./auth-core";

/**
 * Framework-free authorization policy for devKitCat's private creator-management
 * surface: which roles exist, what each role may do, how a stored role becomes a
 * `StaffAccess` decision, and the wording for every refusal.
 *
 * Mirrors `auth-core.ts`: nothing here touches Next.js, Prisma, or the request
 * context, so the whole surface is unit-testable and every rule is stated once.
 *
 * Three properties are load-bearing and are asserted in
 * `tests/staff-authorization.test.mjs`:
 *
 * 1. **Privileges are derived, never supplied.** A `StaffAccess` value carries
 *    only a customer id and a role; `hasStaffPrivilege` looks the role up in
 *    `ROLE_PRIVILEGES` below. Nothing accepts a privilege list, a boolean
 *    `isAdmin`, or a role from a form, a query string, or client state.
 * 2. **An unknown role grants nothing.** `createStaffAccess` fails closed, so a
 *    value outside `STAFF_ROLES` (a future enum member, a corrupted row, a
 *    forged object) never inherits owner or staff rights.
 * 3. **A grant is not a customer field.** Registration and profile editing write
 *    `Customer` columns only, and `Customer` has no role column — the role lives
 *    in `StaffMembership`, which no user-facing write path touches.
 */

/** Roles that may hold a `StaffMembership`, lowest to highest. */
export const STAFF_ROLES = ["staff", "owner"] as const;

export type StaffRole = (typeof STAFF_ROLES)[number];

/** The `StaffRole` Prisma enum's column values. */
export const STAFF_ROLE_COLUMN: Record<StaffRole, "STAFF" | "OWNER"> = {
  staff: "STAFF",
  owner: "OWNER",
};

/** Prisma enum value → application role. Unknown values are dropped. */
export const STAFF_ROLE_FROM_COLUMN: Record<string, StaffRole | undefined> = {
  STAFF: "staff",
  OWNER: "owner",
};

/**
 * The smallest set of rights that lets an operation be gated on its own. This is
 * the seam later phases extend: a creator who owns one product gets a
 * `products:manage` decision computed from *their own* relation table, and an
 * application reviewer gets a moderation privilege — neither has to invent a
 * staff role, and neither can reach `staff:manage`.
 */
export const STAFF_PRIVILEGES = [
  /** Read the catalog including unpublished drafts. */
  "products:view",
  /** Create a draft and edit an existing product's details. */
  "products:manage",
  /** Delete a product outright. */
  "products:delete",
  /** Grant or revoke `StaffMembership` rows. Owners only. */
  "staff:manage",
] as const;

export type StaffPrivilege = (typeof STAFF_PRIVILEGES)[number];

/**
 * Phase 1 business rule: creating and managing marketplace products is limited
 * to the owner and explicitly authorized staff. Both roles therefore hold every
 * product privilege, and only the owner may hand out access. Deletion is split
 * into its own privilege so a later phase can narrow staff rights (or widen a
 * creator's) without touching the authentication model.
 */
export const ROLE_PRIVILEGES: Record<StaffRole, readonly StaffPrivilege[]> = {
  staff: ["products:view", "products:manage", "products:delete"],
  owner: ["products:view", "products:manage", "products:delete", "staff:manage"],
};

/** The role label used in the management UI. */
export const STAFF_ROLE_LABELS: Record<StaffRole, string> = {
  owner: "Owner",
  staff: "Staff",
};

/**
 * The verified staff decision for one request. Built only by
 * `createStaffAccessService` from a `StaffMembership` row plus the session's own
 * customer id — never from request input.
 */
export interface StaffAccess {
  /** Always the signed-in customer's id, so a forged id cannot name someone. */
  customerId: string;
  role: StaffRole;
  /** When the grant was issued; `null` is impossible, so it is simply absent. */
  grantedAt: Date;
}

export interface StaffAccessInput {
  customerId: unknown;
  role: unknown;
  grantedAt?: unknown;
}

function readTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Roles are case-insensitive on the way in (forms, CLI flags) and strict after. */
export function isStaffRole(value: unknown): value is StaffRole {
  return (STAFF_ROLES as readonly unknown[]).includes(value);
}

/**
 * Parses a role a *human operator* typed (the bootstrap CLI, an owner's grant
 * form). Anything unrecognized returns null so the caller refuses instead of
 * defaulting — a default of "owner" here would be the privilege-escalation bug.
 */
export function parseStaffRoleInput(value: unknown): StaffRole | null {
  const normalized = readTrimmedString(value).toLowerCase();
  return isStaffRole(normalized) ? normalized : null;
}

/**
 * Turns a stored membership into a decision, or `null` when it must not grant
 * access. An empty/unknown role, a missing customer id, or an id that is not the
 * session's own customer yields no access: the service only ever passes the
 * session customer's id, so this is a second lock on the same door.
 */
export function createStaffAccess(input: StaffAccessInput): StaffAccess | null {
  const role = STAFF_ROLE_FROM_COLUMN[readTrimmedString(input.role).toUpperCase()];
  const customerId = typeof input.customerId === "string" ? input.customerId.trim() : "";
  if (!role || customerId.length === 0) return null;

  const grantedAt = input.grantedAt instanceof Date ? input.grantedAt : new Date(0);

  return { customerId, role, grantedAt };
}

/** The single authorization question every protected operation asks. */
export function hasStaffPrivilege(
  access: StaffAccess | null | undefined,
  privilege: StaffPrivilege,
): boolean {
  if (!access) return false;
  // Read through a normal property lookup on a frozen-by-shape literal, then
  // verify the role, so an access object carrying a role outside `STAFF_ROLES`
  // (or with a hand-built `privileges` array) still resolves to no rights.
  if (!isStaffRole(access.role)) return false;

  return ROLE_PRIVILEGES[access.role].includes(privilege);
}

/** True when the access may change `StaffMembership` rows at all. */
export function canManageStaffAccess(access: StaffAccess | null | undefined): boolean {
  return hasStaffPrivilege(access, "staff:manage");
}

export type StaffFailureCode =
  /** `DATABASE_URL` is not configured, so no grant can be read or written. */
  | "UNAVAILABLE"
  /** No verified customer identity reached the service. */
  | "UNAUTHENTICATED"
  /** Authenticated, but not holding the required privilege. */
  | "FORBIDDEN"
  /** The form value was not usable (email shape, role, missing field). */
  | "INVALID_INPUT"
  /** No customer account, or no membership, matched the request. */
  | "NOT_FOUND"
  /** The change would leave devKitCat with no owner. */
  | "LAST_OWNER"
  | "ERROR";

export type StaffResult<TValue> =
  | { ok: true; value: TValue }
  | { ok: false; code: StaffFailureCode };

/**
 * Every refusal is a short, generic sentence: the management surface is private,
 * so it confirms nothing about whether an account exists beyond what the
 * operator's own form already knows, and it never echoes a stored value.
 */
export function describeStaffFailure(code: StaffFailureCode): string {
  switch (code) {
    case "UNAVAILABLE":
      return "Staff access cannot be checked right now because no database is configured for this deployment.";
    case "UNAUTHENTICATED":
      return "Sign in with an authorized staff account to continue.";
    case "FORBIDDEN":
      return "This area is limited to explicitly authorized staff accounts.";
    case "INVALID_INPUT":
      return "Check the email address and role, then try again.";
    case "NOT_FOUND":
      return "No customer account matches that email address yet. The account has to register before it can be granted access.";
    case "LAST_OWNER":
      return "devKitCat needs at least one owner. Grant the role to another account first.";
    case "ERROR":
      return "Staff access could not be updated. Please try again.";
  }
}

/** Maps a service failure onto the notice the management page can render. */
export function staffNoticeCode(code: StaffFailureCode): ManageNoticeCode {
  switch (code) {
    case "UNAVAILABLE":
      return "unavailable";
    case "UNAUTHENTICATED":
      return "signed-out";
    case "LAST_OWNER":
      return "last-owner";
    case "NOT_FOUND":
      return "unknown-account";
    case "INVALID_INPUT":
      return "invalid-input";
    case "FORBIDDEN":
      return "denied";
    case "ERROR":
      // A database failure is reported as "could not be saved", never as a
      // detail about the row or the account that triggered it.
      return "error";
  }
}

/**
 * Every notice `/manage` may render. Notices arrive through a URL query
 * parameter, so they are resolved against this allowlist and never echoed back
 * verbatim: an unexpected value renders nothing at all.
 */
export const MANAGE_NOTICES = {
  created: { tone: "ok", message: "Draft created. It is not published yet." },
  updated: { tone: "ok", message: "Product details saved." },
  published: { tone: "ok", message: "Product published. It is now in the public catalog." },
  unpublished: { tone: "ok", message: "Product unpublished. The public catalog no longer lists it." },
  deleted: { tone: "ok", message: "Product deleted." },
  "in-use": {
    tone: "problem",
    message: "This product is referenced by orders, downloads, or carts, so it cannot be deleted. Unpublish it instead.",
  },
  "not-found": { tone: "problem", message: "That product no longer exists. It may have been deleted." },
  "invalid-input": { tone: "problem", message: "Check the highlighted fields and try again." },
  "invalid-title": {
    tone: "problem",
    message: "The title was missing or too short, so nothing was saved.",
  },
  "invalid-price": {
    tone: "problem",
    message: "The price must be a non-negative amount with at most two decimal places.",
  },
  "invalid-version": {
    tone: "problem",
    message: "The version was missing or malformed, so nothing was saved.",
  },
  "invalid-category": {
    tone: "problem",
    message: "That category does not exist, so nothing was saved.",
  },
  "invalid-slug": {
    tone: "problem",
    message: "The slug must be 2-80 lowercase letters, numbers, and single hyphens.",
  },
  "invalid-description": {
    tone: "problem",
    message: "The description was too short or too long, so nothing was saved.",
  },
  "slug-taken": {
    tone: "problem",
    message: "That slug is already used by another product. Choose a different one.",
  },
  denied: { tone: "problem", message: describeStaffFailure("FORBIDDEN") },
  error: { tone: "problem", message: "The change could not be saved. Nothing was written." },
  "signed-out": { tone: "problem", message: describeStaffFailure("UNAUTHENTICATED") },
  unavailable: { tone: "problem", message: describeStaffFailure("UNAVAILABLE") },
  "staff-granted": { tone: "ok", message: "Staff access granted." },
  "staff-granted-no-sign-in": {
    tone: "problem",
    message: "Staff access granted, but that account has no password, so it cannot sign in yet.",
  },
  "staff-revoked": { tone: "ok", message: "Staff access revoked." },
  "unknown-account": { tone: "problem", message: describeStaffFailure("NOT_FOUND") },
  "last-owner": { tone: "problem", message: describeStaffFailure("LAST_OWNER") },
} as const;

export type ManageNoticeCode = keyof typeof MANAGE_NOTICES;

export interface ManageNotice {
  tone: "ok" | "problem";
  message: string;
}

function firstSearchParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Resolves `?notice=` to a curated message, or `null` for anything unknown. */
export function resolveManageNotice(
  params: Record<string, string | string[] | undefined>,
): ManageNotice | null {
  const requested = firstSearchParam(params.notice);
  if (!requested) return null;

  const notice = (MANAGE_NOTICES as Record<string, ManageNotice | undefined>)[requested];
  return notice ?? null;
}

/**
 * Guards a membership change. Both `grantMembership` and `revokeMembership` run
 * this before writing, so the "at least one owner must remain" rule cannot be
 * bypassed by a second code path (or by a race between two tabs).
 *
 * `ownerCount` is the number of owners **before** the change.
 */
export interface MembershipChangeGuardInput {
  actor: StaffAccess | null | undefined;
  /** Role on the existing membership row, or null when creating one. */
  currentRole: StaffRole | null;
  /** Role being written, or null when the membership is being revoked. */
  requestedRole: StaffRole | null;
  ownerCount: number;
  /**
   * True only for the confirmed bootstrap command, which has no actor because no
   * owner exists yet. Every other caller must hold `staff:manage`.
   */
  bootstrap?: boolean;
}

export type MembershipChangeDecision =
  | { ok: true }
  | { ok: false; code: Extract<StaffFailureCode, "FORBIDDEN" | "LAST_OWNER"> };

export function evaluateMembershipChange(
  input: MembershipChangeGuardInput,
): MembershipChangeDecision {
  if (!input.bootstrap && !canManageStaffAccess(input.actor)) {
    return { ok: false, code: "FORBIDDEN" };
  }

  const losesOwner =
    input.currentRole === "owner" && input.requestedRole !== "owner";
  if (losesOwner && input.ownerCount <= 1) return { ok: false, code: "LAST_OWNER" };

  return { ok: true };
}

/* Bootstrap configuration
   ------------------------------------------------------------------ */

/**
 * The email addresses the one-time bootstrap command may promote to `OWNER`.
 * It is read by `prisma/grant-owner.ts` **only** — never during a request — so
 * setting or clearing it can never change what an existing sign-in can do, and
 * nothing is promoted automatically.
 */
export const BOOTSTRAP_OWNER_EMAILS_ENV_VAR = "MARKETPLACE_OWNER_EMAILS";

/** A deployment is small; a larger list would hide a mistake in the value. */
export const MAX_BOOTSTRAP_OWNER_EMAILS = 10;

/** Control characters and ANSI escapes must never reach the operator's terminal. */
const UNSAFE_TOKEN_CHARACTERS = /[\u0000-\u001f\u007f\u200b-\u200d\ufeff]|\u001b\[[0-9;]*m/g;

function sanitizeRejectionToken(value: string): string {
  return value.replace(UNSAFE_TOKEN_CHARACTERS, "").slice(0, 80);
}

export interface BootstrapOwnerEmails {
  /** Normalized, validated, deduplicated addresses to promote. */
  emails: string[];
  /** Entries that were rejected, sanitized for terminal output. */
  rejected: string[];
  /** True when more addresses were listed than the cap allows. */
  truncated: boolean;
}

/**
 * Parses `MARKETPLACE_OWNER_EMAILS` (or repeated `--email` flags). Accepts
 * commas, semicolons, and whitespace as separators, lowercases and validates
 * every address with the same rules registration uses, and reports — rather than
 * silently dropping — anything unusable.
 */
export function parseBootstrapOwnerEmails(value: unknown): BootstrapOwnerEmails {
  const raw = typeof value === "string" ? value : "";
  const tokens = raw
    .split(/[,;\s]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

  const emails: string[] = [];
  const rejected: string[] = [];
  const seen = new Set<string>();

  for (const token of tokens) {
    const email = normalizeEmail(token);
    if (!isValidEmailAddress(email) || email.length > 254) {
      rejected.push(sanitizeRejectionToken(token));
      continue;
    }

    if (seen.has(email)) continue;
    seen.add(email);
    emails.push(email);
  }

  const truncated = emails.length > MAX_BOOTSTRAP_OWNER_EMAILS;

  return { emails: emails.slice(0, MAX_BOOTSTRAP_OWNER_EMAILS), rejected, truncated };
}

/** Configuration a deployment reads when it runs the bootstrap command. */
export function resolveBootstrapOwnerEmails(
  env: NodeJS.ProcessEnv = process.env,
): BootstrapOwnerEmails {
  return parseBootstrapOwnerEmails(env[BOOTSTRAP_OWNER_EMAILS_ENV_VAR]);
}

/**
 * Reads a role out of a form, defaulting to the *least* privileged value. This
 * is the only place a role can be defaulted, and the default is `staff`, never
 * `owner`.
 */
export function parseGrantableStaffRole(value: unknown): StaffRole {
  const parsed = parseStaffRoleInput(value);
  return parsed === "owner" ? "owner" : "staff";
}

/** True when a *human* wrote one of the two role names (CLI flag, owner's form). */
export function isStaffRoleName(value: unknown): value is StaffRole {
  return isStaffRole(typeof value === "string" ? value.trim().toLowerCase() : value);
}

/** Display label for a role, with a safe fallback for unknown values. */
export function staffRoleLabel(role: unknown): string {
  return isStaffRole(role) ? STAFF_ROLE_LABELS[role] : "Unauthorized";
}

/* Owner bootstrap confirmation
   ------------------------------------------------------------------ */

/**
 * The literal `bootstrapOwnerAccess` requires. It is not a secret — the value is
 * public — but it is a *structural* requirement: a route or a Server Function
 * cannot forward it without importing this constant, and
 * `tests/staff-authorization.test.mjs` asserts that the bootstrap CLI is the only
 * module that does. Combined with "promote exactly the address you were handed",
 * that is what keeps the initial owner an operator decision instead of an
 * accident, and it is why the first registered user is never silently promoted.
 */
export const OWNER_BOOTSTRAP_CONFIRMATION = "explicit-owner-bootstrap";

export type OwnerBootstrapConfirmation = typeof OWNER_BOOTSTRAP_CONFIRMATION;

