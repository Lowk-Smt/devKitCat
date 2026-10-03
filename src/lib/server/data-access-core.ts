import "server-only";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { Category, Product } from "@/types";
import type { OrderStatus, ResolvedDownload, ResolvedOrder } from "@/types/account";

export const PRODUCT_INCLUDE = {
  category: true,
  images: { orderBy: { position: "asc" } },
  modelPreviews: { orderBy: { position: "asc" } },
  changelog: { orderBy: { position: "asc" } },
} satisfies Prisma.ProductInclude;

export const ORDER_INCLUDE = {
  items: {
    orderBy: { position: "asc" },
    include: { product: { include: PRODUCT_INCLUDE } },
  },
} satisfies Prisma.OrderInclude;

export const DOWNLOAD_INCLUDE = {
  product: { include: PRODUCT_INCLUDE },
  orderItem: true,
} satisfies Prisma.DownloadInclude;

type CategoryRecord = Prisma.CategoryGetPayload<{
  select: {
    id: true;
    name: true;
    slug: true;
    description: true;
    icon: true;
  };
}>;
type ProductRecord = Prisma.ProductGetPayload<{
  include: typeof PRODUCT_INCLUDE;
}>;
type OrderRecord = Prisma.OrderGetPayload<{ include: typeof ORDER_INCLUDE }>;
type DownloadRecord = Prisma.DownloadGetPayload<{
  include: typeof DOWNLOAD_INCLUDE;
}>;

/**
 * Offline fixtures for the public marketplace only. Customer account data has
 * no fixture fallback: it is reachable exclusively through an authenticated
 * session (see `src/lib/server/auth.ts`).
 */
export interface DataAccessFallbacks {
  products: readonly Product[];
  categories: readonly Category[];
}

export interface ProductListOptions {
  featuredOnly?: boolean;
}

export interface MarketplaceDataAccess {
  listProducts(options?: ProductListOptions): Promise<Product[]>;
  getProductBySlug(slug: string): Promise<Product | undefined>;
  getProductById(id: string): Promise<Product | undefined>;
  listCategories(): Promise<Category[]>;
  /** Orders belonging to one customer; `customerId` comes from the session. */
  listCustomerOrders(customerId: string): Promise<ResolvedOrder[]>;
  /**
   * A single order only when it belongs to `customerId`. Ownership is part of
   * the query, so a URL ID for somebody else's order resolves to `undefined`.
   */
  getCustomerOrderById(
    customerId: string,
    orderId: string,
  ): Promise<ResolvedOrder | undefined>;
  listCustomerDownloads(customerId: string): Promise<ResolvedDownload[]>;
  getRelatedProducts(
    product: Pick<Product, "id" | "category">,
    limit?: number,
  ): Promise<{ items: Product[]; sameCategory: boolean }>;
}

export class DataAccessError extends Error {
  constructor(resource: string) {
    super(`Unable to load ${resource} right now. Please try again later.`);
    this.name = "DataAccessError";
  }
}

export type DataAccessLogger = (resource: string, code: string) => void;

const PRODUCT_TYPE_MAP: Record<ProductRecord["type"], Product["type"]> = {
  SYSTEM: "system",
  UI_KIT: "ui-kit",
  STARTER_KIT: "starter-kit",
  MODEL_PACK: "model-pack",
  VFX_PACK: "vfx-pack",
};

const CATEGORY_ICON_MAP: Record<CategoryRecord["icon"], Category["icon"]> = {
  SYSTEMS: "systems",
  UI_KITS: "ui-kits",
  ASSETS_3D: "3d-assets",
  VFX: "vfx",
  AUDIO: "audio",
  DEVELOPER_TOOLS: "developer-tools",
  TEMPLATES: "templates",
  COMPLETE_KITS: "complete-kits",
};

/**
 * `PENDING_PAYMENT` is what checkout creates: a submitted order that no payment
 * provider has settled. It renders as its own status so an unpaid order is never
 * mistaken for a completed purchase.
 */
