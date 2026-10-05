import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import {
  ACCOUNT_HOME_PATH,
  getAuthenticatedCustomer,
  requireCustomer,
} from "./auth";
import { getDatabaseClient } from "./database";
import {
  hasStaffPrivilege,
  type StaffAccess,
  type StaffFailureCode,
  type StaffPrivilege,
  type StaffResult,
} from "./staff-core";
import { createStaffAccessService } from "./staff-service";

/**
 * Data access layer for staff authorization.
 *
 * `requireStaffAccess()` is the gate for protected **pages**;
 * `authorizeStaffAction()` is the same check for **Server Functions**, which
 * report a refusal instead of redirecting. Both resolve the actor from the
 * session and then ask the policy in `staff-core.ts` — never from a cookie flag,
 * a form field, a query parameter, or client state.
 *
 * Two properties are deliberate:
 *
 * * **Per request, never shared.** The lookup is wrapped in React's `cache()`,
 *   which memoizes within one request only. It is never wrapped in
 *   `unstable_cache` (see `src/lib/server/catalog-cache.ts`, which stays
 *   public-only), because access is private per account and a revoked grant must
 *   stop working on the next request rather than at the end of a cache TTL.
 * * **Checked in the page and in the action.** A layout is not enough: Next.js
 *   layouts do not re-render on client-side navigation, and a Server Function is
 *   a public POST endpoint regardless of what any screen renders.
 */

/** The private management surface. It is not linked from the public chrome. */
export const MANAGE_PATH = "/manage";
/** Where an authenticated but unauthorized account is sent, with a notice. */
export const STAFF_DENIED_PATH = `${ACCOUNT_HOME_PATH}?staff=denied`;

export const staffAccess = createStaffAccessService(getDatabaseClient);

/** True when a database is configured, so a grant can be read at all. */
export function isStaffServiceAvailable(): boolean {
  return staffAccess.isAvailable();
}

/**
 * The verified staff access for this request, or `null` when the signed-in
 * account holds no grant (or the grant could not be read).
 *
 * Every branch that is not an explicit "yes" returns `null`: a missing session, a
 * missing database, and a failed lookup all deny. Unauthenticated and
 * unauthorized are folded together on purpose — the public response of this
 * function must not reveal whether an account exists or what it holds.
 */
export const getStaffAccess = cache(async (): Promise<StaffAccess | null> => {
  const customer = await getAuthenticatedCustomer();
  if (!customer) return null;

  const result = await staffAccess.getAccessForCustomer(customer.id);
  return result.ok ? result.value : null;
});

/** The privilege check for Server Functions and route handlers. */
export async function authorizeStaffAction(
  privilege: StaffPrivilege,
): Promise<StaffResult<StaffAccess>> {
  if (!isStaffServiceAvailable()) return deny("UNAVAILABLE");
  if (!(await getAuthenticatedCustomer())) return deny("UNAUTHENTICATED");

  const access = await getStaffAccess();
  if (!access) return deny("FORBIDDEN");
  if (!hasStaffPrivilege(access, privilege)) return deny("FORBIDDEN");

  return { ok: true, value: access };
}

function deny(
  code: StaffFailureCode,
): { ok: false; code: StaffFailureCode } {
  return { ok: false, code };
}

/**
 * Authorization gate for management pages. It never returns an unauthorized
 * value: signed-out visitors are sent to `/login` (exactly as `requireCustomer()`
 * does for `/account`), and a signed-in account without a grant is sent back to
 * its own account area.
 *
 * The redirect target is the same for "you are not staff" and "this deployment
 * has no database", and the page renders no content either way, so the URL
 * exposes nothing about who is on the staff list.
 */
export const requireStaffAccess = cache(
  async (privilege: StaffPrivilege = "products:manage"): Promise<StaffAccess> => {
    // Reading the session cookie is also what keeps these routes dynamic: no
    // private render can be produced for the shared cache.
    // `requireCustomer()` already distinguishes "signed out" from "no database"
    // and redirects for both, so a management page never renders against a
    // deployment that cannot verify a grant.
    const customer = await requireCustomer();

    const access = await getStaffAccess();
    if (!access || !hasStaffPrivilege(access, privilege)) {
      redirect(STAFF_DENIED_PATH);
    }

    // `customer` is intentionally not returned: the id inside `access` is the
    // session's own, and re-checking it here makes a mismatch impossible.
    if (access.customerId !== customer.id) redirect(STAFF_DENIED_PATH);

    return access;
  },
);

/** Convenience check for conditional UI on an already-authorized page. */
export function can(access: StaffAccess | null, privilege: StaffPrivilege): boolean {
  return hasStaffPrivilege(access, privilege);
}
