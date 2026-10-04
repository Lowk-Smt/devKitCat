import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { STAFF_ROLE_LABELS } from "@/lib/server/staff-core";
import {
  grantStaffAccessAction,
  revokeStaffAccessAction,
} from "@/lib/server/staff-actions";
import type { StaffMembershipView } from "@/lib/server/staff-service";
import styles from "./manage.module.css";

interface StaffAccessPanelProps {
  memberships: readonly StaffMembershipView[];
  /** The signed-in owner's own id, so the row can say "you". */
  selfCustomerId: string;
  /** True when the read failed, so the form is not offered on a broken list. */
  unavailable?: boolean;
}

/**
 * The owner-only staff directory.
 *
 * It renders only when `staff:manage` is held (owners), and it is a convenience:
 * the same `staff:manage` check runs again inside both Server Functions, so
 * hiding this panel is presentation and the check is the protection. A grant is
 * addressed by email — this UI never sends a customer id — and the role select
 * defaults to the lower-privileged value.
 */
export function StaffAccessPanel({
  memberships,
  selfCustomerId,
  unavailable = false,
}: StaffAccessPanelProps) {
  return (
    <div className={styles.form}>
      <form action={grantStaffAccessAction} method="post" className={styles.form}>
        <div className={styles.fieldGrid}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="staff-email">
              Customer email
            </label>
            <input
              className={styles.input}
              id="staff-email"
              name="email"
              type="email"
              maxLength={254}
              autoComplete="off"
              required
              disabled={unavailable}
              placeholder="ada@example.com"
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="staff-role">
              Role
            </label>
            <select
              className={styles.select}
              id="staff-role"
              name="role"
              defaultValue="staff"
              disabled={unavailable}
            >
              <option value="staff">{STAFF_ROLE_LABELS.staff}</option>
              <option value="owner">{STAFF_ROLE_LABELS.owner}</option>
            </select>
          </div>
        </div>

        <div className={styles.formActions}>
          <Button type="submit" variant="primary" size="sm" disabled={unavailable}>
            <Icon name="check" size={15} />
            Grant access
          </Button>
          <p className={styles.muted}>
            The account must already be registered. Access can be removed at any
            time, and removing it leaves the customer account intact.
          </p>
        </div>
      </form>

      <ul className={styles.list}>
        {memberships.length === 0 ? (
          <li className={styles.row}>
            <p className={styles.muted}>
              No staff accounts yet. Grant the first one with the form above, or run{" "}
              <code>npm run db:grant-owner</code>.
            </p>
          </li>
        ) : null}

        {memberships.map((membership) => (
          <li className={styles.row} key={membership.customerId}>
            <div className={styles.rowMain}>
              <div className={styles.titleCell}>
                <span className={styles.titleText}>
                  {membership.name}
                  {membership.customerId === selfCustomerId ? " (you)" : ""}
                </span>
                <span className={styles.slugText}>{membership.email}</span>
                <span className={styles.muted}>
                  Since {membership.grantedAt.toISOString().slice(0, 10)}
                  {membership.bootstrapped ? " · issued by deployment bootstrap" : ""}
                </span>
              </div>

              <div className={styles.rowBadges}>
                <span
                  className={
                    membership.role === "owner"
                      ? `${styles.badge} ${styles.badgeOk}`
                      : styles.badge
                  }
                >
                  {STAFF_ROLE_LABELS[membership.role]}
                </span>
              </div>

              <div className={styles.rowActions}>
                <form
                  className={styles.inlineForm}
                  action={revokeStaffAccessAction}
                  method="post"
                >
                  <input type="hidden" name="email" value={membership.email} />
                  <Button type="submit" variant="secondary" size="sm">
                    <Icon name="close" size={15} />
                    Revoke
                  </Button>
                </form>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