const ORDER_STATUS_MAP: Record<string, OrderStatus> = {
  COMPLETE: "complete",
  PROCESSING: "processing",
  REFUNDED: "refunded",
  PENDING_PAYMENT: "pending-payment",
};

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Display icon for a database category. Exported so the cart read can reuse the
 * catalog's mapping instead of keeping a second copy of it.
 */
export function mapCategoryIcon(icon: CategoryRecord["icon"]): Category["icon"] {
  return CATEGORY_ICON_MAP[icon];
}

function mapCategory(category: CategoryRecord): Category {
  return {
    id: category.id,
    name: category.name,
    slug: category.slug,
    description: category.description,
    icon: mapCategoryIcon(category.icon),
  };
}

function mapProduct(record: ProductRecord): Product {
  const price = Number(record.price);
  if (!Number.isFinite(price)) {
    throw new Error("The database returned an invalid product price.");
  }

  return {
    id: record.id,
    slug: record.slug,
    title: record.title,
    description: record.description,
    overview: record.overview,
    category: record.category.slug,
    price,
    images: record.images.map((image) => image.src),
    modelPreviews: record.modelPreviews.map((preview) => ({
      src: preview.src,
      label: preview.label,
      description: preview.description,
    })),
    type: PRODUCT_TYPE_MAP[record.type],
    version: record.version,
    features: record.features,
    requirements: record.requirements,
    includedFiles: record.includedFiles,
    installation: record.installation,
    documentation: {
      summary: record.documentationSummary,
      topics: record.documentationTopics,
    },
    changelog: record.changelog.map((entry) => ({
      version: entry.version,
      date: isoDate(entry.date),
      notes: entry.notes,
    })),
    license: record.license,
    releasedAt: isoDate(record.releasedAt),
    isFeatured: record.isFeatured,
    isNew: record.isNew,
  };
}

function mapOrder(record: OrderRecord): ResolvedOrder {
  const status = ORDER_STATUS_MAP[record.status];
  if (!status) {
    throw new Error("The database returned an unsupported order status.");
  }

  return {
    id: record.id,
    date: isoDate(record.createdAt),
    status,
    total: Number(record.total),
    currency: record.currency,
    items: record.items.map((item) => {
      const currentProduct = mapProduct(item.product);
      return {
        productId: item.productId,
        version: item.versionAtPurchase,
        price: Number(item.unitPrice),
        quantity: item.quantity,
        categoryName: item.categoryName,
        product: {
          ...currentProduct,
          title: item.productTitle,
          slug: item.productSlug,
          category: item.categorySlug,
          version: item.versionAtPurchase,
        },
      };
    }),
  };
}

function mapDownload(record: DownloadRecord): ResolvedDownload {
  const product = mapProduct(record.product);
  return {
    product,
    categoryName: record.product.category.name,
    version: record.orderItem?.versionAtPurchase ?? product.version,
    fileCount: product.includedFiles.length,
    lastUpdated: product.changelog[0]?.date ?? product.releasedAt,
    // File delivery remains disabled even when a future record is marked ready.
    status: "coming-soon",
  };
}

