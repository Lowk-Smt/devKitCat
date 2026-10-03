import "server-only";
import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { getPasswordConfirmationError } from "../account-presentation";
import type { ThemePreference } from "../../types/account";

/**
 * Framework-free authentication primitives: password hashing, opaque session
 * tokens, cookie policy, and input validation.
 *
 * Nothing here touches Next.js, Prisma, or the request context, so the whole
 * surface is unit-testable. Passwords, hashes, and tokens must never be logged
 * or serialized into a server action response.
 */

const scryptAsync = promisify(scrypt) as unknown as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
) => Promise<Buffer>;

interface ScryptOptions {
  N: number;
  r: number;
  p: number;
  maxmem: number;
}

/** Algorithm identifier stored with every digest so parameters can evolve. */
export const PASSWORD_HASH_ALGORITHM = "scrypt";

/**
 * scrypt cost parameters: N = 2^17, r = 8, p = 1 with a 64-byte digest, which
 * is the OWASP Password Storage Cheat Sheet recommendation and costs about
 * 128 MiB of memory per derivation.
 */
export const SCRYPT_COST = 131_072;
export const SCRYPT_BLOCK_SIZE = 8;
export const SCRYPT_PARALLELIZATION = 1;
export const PASSWORD_HASH_KEY_LENGTH = 64;
export const PASSWORD_SALT_BYTES = 16;

/** Upper bounds keep a hostile value from forcing an unbounded derivation. */
const MAX_SUPPORTED_SCRYPT_COST = 2 ** 20;
const MAX_SUPPORTED_BLOCK_SIZE = 32;
const MAX_SUPPORTED_PARALLELIZATION = 16;

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;
export const NAME_MIN_LENGTH = 2;
export const NAME_MAX_LENGTH = 80;
export const EMAIL_MAX_LENGTH = 254;

/** 256 bits of entropy, base64url encoded, compared only through its hash. */
export const SESSION_TOKEN_BYTES = 32;
export const SESSION_COOKIE_NAME = "devkitcat_session";

export const DEFAULT_SESSION_MAX_AGE_DAYS = 7;
export const DEFAULT_REMEMBER_ME_MAX_AGE_DAYS = 30;
const MAX_ALLOWED_SESSION_DAYS = 365;

const DAY_IN_MILLISECONDS = 86_400_000;

/** Pragmatic address shape; the field is also constrained by `type="email"`. */
const EMAIL_PATTERN =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

/** Base64url without padding, exactly what `generateSessionToken` produces. */
const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export interface AuthConfig {
  cookieName: string;
  sessionMaxAgeDays: number;
  rememberMeMaxAgeDays: number;
  secureCookies: boolean;
}

export interface SessionCookieOptions {
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  path: "/";
  expires: Date;
  maxAge: number;
}

export interface RegistrationFormInput {
  name: unknown;
  email: unknown;
  password: unknown;
  confirmPassword: unknown;
  acceptTerms: unknown;
}

export interface ValidatedRegistration {
  name: string;
  email: string;
  password: string;
}

export interface LoginFormInput {
  email: unknown;
  password: unknown;
  rememberMe: unknown;
}

export interface ValidatedLogin {
  email: string;
  password: string;
  rememberMe: boolean;
}

export interface ProfileFormInput {
  name: unknown;
  theme: unknown;
  productUpdates: unknown;
  releaseNotes: unknown;
}

export interface ValidatedProfile {
  name: string;
  theme: ThemePreference;
  productUpdates: boolean;
  releaseNotes: boolean;
}

export type ValidationFields =
  | "name"
  | "email"
  | "password"
  | "confirmPassword"
  | "acceptTerms"
  | "theme";

export type ValidationErrors = Partial<Record<ValidationFields, string>>;

export type Validation<TValue> =
  | { ok: true; value: TValue }
  | { ok: false; errors: ValidationErrors; message?: string };

interface ParsedPasswordHash {
  cost: number;
  blockSize: number;
  parallelization: number;
  salt: Buffer;
  digest: Buffer;
}

