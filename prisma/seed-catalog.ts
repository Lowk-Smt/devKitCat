import "dotenv/config";
import { normalizeDatabaseUrl } from "@/lib/server/database-config";

function safeErrorCode(error: unknown): string {
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

  const { runCatalogSeed } = await import("./seed-catalog-runner");
  await runCatalogSeed(connectionString);
}

void main().catch((error: unknown) => {
  console.error(
    `[devKitCat catalog seed] Failed (${safeErrorCode(error)}). Check DATABASE_URL and apply migrations before seeding the catalog.`,
  );
  process.exitCode = 1;
});
