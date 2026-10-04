import "server-only";
import type {
  CategoryIcon as PrismaCategoryIcon,
  Prisma,
  PrismaClient,
  ProductType as PrismaProductType,
} from "@/generated/prisma/client";
import type { Product } from "@/types";
import {
  buildCatalogSeedData,
  type CatalogSeedData,
  type SeedProduct,
} from "./seed-data";

const CATEGORY_ICON_MAP: Record<string, PrismaCategoryIcon> = {
  systems: "SYSTEMS",
  "ui-kits": "UI_KITS",
  "3d-assets": "ASSETS_3D",
  vfx: "VFX",
  audio: "AUDIO",
  "developer-tools": "DEVELOPER_TOOLS",
  templates: "TEMPLATES",
  "complete-kits": "COMPLETE_KITS",
};

const PRODUCT_TYPE_MAP: Record<Product["type"], PrismaProductType> = {
  system: "SYSTEM",
  "ui-kit": "UI_KIT",
  "starter-kit": "STARTER_KIT",
  "model-pack": "MODEL_PACK",
  "vfx-pack": "VFX_PACK",
};

function categoryIcon(icon: string): PrismaCategoryIcon {
  const mapped = CATEGORY_ICON_MAP[icon];
  if (!mapped) throw new Error(`No database category icon mapping exists for ${icon}.`);
  return mapped;
}

function productType(type: SeedProduct["type"]): PrismaProductType {
  return PRODUCT_TYPE_MAP[type];
}

/**
 * The only Prisma delegates the catalog writer is allowed to use. Typing the
 * transaction like this keeps customer, order, order-item, cart, session and
 * download tables out of reach of the catalog seed at compile time, not just
 * by convention.
 */
type CatalogTransaction = Pick<
  Prisma.TransactionClient,
  | "category"
  | "product"
  | "productImage"
  | "productModelPreview"
  | "productChangelogEntry"
>;

export interface CatalogSeedSummary {
  categories: number;
  products: number;
  productImages: number;
  productModelPreviews: number;
  changelogEntries: number;
}

/**
 * Explicit budget for the catalog seed's interactive transaction.
 *
 * Prisma's defaults for interactive transactions are `maxWait: 2_000` and
 * `timeout: 5_000` milliseconds. The catalog write runs 41 sequential
 * statements (8 category upserts, 6 product upserts, 18 child-table prunes, and
 * 9 child upserts, plus BEGIN and COMMIT) and every statement is a separate
 * round trip, so the default 5s budget expires midway through a remote (Neon)
 * run and the command fails
 * with `P2028`: "A query cannot be executed on an expired transaction. The
 * timeout for this transaction was 5000 ms, however 5792 ms passed…". That
 * failure is reproduced deterministically in `docs/pr-10-catalog-seed-timeout-fix.md`
 * by adding latency to a local database.
 *
 * `maxWait` covers transaction startup (pool checkout + `BEGIN`) and is kept
 * above the pg pool's own `connectionTimeoutMillis` (5s) so that a pool that
 * cannot connect surfaces the driver's descriptive error rather than Prisma's
 * generic "Unable to start a transaction in the given time." `timeout` covers
 * the whole catalog write; the seed stays a single transaction, so the catalog
 * is still all-or-nothing.
 */
export const CATALOG_SEED_TRANSACTION_OPTIONS: { maxWait: number; timeout: number } = {
  maxWait: 15_000,
  timeout: 60_000,
};

/**
 * Upserts category and product rows (plus their ordered image, model-preview
 * and changelog child rows) inside an already-open transaction.
 *
 * Idempotency comes from the repository's stable unique keys: categories and
 * products upsert by their fixture `id` (the fixtures' IDs are also their
 * slugs, which carry the schema's `@unique` constraints), and child rows
 * upsert by the `@@unique([productId, position])` key. Positions beyond the
 * fixture list are pruned, so replaying the seed converges on exactly one row
 * per stable key instead of appending duplicates. Creates always set the
 * fixture `id`, keeping category/product IDs stable across environments.
 *
 * This function never reads or writes customer, order, order-item, download,
 * cart or session records and performs no deletion outside the three catalog
 * child tables.
 */
