import "dotenv/config";
import { normalizeDatabaseUrl } from "@/lib/server/database-config";
import {
  describeSeedError,
  formatSeedErrorReport,
} from "@/lib/server/seed-error";

const CLI_LABEL = "devKitCat catalog seed";

async function main() {
  // DATABASE_URL is validated before the generated Prisma client is loaded, so
  // a missing or invalid URL fails with a clear message without ever opening a
  // database connection.
  let connectionString: string | null;
  try {
    connectionString = normalizeDatabaseUrl(process.env.DATABASE_URL);
  } catch {
    console.error("DATABASE_URL must be a valid PostgreSQL connection URL. See .env.example.");
    process.exitCode = 1;
    return;
  }

  if (!connectionString) {
    console.error("DATABASE_URL is required before seeding the catalog. See .env.example.");
    process.exitCode = 1;
    return;
  }

  try {
    const { runCatalogSeed } = await import("./seed-catalog-runner");
    await runCatalogSeed(connectionString);
  } catch (error) {
    // The connection string is passed in as a secret so the report can scrub it
    // — and the username, password, and host inside it — out of whatever the
    // driver put in the message. The error code, message, and safe metadata are
    // printed instead of the previous code-only line.
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
  // Safety net for failures raised outside the guarded block (for example while
  // loading the runner module). No secrets are known at this point.
  console.error(formatSeedErrorReport(describeSeedError(error), CLI_LABEL));
  process.exitCode = 1;
});
