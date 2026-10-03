import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import {
  getOrCreateCachedClient,
  normalizeDatabaseUrl,
  type CachedDatabaseClient,
} from "./database-config";

interface PrismaGlobal {
  __devKitCatPrisma?: CachedDatabaseClient<PrismaClient>;
}

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

/**
 * Lazily creates one Prisma client per warm server process. A missing URL is
 * represented by `null` so the app can use its documented static demo fixtures
 * during local UI work and database-free builds.
 */
export function getDatabaseClient(): PrismaClient | null {
  const connectionString = normalizeDatabaseUrl(process.env.DATABASE_URL);
  if (!connectionString) return null;

  const globalWithPrisma = globalThis as typeof globalThis & PrismaGlobal;
  const result = getOrCreateCachedClient(
    globalWithPrisma.__devKitCatPrisma,
    connectionString,
    () => {
      const adapter = new PrismaPg(
        {
          connectionString,
          // Keep each Vercel function's pool small; instances are short-lived and
          // managed PostgreSQL providers may impose a per-application cap.
          max: 1,
          connectionTimeoutMillis: 5_000,
          idleTimeoutMillis: 30_000,
        },
        {
          onPoolError: (error) => {
            console.error(
              `[devKitCat database] PostgreSQL pool error (${safeErrorCode(error)}).`,
            );
          },
        },
      );
      return new PrismaClient({ adapter });
    },
  );

  if (result.replaced) {
    void result.replaced.$disconnect().catch(() => undefined);
  }

  globalWithPrisma.__devKitCatPrisma = result.cache;
  return result.client;
}
