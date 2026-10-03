import "server-only";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { CustomerRecord, ThemePreference } from "@/types/account";
import {
  generateSessionToken,
  hashPassword,
  hashSessionToken,
  normalizeEmail,
  resolveAuthConfig,
  runPasswordVerificationDecoy,
  sessionExpiresAt,
  verifyPassword,
  type AuthConfig,
  type ValidatedProfile,
  type ValidatedRegistration,
} from "./auth-core";

/**
 * Database-backed customer authentication: registration, credential checks,
 * opaque session records, and self-service profile updates.
 *
 * Every read and write is keyed by the customer that owns it. This module is
 * the only place that sees a password digest or a session token hash, and it
 * returns `CustomerRecord` values that contain neither.
 */

/** Safe customer projection; the password digest is never selected here. */
export const CUSTOMER_SELECT = {
  id: true,
  email: true,
  name: true,
  themePreference: true,
  productUpdates: true,
  releaseNotes: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.CustomerSelect;

/** Adds the digest for the single credential check; never leaves this module. */
const CREDENTIAL_SELECT = {
  ...CUSTOMER_SELECT,
  passwordHash: true,
} satisfies Prisma.CustomerSelect;

const SESSION_SELECT = {
  id: true,
  expiresAt: true,
  customer: { select: CUSTOMER_SELECT },
} satisfies Prisma.SessionSelect;

type CustomerRow = Prisma.CustomerGetPayload<{ select: typeof CUSTOMER_SELECT }>;
type CredentialRow = Prisma.CustomerGetPayload<{ select: typeof CREDENTIAL_SELECT }>;
type SessionRow = Prisma.SessionGetPayload<{ select: typeof SESSION_SELECT }>;

export type AuthFailureCode =
  /** `DATABASE_URL` is not configured, so no customer can be authenticated. */
  | "UNAVAILABLE"
  | "INVALID_CREDENTIALS"
  | "INVALID_SESSION"
  | "EMAIL_TAKEN"
  | "NOT_FOUND"
  | "ERROR";

export type AuthResult<TValue> =
  | { ok: true; value: TValue }
  | { ok: false; code: AuthFailureCode };

export interface AuthenticatedSession {
  sessionId: string;
  customer: CustomerRecord;
  expiresAt: Date;
}

export interface IssuedSession {
  /** Raw token for the HttpOnly cookie; only its hash is persisted. */
  token: string;
  expiresAt: Date;
}

export interface CustomerAuthService {
  /** False when no PostgreSQL database is configured for this deployment. */
  isAvailable(): boolean;
  registerCustomer(input: ValidatedRegistration): Promise<AuthResult<CustomerRecord>>;
  verifyCredentials(input: {
    email: string;
    password: string;
  }): Promise<AuthResult<CustomerRecord>>;
  createSession(
    customerId: string,
    options?: { rememberMe?: boolean; now?: Date },
  ): Promise<AuthResult<IssuedSession>>;
  readSession(
    token: string,
    options?: { now?: Date },
  ): Promise<AuthResult<AuthenticatedSession>>;
  destroySession(token: string): Promise<AuthResult<{ destroyed: boolean }>>;
  updateProfile(
    customerId: string,
    input: ValidatedProfile,
  ): Promise<AuthResult<CustomerRecord>>;
}

export type AuthLogger = (resource: string, code: string) => void;

const THEME_PREFERENCE_MAP: Record<CustomerRow["themePreference"], ThemePreference> = {
  DARK: "dark",
  SYSTEM: "system",
};

const THEME_PREFERENCE_COLUMN: Record<ThemePreference, CustomerRow["themePreference"]> = {
  dark: "DARK",
  system: "SYSTEM",
};

/** Prisma's unique-constraint and missing-row codes drive the user-facing errors. */
const UNIQUE_VIOLATION_CODE = "P2002";
const RECORD_NOT_FOUND_CODE = "P2025";

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

/** Maps a database row to the credential-free customer view used by the UI. */
export function mapCustomerRecord(row: CustomerRow): CustomerRecord {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    preferences: {
      theme: THEME_PREFERENCE_MAP[row.themePreference],
      productUpdates: row.productUpdates,
      releaseNotes: row.releaseNotes,
    },
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Builds the authentication service around a Prisma client provider. Passing a
 * provider that returns `null` (no `DATABASE_URL`) makes every operation report
 * `UNAVAILABLE` instead of falling back to demo fixtures: account data has no
 * offline preview, because serving it without a verified identity would be an
 * access-control hole.
 */
export function createCustomerAuthService(
  getClient: () => PrismaClient | null,
  getConfig: () => AuthConfig = resolveAuthConfig,
  logger: AuthLogger = (resource, code) => {
    console.error(`[devKitCat auth] ${resource} failed (${code}).`);
  },
): CustomerAuthService {
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

  async function registerCustomer(
    input: ValidatedRegistration,
  ): Promise<AuthResult<CustomerRecord>> {
    const client = resolveClient();
    if (!client) return { ok: false, code: "UNAVAILABLE" };

    try {
      // The email is normalized once here so storage and lookups always agree.
      const passwordHash = await hashPassword(input.password);
      const row = await client.customer.create({
        data: {
          email: normalizeEmail(input.email),
          name: input.name,
          passwordHash,
        },
        select: CUSTOMER_SELECT,
      });

      return { ok: true, value: mapCustomerRecord(row) };
    } catch (error) {
      const code = getSafeErrorCode(error);
      if (code === UNIQUE_VIOLATION_CODE) return { ok: false, code: "EMAIL_TAKEN" };

      logger("registration", code);
      return { ok: false, code: "ERROR" };
    }
  }

  async function verifyCredentials(input: {
    email: string;
    password: string;
  }): Promise<AuthResult<CustomerRecord>> {
    const client = resolveClient();
    if (!client) return { ok: false, code: "UNAVAILABLE" };

    try {
      const row: CredentialRow | null = await client.customer.findUnique({
        where: { email: normalizeEmail(input.email) },
        select: CREDENTIAL_SELECT,
      });

      if (!row || row.passwordHash === null) {
        // Spend the same work as a real check so responses stay even-paced.
        await runPasswordVerificationDecoy(input.password);
        return { ok: false, code: "INVALID_CREDENTIALS" };
      }

      const passwordMatches = await verifyPassword(input.password, row.passwordHash);
      if (!passwordMatches) return { ok: false, code: "INVALID_CREDENTIALS" };

      return { ok: true, value: mapCustomerRecord(row) };
    } catch (error) {
      logger("sign-in", getSafeErrorCode(error));
      return { ok: false, code: "ERROR" };
    }
  }

  async function createSession(
    customerId: string,
    options: { rememberMe?: boolean; now?: Date } = {},
  ): Promise<AuthResult<IssuedSession>> {
    const client = resolveClient();
    if (!client) return { ok: false, code: "UNAVAILABLE" };

    const now = options.now ?? new Date();
    const expiresAt = sessionExpiresAt(now, options.rememberMe === true, getConfig());
    const token = generateSessionToken();

    try {
      await client.session.create({
        data: { tokenHash: hashSessionToken(token), customerId, expiresAt },
        select: { id: true },
      });

      // Housekeeping only: an expired-session cleanup failure must not sign out
      // or block the customer who just authenticated.
      await client.session
        .deleteMany({ where: { expiresAt: { lt: now } } })
        .catch(() => undefined);

      return { ok: true, value: { token, expiresAt } };
    } catch (error) {
      logger("session creation", getSafeErrorCode(error));
      return { ok: false, code: "ERROR" };
    }
  }

  async function readSession(
    token: string,
    options: { now?: Date } = {},
  ): Promise<AuthResult<AuthenticatedSession>> {
    const client = resolveClient();
    if (!client) return { ok: false, code: "UNAVAILABLE" };

    try {
      const row: SessionRow | null = await client.session.findUnique({
        where: { tokenHash: hashSessionToken(token) },
        select: SESSION_SELECT,
      });
      if (!row) return { ok: false, code: "INVALID_SESSION" };

      const now = options.now ?? new Date();
      if (row.expiresAt.getTime() <= now.getTime()) {
        await client.session.delete({ where: { id: row.id } }).catch(() => undefined);
        return { ok: false, code: "INVALID_SESSION" };
      }

      return {
        ok: true,
        value: {
          sessionId: row.id,
          customer: mapCustomerRecord(row.customer),
          expiresAt: row.expiresAt,
        },
      };
    } catch (error) {
      logger("session lookup", getSafeErrorCode(error));
      return { ok: false, code: "ERROR" };
    }
  }

  async function destroySession(token: string): Promise<AuthResult<{ destroyed: boolean }>> {
    const client = resolveClient();
    if (!client) return { ok: false, code: "UNAVAILABLE" };

    try {
      const result = await client.session.deleteMany({
        where: { tokenHash: hashSessionToken(token) },
      });
      return { ok: true, value: { destroyed: result.count > 0 } };
    } catch (error) {
      logger("session revocation", getSafeErrorCode(error));
      return { ok: false, code: "ERROR" };
    }
  }

  async function updateProfile(
    customerId: string,
    input: ValidatedProfile,
  ): Promise<AuthResult<CustomerRecord>> {
    const client = resolveClient();
    if (!client) return { ok: false, code: "UNAVAILABLE" };

    try {
      const row = await client.customer.update({
        // The ID always comes from the verified session, never from the form.
        where: { id: customerId },
        data: {
          name: input.name,
          themePreference: THEME_PREFERENCE_COLUMN[input.theme],
          productUpdates: input.productUpdates,
          releaseNotes: input.releaseNotes,
        },
        select: CUSTOMER_SELECT,
      });

      return { ok: true, value: mapCustomerRecord(row) };
    } catch (error) {
      const code = getSafeErrorCode(error);
      if (code === RECORD_NOT_FOUND_CODE) return { ok: false, code: "NOT_FOUND" };

      logger("profile update", code);
      return { ok: false, code: "ERROR" };
    }
  }

  return {
    isAvailable,
    registerCustomer,
    verifyCredentials,
    createSession,
    readSession,
    destroySession,
    updateProfile,
  };
}
