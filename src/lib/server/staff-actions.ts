"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { MANAGE_PATH, authorizeStaffAction, staffAccess } from "./staff";
import {
  parseGrantableStaffRole,
  staffNoticeCode,
  type ManageNoticeCode,
} from "./staff-core";

/**
 * Server Functions for the only privileged write that is not about a product:
 * handing out or taking back a staff grant.
 *
 * `staff:manage` is the owner-only privilege, so these are exactly the entry
 * points a self-promotion attempt would have to reach — and each one refuses
 * before reading a single field. The target is addressed by **email**, which the
 * service resolves to a `Customer` row on the server, so a request can never name
 * a customer id; the role is parsed by `parseGrantableStaffRole`, whose only two
 * outcomes are `owner` and `staff`, defaulting to the lower one.
 *
 * Nothing here reads a cookie flag or client-side state, and nothing writes to
 * `Customer`: revoking a grant leaves an ordinary customer who can still sign in,
 * browse, order, and download.
 */

/** Not exported: a `"use server"` module may only export async functions. */
function refuse(notice: ManageNoticeCode): void {
  redirect(`${MANAGE_PATH}?notice=${notice}`);
}

function done(notice: ManageNoticeCode): void {
  revalidatePath(MANAGE_PATH);
  redirect(`${MANAGE_PATH}?notice=${notice}`);
}

/**
 * Grants or changes a staff role for one email address.
 *
 * A malformed address is refused as `INVALID_INPUT`, and an address that is not a
 * registered customer as `NOT_FOUND` — the management surface never confirms more
 * than the operator already typed.
 */
export async function grantStaffAccessAction(formData: FormData): Promise<void> {
  const authorization = await authorizeStaffAction("staff:manage");
  if (!authorization.ok) return refuse(staffNoticeCode(authorization.code));

  const email = formData.get("email");
  const role = parseGrantableStaffRole(formData.get("role"));

  const result = await staffAccess.grantMembership(authorization.value, { email, role });
  if (!result.ok) return refuse(staffNoticeCode(result.code));

  // The grant is real either way; an account with no password (the seeded
  // fixture customer) simply cannot use it until it registers a password.
  done(result.value.canSignIn ? "staff-granted" : "staff-granted-no-sign-in");
}

/** Revokes one staff grant, addressed by email. The last owner cannot be revoked. */
export async function revokeStaffAccessAction(formData: FormData): Promise<void> {
  const authorization = await authorizeStaffAction("staff:manage");
  if (!authorization.ok) return refuse(staffNoticeCode(authorization.code));

  const result = await staffAccess.revokeMembership(authorization.value, formData.get("email"));
  if (!result.ok) return refuse(staffNoticeCode(result.code));

  done("staff-revoked");
}
