import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { seedMarketplace } from "@/lib/server/seed-database";

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
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    console.error("DATABASE_URL is required before seeding. See .env.example.");
    process.exitCode = 1;
    return;
  }

  let databaseUrl: URL;
  try {
    databaseUrl = new URL(connectionString);
  } catch {
    console.error("DATABASE_URL must be a valid PostgreSQL connection URL.");
    process.exitCode = 1;
    return;
  }

  if (
    databaseUrl.protocol !== "postgresql:" &&
    databaseUrl.protocol !== "postgres:"
  ) {
    console.error("DATABASE_URL must use the PostgreSQL protocol.");
    process.exitCode = 1;
    return;
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg({
      connectionString,
      max: 1,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
    }),
  });

  try {
    const result = await seedMarketplace(prisma);
    console.log(
      `Seeded ${result.categories} categories, ${result.products} products, ` +
        `${result.customer} demo customer, ${result.orders} orders, ` +
        `${result.orderItems} order items, and ${result.downloads} download records.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error(
    `[devKitCat seed] Failed (${safeErrorCode(error)}). Check DATABASE_URL, apply migrations, and review the seed fixtures.`,
  );
  process.exitCode = 1;
});