function scryptOptions(cost: number, blockSize: number, parallelization: number): ScryptOptions {
  return {
    N: cost,
    r: blockSize,
    p: parallelization,
    // Node caps scrypt memory at 32 MiB by default; allow the configured cost.
    maxmem: 128 * cost * blockSize * parallelization + 16 * 1024 * 1024,
  };
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Length-limited constant-time comparison; unequal lengths still cost a pass. */
function digestsMatch(left: Buffer, right: Buffer): boolean {
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * Derives a salted scrypt digest and returns it in a self-describing format:
 * `scrypt$N$r$p$salt$digest`. Plaintext passwords never leave this module.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(PASSWORD_SALT_BYTES);
  const digest = await scryptAsync(
    password,
    salt,
    PASSWORD_HASH_KEY_LENGTH,
    scryptOptions(SCRYPT_COST, SCRYPT_BLOCK_SIZE, SCRYPT_PARALLELIZATION),
  );

  return [
    PASSWORD_HASH_ALGORITHM,
    SCRYPT_COST,
    SCRYPT_BLOCK_SIZE,
    SCRYPT_PARALLELIZATION,
    salt.toString("base64"),
    digest.toString("base64"),
  ].join("$");
}

/** Parses a stored digest; returns null for anything malformed or oversized. */
export function parsePasswordHash(storedHash: string | null | undefined): ParsedPasswordHash | null {
  if (typeof storedHash !== "string") return null;

  const parts = storedHash.split("$");
  if (parts.length !== 6 || parts[0] !== PASSWORD_HASH_ALGORITHM) return null;

  const cost = Number(parts[1]);
  const blockSize = Number(parts[2]);
  const parallelization = Number(parts[3]);
  if (
    !Number.isInteger(cost) ||
    !Number.isInteger(blockSize) ||
    !Number.isInteger(parallelization) ||
    cost < 1_024 ||
    cost > MAX_SUPPORTED_SCRYPT_COST ||
    blockSize < 1 ||
    blockSize > MAX_SUPPORTED_BLOCK_SIZE ||
    parallelization < 1 ||
    parallelization > MAX_SUPPORTED_PARALLELIZATION
  ) {
    return null;
  }

  const salt = Buffer.from(parts[4], "base64");
  const digest = Buffer.from(parts[5], "base64");
  if (salt.length !== PASSWORD_SALT_BYTES || digest.length !== PASSWORD_HASH_KEY_LENGTH) {
    return null;
  }

  return { cost, blockSize, parallelization, salt, digest };
}

/** Verifies a password against a stored digest using the digest's own cost. */
export async function verifyPassword(
  password: string,
  storedHash: string | null | undefined,
): Promise<boolean> {
  const parsed = parsePasswordHash(storedHash);
  if (!parsed) return false;

  const digest = await scryptAsync(
    password,
    parsed.salt,
    parsed.digest.length,
    scryptOptions(parsed.cost, parsed.blockSize, parsed.parallelization),
  );

  return digestsMatch(digest, parsed.digest);
}

/**
 * Runs one throwaway derivation with the standard cost so a sign-in attempt for
 * an unknown email or a customer without a password takes the same time as a
 * real verification. This limits account enumeration through timing.
 */
export async function runPasswordVerificationDecoy(password: string): Promise<void> {
  try {
    await scryptAsync(
      password,
      Buffer.alloc(PASSWORD_SALT_BYTES),
      PASSWORD_HASH_KEY_LENGTH,
      scryptOptions(SCRYPT_COST, SCRYPT_BLOCK_SIZE, SCRYPT_PARALLELIZATION),
    );
  } catch {
    // A failed decoy derivation must not change the sign-in result.
  }
}

/** Cryptographically random opaque session token for the HttpOnly cookie. */
export function generateSessionToken(): string {
  return randomBytes(SESSION_TOKEN_BYTES).toString("base64url");
}

/**
 * One-way hash stored instead of the token itself, so stolen session rows are
 * not usable credentials.
 */
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Rejects cookie values that cannot be a token before any database lookup. */
export function isSessionTokenValue(value: unknown): value is string {
  return typeof value === "string" && SESSION_TOKEN_PATTERN.test(value);
}

/**
 * Secure cookies are required in production and can be forced on for HTTPS
 * previews, but they can never be forced off in production.
 */
export function shouldUseSecureCookies(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NODE_ENV === "production") return true;
  return env.AUTH_COOKIE_SECURE?.trim().toLowerCase() === "true";
}

function parseMaxAgeDays(value: string | undefined, fallback: number): number {
  const parsed = Number(value?.trim());
  if (!Number.isFinite(parsed)) return fallback;

  const days = Math.floor(parsed);
  if (days < 1 || days > MAX_ALLOWED_SESSION_DAYS) return fallback;
  return days;
}

/** Session lifetimes and cookie policy, read from environment configuration. */
export function resolveAuthConfig(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  const sessionMaxAgeDays = parseMaxAgeDays(
    env.AUTH_SESSION_MAX_AGE_DAYS,
    DEFAULT_SESSION_MAX_AGE_DAYS,
  );

  return {
    cookieName: SESSION_COOKIE_NAME,
    sessionMaxAgeDays,
    rememberMeMaxAgeDays: Math.max(
      sessionMaxAgeDays,
      parseMaxAgeDays(env.AUTH_REMEMBER_ME_MAX_AGE_DAYS, DEFAULT_REMEMBER_ME_MAX_AGE_DAYS),
    ),
    secureCookies: shouldUseSecureCookies(env),
  };
}

export function sessionMaxAgeDays(rememberMe: boolean, config: AuthConfig): number {
  return rememberMe ? config.rememberMeMaxAgeDays : config.sessionMaxAgeDays;
}

export function sessionExpiresAt(
  now: Date,
  rememberMe: boolean,
  config: AuthConfig,
): Date {
  return new Date(now.getTime() + sessionMaxAgeDays(rememberMe, config) * DAY_IN_MILLISECONDS);
}

