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
    adapter: new PrismaPg({
      connectionString,
      max: 1,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
    }),
  });

  try {
    const result = await seedCatalog(prisma);
    console.log(
      `Seeded catalog: ${result.categories} categories and ${result.products} products ` +
        `(${result.productImages} images, ${result.productModelPreviews} model previews, ` +
        `${result.changelogEntries} changelog entries).`,
    );
    console.log(
      "Customer, order, order-item, and download tables were not written.",
    );
  } finally {
    await prisma.$disconnect();
  }
}
