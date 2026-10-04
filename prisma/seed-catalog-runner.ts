import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { seedCatalog } from "@/lib/server/seed-catalog";

/**
 * Runs the catalog-only seed against the validated connection string. Kept
 * separate from `seed-catalog.ts` so the entrypoint can validate DATABASE_URL
 * before this module loads the generated Prisma client.
 */
export async function runCatalogSeed(connectionString: string): Promise<void> {
  const prisma = new PrismaClient({
    // Keep CLI failures to one line per fact: the default "colorless" format
    // prefixes every error with an absolute-path code excerpt, which hides the
    // actual cause (and its metadata) in a wall of source text.
    errorFormat: "minimal",
    adapter: new PrismaPg({
      connectionString,
      max: 1,
      // Stays below `CATALOG_SEED_TRANSACTION_OPTIONS.maxWait` (15s), so a pool
      // that cannot connect reports the driver's descriptive error instead of
      // Prisma's generic "Unable to start a transaction in the given time."
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
    }),
  });

  const startedAt = Date.now();

  try {
    const result = await seedCatalog(prisma);
    console.log(
      `Seeded catalog: ${result.categories} categories and ${result.products} products ` +
        `(${result.productImages} images, ${result.productModelPreviews} model previews, ` +
        `${result.changelogEntries} changelog entries) in ${Date.now() - startedAt} ms.`,
    );
    console.log(
      "Customer, order, order-item, and download tables were not written.",
    );
  } finally {
    await prisma.$disconnect();
  }
}
