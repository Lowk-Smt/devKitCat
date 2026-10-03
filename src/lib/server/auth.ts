import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import type { CustomerRecord } from "@/types/account";
import {
  expiredSessionCookieOptions,
  isSessionTokenValue,
  resolveAuthConfig,
  sessionCookieOptions,
} from "./auth-core";
import { createCustomerAuthService } from "./auth-service";
import { getDatabaseClient } from "./database";

/**
 * Data access layer for authentication.
 *
 * Account routes and Server Functions resolve the signed-in customer through
 * this module only. `requireCustomer()` is the authorization gate: it is called
 * by every protected page and by every state-changing account action, and it
 * redirects to `/login` when the session cookie is missing, malformed,
 * revoked, or expired.
 *
 * React's `cache()` memoizes the lookup for a single request, so a layout and
 * its pages share one session read instead of repeating it.
 */

export const LOGIN_PATH = "/login";
export const ACCOUNT_HOME_PATH = "/account";
/** Shown by `/login` when `DATABASE_URL` is not configured. */
export const ACCOUNT_UNAVAILABLE_PATH = "/login?error=service-unavailable";

export const customerAuth = createCustomerAuthService(getDatabaseClient, resolveAuthConfig);

/** True when a PostgreSQL database is configured to hold accounts and sessions. */
export function isAccountServiceAvailable(): boolean {
  return customerAuth.isAvailable();
}

/** Returns the request's session token, or null when absent or malformed. */
export async function readSessionToken(): Promise<string | null> {
  const { cookieName } = resolveAuthConfig();
  const cookieStore = await cookies();
  const value = cookieStore.get(cookieName)?.value;
  return isSessionTokenValue(value) ? value : null;
}

/** The verified customer for this request, or null when signed out. */
export const getAuthenticatedCustomer = cache(async (): Promise<CustomerRecord | null> => {
  const token = await readSessionToken();
  if (!token) return null;

  const session = await customerAuth.readSession(token);
  return session.ok ? session.value.customer : null;
});

/**
 * Authorization gate for customer routes and actions. Never returns an
 * unauthenticated value: it redirects instead.
 */
export const requireCustomer = cache(async (): Promise<CustomerRecord> => {
  // Reading the session cookie first is what makes every account route render
  // per request instead of being prerendered at build time.
  const customer = await getAuthenticatedCustomer();
  if (customer) return customer;

  redirect(isAccountServiceAvailable() ? LOGIN_PATH : ACCOUNT_UNAVAILABLE_PATH);
});

/**
 * Persists a freshly issued session token as an HttpOnly cookie.
 * Callable only from a Server Function or Route Handler.
 */
export async function storeSessionCookie(token: string, expiresAt: Date): Promise<void> {
  const config = resolveAuthConfig();
  const cookieStore = await cookies();
  cookieStore.set(
    config.cookieName,
    token,
    sessionCookieOptions(expiresAt, new Date(), config),
  );
}

/**
 * Removes the session cookie. Callable only from a Server Function or Route
 * Handler; pair it with `customerAuth.destroySession()` so the stored record is
 * revoked too.
 */
export async function clearSessionCookie(): Promise<void> {
  const config = resolveAuthConfig();
  const cookieStore = await cookies();
  cookieStore.set(config.cookieName, "", expiredSessionCookieOptions(config));
}

/**
 * Revokes the current session server-side and clears its cookie. Signing out
 * therefore invalidates the token for every future request, even if the cookie
 * value was copied before the request.
 */
export async function signOutCurrentSession(): Promise<void> {
  const token = await readSessionToken();
  if (token) await customerAuth.destroySession(token);
  await clearSessionCookie();
}