export async function writeCatalog(
  tx: CatalogTransaction,
  data: CatalogSeedData,
): Promise<void> {
  for (const category of data.categories) {
    const fields = {
      name: category.name,
      slug: category.slug,
      description: category.description,
      icon: categoryIcon(category.icon),
      sortOrder: category.sortOrder,
    };
    await tx.category.upsert({
      where: { id: category.id },
      create: { id: category.id, ...fields },
      update: fields,
    });
  }

  for (const product of data.products) {
    const fields = {
      slug: product.slug,
      title: product.title,
      description: product.description,
      overview: product.overview,
      price: product.price.toFixed(2),
      type: productType(product.type),
      version: product.version,
      features: product.features,
      requirements: product.requirements,
      includedFiles: product.includedFiles,
      installation: product.installation,
      documentationSummary: product.documentation.summary,
      documentationTopics: product.documentation.topics,
      license: product.license,
      releasedAt: new Date(`${product.releasedAt}T00:00:00.000Z`),
      isFeatured: product.isFeatured,
      isNew: product.isNew,
      published: product.published,
      sortOrder: product.sortOrder,
      categoryId: product.categoryId,
    };

    await tx.product.upsert({
      where: { id: product.id },
      create: { id: product.id, ...fields },
      update: fields,
    });

    await tx.productImage.deleteMany({
      where: { productId: product.id, position: { gte: product.images.length } },
    });
    for (const [position, src] of product.images.entries()) {
      const imageFields = { src, altText: null };
      await tx.productImage.upsert({
        where: { productId_position: { productId: product.id, position } },
        create: { productId: product.id, position, ...imageFields },
        update: imageFields,
      });
    }

    const modelPreviews = product.modelPreviews ?? [];
    await tx.productModelPreview.deleteMany({
      where: { productId: product.id, position: { gte: modelPreviews.length } },
    });
    for (const [position, preview] of modelPreviews.entries()) {
      const previewFields = {
        src: preview.src,
        label: preview.label,
        description: preview.description,
      };
      await tx.productModelPreview.upsert({
        where: { productId_position: { productId: product.id, position } },
        create: { productId: product.id, position, ...previewFields },
        update: previewFields,
      });
    }

    await tx.productChangelogEntry.deleteMany({
      where: { productId: product.id, position: { gte: product.changelog.length } },
    });
    for (const [position, entry] of product.changelog.entries()) {
      const changelogFields = {
        version: entry.version,
        date: new Date(`${entry.date}T00:00:00.000Z`),
        notes: entry.notes,
      };
      await tx.productChangelogEntry.upsert({
        where: { productId_position: { productId: product.id, position } },
        create: { productId: product.id, position, ...changelogFields },
        update: changelogFields,
      });
    }
  }
}

/**
 * Seeds only the marketplace catalog — categories, products, and their images,
 * model previews, and changelog entries — in a single database transaction.
 *
 * This is the production-safe seed: unlike `seedMarketplace` it never creates
 * the demo customer, orders, order items, or download records. It is safe to
 * run repeatedly and safe to run on a database that already holds real
 * customer/account data, because it touches nothing outside the catalog
 * tables.
 */
export async function seedCatalog(
  prisma: PrismaClient,
  data: CatalogSeedData = buildCatalogSeedData(),
): Promise<CatalogSeedSummary> {
  // The budget is passed per call (rather than relying on the client's
  // `transactionOptions` defaults) so both the CLI runner and the tests see the
  // same explicit values. Prisma 7 requires both keys to be present.
  await prisma.$transaction(
    async (tx) => {
      await writeCatalog(tx, data);
    },
    CATALOG_SEED_TRANSACTION_OPTIONS,
  );

  return {
    categories: data.categories.length,
    products: data.products.length,
    productImages: data.products.reduce(
      (total, product) => total + product.images.length,
      0,
    ),
    productModelPreviews: data.products.reduce(
      (total, product) => total + (product.modelPreviews?.length ?? 0),
      0,
    ),
    changelogEntries: data.products.reduce(
      (total, product) => total + product.changelog.length,
      0,
    ),
  };
}
