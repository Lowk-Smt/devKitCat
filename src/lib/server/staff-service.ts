import "server-only";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { isValidEmailAddress, normalizeEmail } from "./auth-core";
import {
  createStaffAccess,
  evaluateMembershipChange,
  hasStaffPrivilege,
  isStaffRoleName,
  OWNER_BOOTSTRAP_CONFIRMATION,
  STAFF_ROLE_COLUMN,
  STAFF_ROLE_FROM_COLUMN,
  type OwnerBootstrapConfirmation,
  type StaffAccess,
  type StaffFailureCode,
  type StaffPrivilege,
  type StaffResult,
  type StaffRole,
} from "./staff-core";

/**
 * Database-backed staff authorization: reading a customer's grant, and granting
 * or revoking grants.
 *
 * This module is the only writer of `StaffMembership`, and it is built the way
 * `createCustomerAuthService` and `createCartService` are — an injected Prisma
 * client provider plus a logger — so a deployment without `DATABASE_URL` reports
 * `UNAVAILABLE` instead of falling back to fixtures. With no verified session
 * there is nothing an access decision could be based on, and defaulting to
 * "authorized" would be the one mistake that matters.
 *
 * What makes self-promotion impossible rather than merely hidden:
 *
 * * every mutation re-asks `hasStaffPrivilege` about the actor, and the only
 *   producer of an `StaffAccess` value is `getAccessForCustomer()`, keyed by the
 *   session's own customer id;
 * * a grant is addressed by **email** and resolved to a `Customer` row on the
 *   server, so a request never supplies a customer id, a privilege list, or a
 *   role-shaped object;
 * * an unrecognized role value fails closed (`createStaffAccess` returns null),
 *   so neither a corrupted row nor a future enum member implies access.
 *
 * Concurrency safety (why SERIALIZABLE):
 *
 * The invariant is “at least one OWNER must remain”. Without protection, two
 * concurrent revocations (or demotions) can each read ownerCount=2, both decide
 * “losing one owner is safe”, and both delete, leaving 0.
 *
 * All owner-changing mutations (grant OWNER, demote OWNER→STAFF, revoke OWNER,
 * bootstrap OWNER) therefore run inside a PostgreSQL SERIALIZABLE transaction.
 * Under SERIALIZABLE, the database detects the read-write dependency between the
 * two concurrent “count owners” reads and the subsequent writes and aborts one
 * transaction with a serialization failure (PostgreSQL 40001 / Prisma P2034).
 * The aborted transaction is retried (up to 3 attempts) and then sees the
 * updated count (1) and correctly returns LAST_OWNER. If the transaction would
 * still violate the invariant after retry, it fails closed rather than writing.
 *
 * SERIALIZABLE is preferred over ad-hoc row locking because it protects the
 * predicate (“how many owners exist?”) rather than a single row — the race is
 * on the count, not on one membership row — and it composes correctly with the
 * existing upsert/deleteMany patterns without requiring manual SELECT … FOR
 * UPDATE or advisory locks. The retry is bounded and invisible to callers: a
 * LAST_OWNER or other business failure is returned, a serialization failure
 * after retries becomes a generic ERROR with a safe code.
 */

/** The projection a decision needs. Identity columns only, and no credentials. */
const MEMBERSHIP_SELECT = {
  customerId: true,
  role: true,
  createdAt: true,
  grantedByCustomerId: true,
} satisfies Prisma.StaffMembershipSelect;

/** Directory projection: the membership plus the identity the owner must recognize. */
const MEMBERSHIP_DIRECTORY_SELECT = {
  customerId: true,
  role: true,
  createdAt: true,
  grantedByCustomerId: true,
  customer: { select: { email: true, name: true } },
} satisfies Prisma.StaffMembershipSelect;

/**
 * Only used to answer "does this account exist, and can it sign in?" — the
 * digest is read as a presence check and is never returned, logged, or copied
 * into a view.
 */
const GRANT_TARGET_SELECT = {
  id: true,
  email: true,
  name: true,
  passwordHash: true,
} satisfies Prisma.CustomerSelect;

type MembershipRow = Prisma.StaffMembershipGetPayload<{
  select: typeof MEMBERSHIP_SELECT;
}>;
type DirectoryRow = Prisma.StaffMembershipGetPayload<{
  select: typeof MEMBERSHIP_DIRECTORY_SELECT;
}>;
type GrantTargetRow = Prisma.CustomerGetPayload<{ select: typeof GRANT_TARGET_SELECT }>;
type TransactionClient = Prisma.TransactionClient;

