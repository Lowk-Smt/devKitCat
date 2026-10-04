import "dotenv/config";
import { normalizeDatabaseUrl } from "@/lib/server/database-config";
import {
  BOOTSTRAP_OWNER_EMAILS_ENV_VAR,
  MAX_BOOTSTRAP_OWNER_EMAILS,
  parseBootstrapOwnerEmails,
} from "@/lib/server/staff-core";
import {
  describeSeedError,
  formatSeedErrorReport,
} from "@/lib/server/seed-error";

/**
 * `npm run db:grant-owner` — promote explicitly named accounts to `OWNER`.
 *
 * This is the only way to create the first owner, and it is a deployment-time
 * command an operator runs on purpose:
 *
 * * it promotes **exactly** the addresses it was given, from
 *   `MARKETPLACE_OWNER_EMAILS` or repeated `--email` flags. It never picks the
 *   first registered customer, the most recent one, or anyone else;
 * * it is a dry run unless `--apply` is passed, so the plan is always reviewable;
 * * it refuses an address that is not a registered customer, and one whose
 *   account cannot sign in (no password digest — the seeded fixture account);
 * * it writes only `StaffMembership` rows, through the same service and the same
 *   last-owner guard the UI uses, and it is idempotent.
 *
 * Nothing here runs during a request, during a build, or in a deploy hook. Setting
 * or clearing `MARKETPLACE_OWNER_EMAILS` changes nothing on its own: it is read by
 * this command and by nothing else, which is why a stray environment variable
 * cannot hand out owner rights and why deleting it later does not revoke anyone.
 */

const CLI_LABEL = "devKitCat owner bootstrap";

const USAGE = `Usage: npm run db:grant-owner -- [--email <address>]... [--apply]

Grants the OWNER role for marketplace product management to the listed accounts.
Without --email flags, the addresses come from ${BOOTSTRAP_OWNER_EMAILS_ENV_VAR}
(comma or space separated). The command is a dry run unless --apply is passed.

Examples:
  npm run db:grant-owner -- --email ada@example.com
  MARKETPLACE_OWNER_EMAILS="ada@example.com" npm run db:grant-owner -- --apply
`;

interface ParsedArguments {
  emails: string[];
  apply: boolean;
  help: boolean;
  invalid: string[];
}

function parseArguments(argv: readonly string[]): ParsedArguments {
  const emails: string[] = [];
  const invalid: string[] = [];
  let apply = false;
  let help = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === "--apply") {
      apply = true;
      continue;
    }

    if (argument === "--help" || argument === "-h") {
      help = true;
      continue;
    }

    if (argument === "--email") {
      const value = argv[index + 1];
      if (typeof value === "string" && !value.startsWith("--")) {
        emails.push(value);
        index += 1;
        continue;
      }

      invalid.push("--email");
      continue;
    }

    invalid.push(argument ?? "");
  }

  return { emails, apply, help, invalid };
}

async function main(): Promise<void> {
  const args = parseArguments(process.argv.slice(2));

  if (args.help) {
    console.log(USAGE);
    return;
  }

  if (args.invalid.length > 0) {
    console.error(
      `Unknown or incomplete argument(s): ${args.invalid.map((value) => JSON.stringify(value)).join(", ")}\n\n${USAGE}`,
    );
    process.exitCode = 1;
    return;
  }

  const fromFlags = parseBootstrapOwnerEmails(args.emails.join(","));
  const fromEnvironment = parseBootstrapOwnerEmails(
    process.env[BOOTSTRAP_OWNER_EMAILS_ENV_VAR],
  );

  if (fromFlags.rejected.length > 0 || fromEnvironment.rejected.length > 0) {
    const rejected = [...fromFlags.rejected, ...fromEnvironment.rejected];
    console.error(
      `Refusing to run: ${rejected.length} address(es) are not valid email addresses (${rejected.join(", ")}).`,
    );
    process.exitCode = 1;
    return;
  }

  if (fromFlags.truncated || fromEnvironment.truncated) {
    console.error(
      `Refusing to run: list at most ${MAX_BOOTSTRAP_OWNER_EMAILS} addresses.`,
    );
    process.exitCode = 1;
    return;
  }

  if (fromFlags.emails.length > 0 && fromEnvironment.emails.length > 0) {
    // Ambiguous on purpose: mixing the two sources risks granting an address the
    // operator did not mean to, so the command asks for one source instead.
    console.error(
      `Refusing to run: ${args.emails.length > 0 ? "--email flags" : "addresses"} and ${BOOTSTRAP_OWNER_EMAILS_ENV_VAR} were both provided. Use one source only.`,
    );
    process.exitCode = 1;
    return;
  }

  const emails =
    fromFlags.emails.length > 0 ? fromFlags.emails : fromEnvironment.emails;

  if (emails.length === 0) {
    console.error(
      `No addresses to promote. Pass --email <address> or set ${BOOTSTRAP_OWNER_EMAILS_ENV_VAR}.\n\n${USAGE}`,
    );
    process.exitCode = 1;
    return;
  }

  let connectionString: string | null;
  try {
    connectionString = normalizeDatabaseUrl(process.env.DATABASE_URL);
  } catch {
    console.error(
      "DATABASE_URL must be a valid PostgreSQL connection URL. See .env.example.",
    );
    process.exitCode = 1;
    return;
  }

  if (!connectionString) {
    console.error(
      "DATABASE_URL is required before granting owner access. See .env.example.",
    );
    process.exitCode = 1;
    return;
  }

  try {
    console.log(
      args.apply
        ? `Granting OWNER to ${emails.length} explicitly listed account(s).`
        : `Dry run for ${emails.length} explicitly listed account(s). Re-run with --apply to write.`,
    );

    const { runOwnerBootstrap } = await import("./grant-owner-runner");
    const summary = await runOwnerBootstrap({
      connectionString,
      emails,
      apply: args.apply,
    });

    console.log(
      `${args.apply ? "Granted" : "Would grant"}: ${
        args.apply ? summary.granted : summary.wouldGrant
      }. Already owner: ${summary.alreadyOwner}. Refused: ${summary.failed}.`,
    );

    if (summary.failed > 0) {
      console.error(
        "At least one address was refused, so review the lines above. Granted accounts were written; refused ones were not.",
      );
      process.exitCode = 1;
    }

    if (!args.apply && summary.wouldGrant > 0) {
      console.log("Nothing was written. Re-run with --apply to grant access.");
    }
  } catch (error) {
    // The connection string is handed to the reporter as a secret so the message
    // is scrubbed of the URL and of the role, host, and password inside it before
    // anything reaches the terminal or a CI log.
    console.error(
      formatSeedErrorReport(
        describeSeedError(error, { secrets: [connectionString] }),
        CLI_LABEL,
      ),
    );
    process.exitCode = 1;
  }
}

void main().catch((error: unknown) => {
  console.error(formatSeedErrorReport(describeSeedError(error), CLI_LABEL));
  process.exitCode = 1;
});
