import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { OWNER_BOOTSTRAP_CONFIRMATION, type StaffRole } from "@/lib/server/staff-core";
import { createStaffAccessService } from "@/lib/server/staff-service";

/**
 * Performs the owner bootstrap against the validated connection string.
 *
 * Kept separate from `grant-owner.ts` so the entrypoint can validate
 * `DATABASE_URL` before this module loads the generated Prisma client, exactly as
 * the catalog seed does. Every write goes through the same service the UI uses —
 * including its last-owner guard — and the only thing this file adds is the
 * confirmation literal that `bootstrapOwnerAccess` requires of a caller with no
 * acting owner, which is why this command can create the first owner while no
 * request handler can.
 */

export interface OwnerBootstrapSummary {
  /** Roles actually written by this run. */
  granted: number;
  /** Addresses that already held OWNER, so nothing was written for them. */
  alreadyOwner: number;
  /** Addresses the run planned to grant, in a dry run. */
  wouldGrant: number;
  /** Addresses that were refused: unknown account, no password, or an error. */
  failed: number;
}

export interface OwnerBootstrapInput {
  connectionString: string;
  emails: readonly string[];
  apply: boolean;
}

function report(email: string, outcome: string): void {
  console.log(`- ${email}: ${outcome}`);
}

function roleLabel(role: StaffRole): string {
  return role === "owner" ? "OWNER" : "STAFF";
}

export async function runOwnerBootstrap(
  input: OwnerBootstrapInput,
): Promise<OwnerBootstrapSummary> {
  const prisma = new PrismaClient({
    // Keep CLI failures to one line per fact, as the catalog seed does: the
    // default format buries the cause under an absolute-path code excerpt.
    errorFormat: "minimal",
    adapter: new PrismaPg({
      connectionString: input.connectionString,
      max: 1,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
    }),
  });

  const staff = createStaffAccessService(() => prisma);
  const summary: OwnerBootstrapSummary = {
    granted: 0,
    alreadyOwner: 0,
    wouldGrant: 0,
    failed: 0,
  };

  try {
    for (const email of input.emails) {
      const account = await staff.describeBootstrapAccount(email);

      if (!account.ok) {
        summary.failed += 1;
        report(email, `refused (the account lookup failed: ${account.code})`);
        continue;
      }

      if (!account.value) {
        summary.failed += 1;
        report(
          email,
          "refused (no customer account uses this address — the person has to register first)",
        );
        continue;
      }

      if (account.value.currentRole === "owner") {
        summary.alreadyOwner += 1;
        report(account.value.email, `already OWNER for ${account.value.name}; nothing changed`);
        continue;
      }

      if (!account.value.canSignIn) {
        // The seeded fixture customer has no password by design. Granting it
        // owner rights would create an access row nobody can use — and an
        // account that cannot sign in cannot manage anything anyway.
        summary.failed += 1;
        report(
          account.value.email,
          "refused (this account has no password and cannot sign in)",
        );
        continue;
      }

      if (!input.apply) {
        summary.wouldGrant += 1;
        report(
          account.value.email,
          account.value.currentRole === null
            ? `would grant OWNER to ${account.value.name}`
            : `would promote ${account.value.name} from ${roleLabel(
                account.value.currentRole,
              )} to OWNER`,
        );
        continue;
      }

      const granted = await staff.bootstrapOwnerAccess({
        email: account.value.email,
        // The structural guard from `staff-core.ts`: this is the only module
        // allowed to write a grant with no acting owner, and it promotes exactly
        // the address above — never "the first user".
        confirmation: OWNER_BOOTSTRAP_CONFIRMATION,
      });

      if (!granted.ok) {
        summary.failed += 1;
        report(account.value.email, `refused (${granted.code})`);
        continue;
      }

      summary.granted += 1;
      report(
        account.value.email,
        granted.value.alreadyGranted
          ? "already OWNER; nothing changed"
          : `granted OWNER to ${granted.value.name}`,
      );
    }

    return summary;
  } finally {
    await prisma.$disconnect().catch(() => undefined);
  }
}