/** One staff account, as the owner-facing directory renders it. */
export interface StaffMembershipView {
  customerId: string;
  email: string;
  name: string;
  role: StaffRole;
  grantedAt: Date;
  /** True when the grant was issued by the bootstrap command instead of an owner. */
  bootstrapped: boolean;
}

export interface GrantMembershipInput {
  email: unknown;
  role: StaffRole;
}

export interface GrantMembershipOutcome extends StaffMembershipView {
  /** True when the account already held exactly this role, so nothing changed. */
  alreadyGranted: boolean;
  /** False for the seeded fixture account, which has no password to sign in with. */
  canSignIn: boolean;
}

export interface BootstrapAccountSummary {
  customerId: string;
  email: string;
  name: string;
  /** False for a fixture customer with no `passwordHash`: it cannot sign in. */
  canSignIn: boolean;
  /** The role the account holds today, or null when it is an ordinary customer. */
  currentRole: StaffRole | null;
}

export interface StaffAccessService {
  /** False when no PostgreSQL database is configured for this deployment. */
  isAvailable(): boolean;
  /** The session customer's verified access, or `null` for an ordinary customer. */
  getAccessForCustomer(customerId: string): Promise<StaffResult<StaffAccess | null>>;
  /** Owner-only directory of every staff grant, for auditing and revocation. */
  listMemberships(actor: StaffAccess | null): Promise<StaffResult<StaffMembershipView[]>>;
  /** Owner-only: grant or change a role, addressed by email. */
  grantMembership(
    actor: StaffAccess | null,
    input: GrantMembershipInput,
  ): Promise<StaffResult<GrantMembershipOutcome>>;
  /** Owner-only: remove a grant, addressed by email. */
  revokeMembership(
    actor: StaffAccess | null,
    email: unknown,
  ): Promise<StaffResult<{ revoked: boolean }>>;
  /** Read-only account summary for the bootstrap command's dry run. */
  describeBootstrapAccount(
    email: unknown,
  ): Promise<StaffResult<BootstrapAccountSummary | null>>;
  /**
   * Writes an `OWNER` membership with no grantor, for the one-time bootstrap.
   *
   * The confirmation literal is a structural guard, not a secret: what makes
   * this safe is that only `prisma/grant-owner.ts` may pass it (asserted by
   * test), that it is never reachable from a route or a Server Function, and
   * that it promotes exactly the address it was handed — never "the first user".
   */
  bootstrapOwnerAccess(input: {
    email: unknown;
    confirmation: OwnerBootstrapConfirmation;
  }): Promise<StaffResult<GrantMembershipOutcome>>;
}

export type StaffLogger = (resource: string, code: string) => void;

/** Prisma's missing-row code drives the "no such account" answer. */
const RECORD_NOT_FOUND_CODE = "P2025";

/** Cuid or seeded id shape — the same rule the cart applies to identifiers. */
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

function getSafeErrorCode(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    /^[A-Z0-9_]{2,16}$/.test(error.code)
  ) {
    return error.code;
  }

  return "UNKNOWN";
}

function failure(code: StaffFailureCode): { ok: false; code: StaffFailureCode } {
  return { ok: false, code };
}

function isUsableId(value: unknown): value is string {
  return typeof value === "string" && ID_PATTERN.test(value);
}

function roleFromColumn(role: string | null | undefined): StaffRole | null {
  if (typeof role !== "string") return null;
  return STAFF_ROLE_FROM_COLUMN[role] ?? null;
}

/**
 * Normalizes the address a grant or revoke form was submitted with, using the
 * exact validator registration uses. Anything that is not a well-formed address
 * is rejected before it can reach a query, so a form value cannot become a
 * lookup for an arbitrary record.
 */
function normalizeGrantEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const email = normalizeEmail(value);
  return isValidEmailAddress(email) ? email : null;
}

function mapDirectoryRow(row: DirectoryRow): StaffMembershipView | null {
  const role = roleFromColumn(row.role);
  // An unknown stored role is left out of the directory rather than promoted to
  // a privilege: the account simply cannot act until a migration fixes the row.
  if (!role) return null;

  return {
    customerId: row.customerId,
    email: row.customer.email,
    name: row.customer.name,
    role,
    grantedAt: row.createdAt,
    bootstrapped: row.grantedByCustomerId === null,
  };
}