function getSafeErrorCode(error: unknown): string {
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

function makeRelatedProducts(
  current: Pick<Product, "id" | "category">,
  products: readonly Product[],
  limit: number,
): { items: Product[]; sameCategory: boolean } {
  const others = products.filter((product) => product.id !== current.id);
  const sameCategory = others
    .filter((product) => product.category === current.category)
    .sort((a, b) => Number(b.isFeatured) - Number(a.isFeatured));
  const rest = others
    .filter((product) => product.category !== current.category)
    .sort(
      (a, b) =>
        Number(b.isFeatured) - Number(a.isFeatured) ||
        b.releasedAt.localeCompare(a.releasedAt),
    );

  return {
    items: [...sameCategory, ...rest].slice(0, Math.max(0, limit)),
    sameCategory: sameCategory.length > 0,
  };
}

/**
 * Builds the typed data-access API around a Prisma client provider. Passing no
 * client selects the existing immutable demo fixtures; a configured but
 * unavailable database is reported instead of silently hiding its failure.
 */
export function createMarketplaceDataAccess(
  getClient: () => PrismaClient | null,
  fallback: DataAccessFallbacks,
  logger: DataAccessLogger = (resource, code) => {
    console.error(`[devKitCat database] ${resource} read failed (${code}).`);
  },
): MarketplaceDataAccess {
  async function read<T>(
    resource: string,
    fallbackRead: () => T,
    query: (client: PrismaClient) => Promise<T>,
  ): Promise<T> {
    let client: PrismaClient | null;

    try {
      client = getClient();
      if (!client) return fallbackRead();
      return await query(client);
    } catch (error) {
      logger(resource, getSafeErrorCode(error));
      throw new DataAccessError(resource);
    }
  }

  async function listProducts(
    options: ProductListOptions = {},
  ): Promise<Product[]> {
    return read(
      "products",
      () =>
        fallback.products
          .filter((product) => !options.featuredOnly || product.isFeatured)
          .slice(),
      async (client) => {
        const records = await client.product.findMany({
          where: {
            published: true,
            ...(options.featuredOnly ? { isFeatured: true } : {}),
          },
          include: PRODUCT_INCLUDE,
          orderBy: [{ sortOrder: "asc" }, { slug: "asc" }],
        });
        return records.map(mapProduct);
      },
    );
  }

  async function getProductBySlug(slug: string): Promise<Product | undefined> {
    return read(
      "product",
      () => fallback.products.find((product) => product.slug === slug),
      async (client) => {
        const record = await client.product.findFirst({
          where: { slug, published: true },
          include: PRODUCT_INCLUDE,
        });
        return record ? mapProduct(record) : undefined;
      },
    );
  }

  async function getProductById(id: string): Promise<Product | undefined> {
    return read(
      "product",
      () => fallback.products.find((product) => product.id === id),
      async (client) => {
        const record = await client.product.findFirst({
          where: { id, published: true },
          include: PRODUCT_INCLUDE,
        });
        return record ? mapProduct(record) : undefined;
      },
    );
  }

  async function listCategories(): Promise<Category[]> {
    return read(
      "categories",
      () => fallback.categories.slice(),
      async (client) => {
        const records = await client.category.findMany({
          orderBy: [{ sortOrder: "asc" }, { slug: "asc" }],
        });
        return records.map(mapCategory);
      },
    );
  }

  /**
   * Customer-scoped account reads.
   *
   * `customerId` always comes from a verified session, never from a URL or form
   * value, and ownership is part of every query. Without a configured database
   * there is no session to verify, so these resolve to an empty result instead
   * of reaching for demo fixtures.
   */
  async function listCustomerOrders(
    customerId: string,
  ): Promise<ResolvedOrder[]> {
    return read(
      "customer orders",
      () => [],
      async (client) => {
        const records = await client.order.findMany({
          where: { customerId },
          include: ORDER_INCLUDE,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        });
        return records.map(mapOrder);
      },
    );
  }

  async function getCustomerOrderById(
    customerId: string,
    orderId: string,
  ): Promise<ResolvedOrder | undefined> {
    return read(
      "order",
      () => undefined,
      async (client) => {
        const record = await client.order.findFirst({
          // Both keys are required: an order ID alone must not leak another
          // customer's purchase, so a foreign ID resolves to `undefined`.
          where: { id: orderId, customerId },
          include: ORDER_INCLUDE,
        });
        return record ? mapOrder(record) : undefined;
      },
    );
  }

  async function listCustomerDownloads(
    customerId: string,
  ): Promise<ResolvedDownload[]> {
    return read(
      "customer downloads",
      () => [],
      async (client) => {
        const records = await client.download.findMany({
          where: { customerId },
          include: DOWNLOAD_INCLUDE,
          orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        });
        return records.map(mapDownload);
      },
    );
  }

  async function getRelatedProducts(
    product: Pick<Product, "id" | "category">,
    limit = 3,
  ): Promise<{ items: Product[]; sameCategory: boolean }> {
    return makeRelatedProducts(product, await listProducts(), limit);
  }

  return {
    listProducts,
    getProductBySlug,
    getProductById,
    listCategories,
    listCustomerOrders,
    getCustomerOrderById,
    listCustomerDownloads,
    getRelatedProducts,
  };
}