/** Cookie attributes shared by every issued session. */
export function sessionCookieOptions(
  expiresAt: Date,
  now: Date,
  config: AuthConfig,
): SessionCookieOptions {
  // Rounded up so the browser cookie can never expire before the stored session
  // does. A sub-second overshoot is harmless: `readSession` remains the
  // authority and rejects a token whose database row has expired.
  const remainingSeconds = Math.ceil((expiresAt.getTime() - now.getTime()) / 1000);

  return {
    httpOnly: true,
    secure: config.secureCookies,
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
    maxAge: Math.max(0, remainingSeconds),
  };
}

/** Attributes that immediately expire the session cookie on sign-out. */
export function expiredSessionCookieOptions(config: AuthConfig): SessionCookieOptions {
  return {
    httpOnly: true,
    secure: config.secureCookies,
    sameSite: "lax",
    path: "/",
    expires: new Date(0),
    maxAge: 0,
  };
}

/** Trimmed, lowercased email used for both storage and lookups. */
export function normalizeEmail(value: unknown): string {
  return readString(value).trim().toLocaleLowerCase("en-US");
}

export function isValidEmailAddress(email: string): boolean {
  return email.length > 0 && email.length <= EMAIL_MAX_LENGTH && EMAIL_PATTERN.test(email);
}

/** Collapses whitespace and strips control characters from a display name. */
export function normalizeDisplayName(value: unknown): string {
  return readString(value)
    .replace(/[\u0000-\u001F\u007F\u200B-\u200D\uFEFF]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, NAME_MAX_LENGTH);
}

export function parseThemePreference(value: unknown): ThemePreference | null {
  const normalized = readString(value).trim().toLowerCase();
  return normalized === "dark" || normalized === "system" ? normalized : null;
}

/** Checkboxes submit `on` (or an explicit value) only when they are checked. */
export function parseBooleanFormField(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return false;

  const normalized = value.trim().toLowerCase();
  return normalized === "on" || normalized === "true" || normalized === "1";
}

export function validateRegistrationInput(input: RegistrationFormInput): Validation<ValidatedRegistration> {
  const errors: ValidationErrors = {};

  const name = normalizeDisplayName(input.name);
  if (name.length < NAME_MIN_LENGTH) {
    errors.name = `Enter the name to show on your account (at least ${NAME_MIN_LENGTH} characters).`;
  }

  const email = normalizeEmail(input.email);
  if (!isValidEmailAddress(email)) {
    errors.email = "Enter a valid email address.";
  }

  const password = readString(input.password);
  if (password.length < PASSWORD_MIN_LENGTH) {
    errors.password = `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
  } else if (password.length > PASSWORD_MAX_LENGTH) {
    errors.password = `Use ${PASSWORD_MAX_LENGTH} characters or fewer.`;
  }

  const confirmationError = getPasswordConfirmationError(password, readString(input.confirmPassword));
  if (!errors.password && confirmationError) {
    errors.confirmPassword = confirmationError;
  }

  if (!parseBooleanFormField(input.acceptTerms)) {
    errors.acceptTerms = "Please acknowledge the account terms to continue.";
  }

  if (Object.keys(errors).length > 0) {
    return {
      ok: false,
      errors,
      message: "Check the highlighted fields and try again.",
    };
  }

  return { ok: true, value: { name, email, password } };
}

export function validateLoginInput(input: LoginFormInput): Validation<ValidatedLogin> {
  const errors: ValidationErrors = {};

  const email = normalizeEmail(input.email);
  if (!isValidEmailAddress(email)) {
    errors.email = "Enter a valid email address.";
  }

  const password = readString(input.password);
  if (password.length === 0) {
    errors.password = "Enter your password.";
  } else if (password.length > PASSWORD_MAX_LENGTH) {
    errors.password = `Use ${PASSWORD_MAX_LENGTH} characters or fewer.`;
  }

  if (Object.keys(errors).length > 0) {
    return {
      ok: false,
      errors,
      message: "Check the highlighted fields and try again.",
    };
  }

  return { ok: true, value: { email, password, rememberMe: parseBooleanFormField(input.rememberMe) } };
}

export function validateProfileInput(input: ProfileFormInput): Validation<ValidatedProfile> {
  const errors: ValidationErrors = {};

  const name = normalizeDisplayName(input.name);
  if (name.length < NAME_MIN_LENGTH) {
    errors.name = `Enter the name to show on your account (at least ${NAME_MIN_LENGTH} characters).`;
  }

  const theme = parseThemePreference(input.theme);
  if (!theme) {
    errors.theme = "Choose either the dark theme or your device setting.";
  }

  if (!theme || Object.keys(errors).length > 0) {
    return {
      ok: false,
      errors,
      message: "Your changes were not saved.",
    };
  }

  return {
    ok: true,
    value: {
      name,
      theme,
      productUpdates: parseBooleanFormField(input.productUpdates),
      releaseNotes: parseBooleanFormField(input.releaseNotes),
    },
  };
}