// ---------------------------------------------------------------------------
// Concurrency helpers: SERIALIZABLE + retry
// ---------------------------------------------------------------------------

/** Prisma P2034 or PostgreSQL 40001/40P01 indicate a serialization/deadlock that is safe to retry. */
const SERIALIZATION_FAILURE_CODES = new Set(["P2034", "40001", "40P01"]);
const SERIALIZABLE_MAX_RETRIES = 3;

function isSerializationFailure(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code =
    "code" in error && typeof (error as { code?: unknown }).code === "string"
      ? (error as { code: string }).code
      : null;
  if (code && SERIALIZATION_FAILURE_CODES.has(code)) return true;
  const message =
    "message" in error && typeof (error as { message?: unknown }).message === "string"
      ? (error as { message: string }).message
      : "";
  // Fallback: some drivers surface the SQLSTATE in the message.
  return /40001|40P01|P2034|serialization failure|deadlock|could not serialize/i.test(message);
}

async function withSerializableRetry<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < SERIALIZABLE_MAX_RETRIES; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (isSerializationFailure(error) && attempt < SERIALIZABLE_MAX_RETRIES - 1) {
        // Small backoff to reduce contention; bounded and deterministic for tests.
        await new Promise((resolve) => setTimeout(resolve, 10 * (attempt + 1)));
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

/**
 * Builds the staff-authorization service around a Prisma client provider.
 *
 * `logger` receives a resource name and a safe Prisma error code only — never an
 * email, a customer id, or any stored value.
 */
export function createStaffAccessService(
  getClient: () => PrismaClient | null,
  logger: StaffLogger = (resource, code) => {
    console.error(`[devKitCat staff access] ${resource} failed (${code}).`);
  },
): StaffAccessService {
  function resolveClient(): PrismaClient | null {
    try {
      return getClient();
    } catch {
      logger("database configuration", "INVALID_DATABASE_URL");
      return null;
    }
  }

  function isAvailable(): boolean {
    return resolveClient() !== null;
  }

  /**
   * The choke point for privileged work: resolve a client, then re-ask the
   * policy whether this actor may do this. A caller that skipped its own check
   * still gets a refusal, because `actor` is the only thing this reads and it
   * always comes from the session.
   */
  function authorize(
    actor: StaffAccess | null,
    privilege: StaffPrivilege,
  ): { client: PrismaClient } | { ok: false; code: StaffFailureCode } {
    const client = resolveClient();
    if (!client) return failure("UNAVAILABLE");
    if (!actor || !isUsableId(actor.customerId)) return failure("UNAUTHENTICATED");
    if (!hasStaffPrivilege(actor, privilege)) return failure("FORBIDDEN");

    return { client };
  }

  function findGrantTarget(client: TransactionClient, email: string) {
    return client.customer.findUnique({
      where: { email },
      select: GRANT_TARGET_SELECT,
    });
  }

  function countOwners(client: TransactionClient): Promise<number> {
    return client.staffMembership.count({ where: { role: STAFF_ROLE_COLUMN.owner } });
  }

  async function getAccessForCustomer(
    customerId: string,
  ): Promise<StaffResult<StaffAccess | null>> {
    const client = resolveClient();
    if (!client) return failure("UNAVAILABLE");
    if (!isUsableId(customerId)) return failure("UNAUTHENTICATED");

    try {
      // Keyed by the session's own customer id: there is no other way in.
      const row: MembershipRow | null = await client.staffMembership.findUnique({
        where: { customerId },
        select: MEMBERSHIP_SELECT,
      });
      if (!row) return { ok: true, value: null };

      // `createStaffAccess` re-verifies the role and refuses to invent one, so an
      // unexpected value yields `null` (an ordinary customer) instead of access.
      return {
        ok: true,
        value: createStaffAccess({
          customerId,
          role: row.role,
          grantedAt: row.createdAt,
        }),
      };
    } catch (error) {
      logger("staff access lookup", getSafeErrorCode(error));
      return failure("ERROR");
    }
  }

  async function listMemberships(
    actor: StaffAccess | null,
  ): Promise<StaffResult<StaffMembershipView[]>> {
    const gate = authorize(actor, "staff:manage");
    if ("ok" in gate) return failure(gate.code);

    try {
      const rows = await gate.client.staffMembership.findMany({
        select: MEMBERSHIP_DIRECTORY_SELECT,
        orderBy: [{ role: "asc" }, { createdAt: "asc" }, { customerId: "asc" }],
      });

      return {
        ok: true,
        value: rows
          .map(mapDirectoryRow)
          .filter((row): row is StaffMembershipView => row !== null),
      };
    } catch (error) {
      logger("staff directory read", getSafeErrorCode(error));
      return failure("ERROR");
    }
  }

  /**
   * Grant or replace a membership inside one SERIALIZABLE transaction, so the
   * owner count that the last-owner guard read is the count it acted on.
   *
   * With SERIALIZABLE, two concurrent transactions that each read ownerCount=2
   * and then try to demote a different owner are detected as a serialization
   * anomaly: PostgreSQL aborts one with 40001 (Prisma surfaces as P2034). The
   * retry re-reads the count (now 1) and correctly returns LAST_OWNER, so the
   * system never reaches zero owners. The retry is bounded (3 attempts) and
   * does not leak the serialization code to callers — a persistent conflict
   * becomes a generic ERROR.
   *
   * `actor` is null only for the bootstrap path, which is separately gated on the
   * confirmation literal and records no grantor.
   */
  async function writeMembership(
    client: PrismaClient,
    input: {
      actor: StaffAccess | null;
      email: string;
      role: StaffRole;
      /** Only the confirmed bootstrap command sets this; see `staff-core.ts`. */
      bootstrap?: boolean;
    },
  ): Promise<StaffResult<GrantMembershipOutcome>> {
    const grantedByCustomerId = input.actor ? input.actor.customerId : null;

    try {
      return await withSerializableRetry(() =>
        // Prisma 7 supports { isolationLevel: 'Serializable' }; the in-memory
        // test stub ignores the options object, which keeps the test suite
        // runnable without a real database while the production path gets the
        // stronger guarantee.
        (client.$transaction as (fn: (tx: TransactionClient) => Promise<StaffResult<GrantMembershipOutcome>>, opts?: unknown) => Promise<StaffResult<GrantMembershipOutcome>>)(
          async (tx) => {
            const customer: GrantTargetRow | null = await findGrantTarget(tx, input.email);
            if (!customer) return failure("NOT_FOUND");

            const existing = await tx.staffMembership.findUnique({
              where: { customerId: customer.id },
              select: MEMBERSHIP_SELECT,
            });
            const currentRole = existing ? roleFromColumn(existing.role) : null;

            const decision = evaluateMembershipChange({
              actor: input.actor,
              currentRole,
              requestedRole: input.role,
              ownerCount: await countOwners(tx),
              bootstrap: input.bootstrap === true,
            });
            if (!decision.ok) return failure(decision.code);

            if (currentRole === input.role) {
              // Idempotent: a repeated grant leaves the audit row and timestamps as
              // they are and reports that nothing changed.
              return {
                ok: true as const,
                value: {
                  customerId: customer.id,
                  email: customer.email,
                  name: customer.name,
                  role: input.role,
                  grantedAt: existing!.createdAt,
                  bootstrapped: existing!.grantedByCustomerId === null,
                  alreadyGranted: true,
                  canSignIn: typeof customer.passwordHash === "string",
                },
              };
            }

            // `customerId` is unique, so this replaces the role instead of stacking a
            // second, contradicting grant on the same account.
            const saved = await tx.staffMembership.upsert({
              where: { customerId: customer.id },
              create: {
                customerId: customer.id,
                role: STAFF_ROLE_COLUMN[input.role],
                grantedByCustomerId,
              },
              update: {
                role: STAFF_ROLE_COLUMN[input.role],
                grantedByCustomerId,
              },
              select: MEMBERSHIP_SELECT,
            });

            return {
              ok: true as const,
              value: {
                customerId: customer.id,
                email: customer.email,
                name: customer.name,
                role: input.role,
                grantedAt: saved.createdAt,
                bootstrapped: grantedByCustomerId === null,
                alreadyGranted: false,
                canSignIn: typeof customer.passwordHash === "string",
              },
            };
          },
          { isolationLevel: "Serializable" },
        ),
      );
    } catch (error) {
      if (isSerializationFailure(error)) {
        logger("staff grant write", getSafeErrorCode(error));
        return failure("ERROR");
      }
      logger("staff grant write", getSafeErrorCode(error));
      return failure("ERROR");
    }
  }

  async function grantMembership(
    actor: StaffAccess | null,
    input: GrantMembershipInput,
  ): Promise<StaffResult<GrantMembershipOutcome>> {
    const gate = authorize(actor, "staff:manage");
    if ("ok" in gate) return failure(gate.code);

    const email = normalizeGrantEmail(input.email);
    if (!email) return failure("INVALID_INPUT");
    if (!isStaffRoleName(input.role)) return failure("INVALID_INPUT");

    return writeMembership(gate.client, { actor, email, role: input.role });
  }

  async function revokeMembership(
    actor: StaffAccess | null,
    email: unknown,
  ): Promise<StaffResult<{ revoked: boolean }>> {
    const gate = authorize(actor, "staff:manage");
    if ("ok" in gate) return failure(gate.code);

    const requested = normalizeGrantEmail(email);
    if (!requested) return failure("INVALID_INPUT");

    try {
      return await withSerializableRetry(() =>
        (gate.client.$transaction as (fn: (tx: TransactionClient) => Promise<StaffResult<{ revoked: boolean }>>, opts?: unknown) => Promise<StaffResult<{ revoked: boolean }>>)(
          async (tx) => {
            const customer = await findGrantTarget(tx, requested);
            if (!customer) return failure("NOT_FOUND");

            const existing = await tx.staffMembership.findUnique({
              where: { customerId: customer.id },
              select: MEMBERSHIP_SELECT,
            });
            if (!existing) return failure("NOT_FOUND");

            const decision = evaluateMembershipChange({
              actor,
              currentRole: roleFromColumn(existing.role),
              requestedRole: null,
              ownerCount: await countOwners(tx),
            });
            if (!decision.ok) return failure(decision.code);

            // The delete key repeats the `customerId` that was just verified, so the
            // row this checked is the row that goes away. The count check and the
            // delete are in the same SERIALIZABLE transaction, so two concurrent
            // revocations cannot both see ownerCount=2 and both delete — one
            // transaction is aborted with a serialization failure and, on retry,
            // sees count=1 and returns LAST_OWNER.
            const deleted = await tx.staffMembership.deleteMany({
              where: { customerId: customer.id },
            });

            return { ok: true, value: { revoked: deleted.count > 0 } };
          },
          { isolationLevel: "Serializable" },
        ),
      );
    } catch (error) {
      const code = getSafeErrorCode(error);
      if (code === RECORD_NOT_FOUND_CODE) return failure("NOT_FOUND");
      if (isSerializationFailure(error)) {
        logger("staff revoke write", code);
        return failure("ERROR");
      }

      logger("staff revoke write", code);
      return failure("ERROR");
    }
  }

  async function describeBootstrapAccount(
    email: unknown,
  ): Promise<StaffResult<BootstrapAccountSummary | null>> {
    const client = resolveClient();
    if (!client) return failure("UNAVAILABLE");

    const requested = normalizeGrantEmail(email);
    if (!requested) return failure("INVALID_INPUT");

    try {
      const customer = await findGrantTarget(client, requested);
      if (!customer) return { ok: true, value: null };

      const membership = await client.staffMembership.findUnique({
        where: { customerId: customer.id },
        select: MEMBERSHIP_SELECT,
      });

      return {
        ok: true,
        value: {
          customerId: customer.id,
          email: customer.email,
          name: customer.name,
          canSignIn: typeof customer.passwordHash === "string",
          currentRole: membership ? roleFromColumn(membership.role) : null,
        },
      };
    } catch (error) {
      logger("bootstrap account lookup", getSafeErrorCode(error));
      return failure("ERROR");
    }
  }

  async function bootstrapOwnerAccess(input: {
    email: unknown;
    confirmation: OwnerBootstrapConfirmation;
  }): Promise<StaffResult<GrantMembershipOutcome>> {
    // Checked again at runtime: the literal type is compile-time help, and this is
    // what refuses a value that arrived from somewhere else.
    if (input.confirmation !== OWNER_BOOTSTRAP_CONFIRMATION) return failure("FORBIDDEN");

    const client = resolveClient();
    if (!client) return failure("UNAVAILABLE");

    const email = normalizeGrantEmail(input.email);
    if (!email) return failure("INVALID_INPUT");

    return writeMembership(client, {
      actor: null,
      email,
      role: "owner",
      bootstrap: true,
    });
  }

  return {
    isAvailable,
    getAccessForCustomer,
    listMemberships,
    grantMembership,
    revokeMembership,
    describeBootstrapAccount,
    bootstrapOwnerAccess,
  };
}
