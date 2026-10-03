import "server-only";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { Category, Product } from "@/types";
import type {
  CustomerRecord,
  OrderStatus,
  ResolvedDownload,
  ResolvedOrder,
} from "@/types/account";

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
type CustomerRow = Prisma.CustomerGetPayload<{
  select: {
    id: true;
    email: true;
    name: true;
    createdAt: true;
    updatedAt: true;
  };
}>;
type OrderRecord = Prisma.OrderGetPayload<{ include: typeof ORDER_INCLUDE }>;
type DownloadRecord = Prisma.DownloadGetPayload<{
  include: typeof DOWNLOAD_INCLUDE;
}>;

export interface DataAccessFallbacks {
  products: readonly Product[];
  categories: readonly Category[];
  customers: readonly CustomerRecord[];
  orders: readonly { customerId: string; order: ResolvedOrder }[];
  downloads: readonly { customerId: string; download: ResolvedDownload }[];
}

export interface ProductListOptions {
  featuredOnly?: boolean;
}

export interface MarketplaceDataAccess {
  listProducts(options?: ProductListOptions): Promise<Product[]>;
  getProductBySlug(slug: string): Promise<Product | undefined>;
  getProductById(id: string): Promise<Product | undefined>;
  listCategories(): Promise<Category[]>;
  getCustomerByEmail(email: string): Promise<CustomerRecord | undefined>;
  getCustomerById(id: string): Promise<CustomerRecord | undefined>;
  listCustomerOrders(customerId: string): Promise<ResolvedOrder[]>;
  getOrderById(id: string): Promise<ResolvedOrder | undefined>;
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

const ORDER_STATUS_MAP: Record<string, OrderStatus> = {
  COMPLETE: "complete",
  PROCESSING: "processing",
  REFUNDED: "refunded",
};

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function mapCategory(category: CategoryRecord): Category {
  return {
    id: category.id,
    name: category.name,
    slug: category.slug,
    description: category.description,
    icon: CATEGORY_ICON_MAP[category.icon],
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

function mapCustomer(record: CustomerRow): CustomerRecord {
  return {
    id: record.id,
    email: record.email,
    name: record.name,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
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

  async function getCustomerByEmail(
    email: string,
  ): Promise<CustomerRecord | undefined> {
    const normalizedEmail = email.trim().toLocaleLowerCase("en-US");
    return read(
      "customer",
      () =>
        fallback.customers.find(
          (customer) =>
            customer.email.toLocaleLowerCase("en-US") === normalizedEmail,
        ),
      async (client) => {
        const record = await client.customer.findUnique({
          where: { email: normalizedEmail },
        });
        return record ? mapCustomer(record) : undefined;
      },
    );
  }

  async function getCustomerById(id: string): Promise<CustomerRecord | undefined> {
    return read(
      "customer",
      () => fallback.customers.find((customer) => customer.id === id),
      async (client) => {
        const record = await client.customer.findUnique({ where: { id } });
        return record ? mapCustomer(record) : undefined;
      },
    );
  }

  async function listCustomerOrders(
    customerId: string,
  ): Promise<ResolvedOrder[]> {
    return read(
      "customer orders",
      () =>
        fallback.orders
          .filter((entry) => entry.customerId === customerId)
          .map((entry) => entry.order),
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

  async function getOrderById(id: string): Promise<ResolvedOrder | undefined> {
    return read(
      "order",
      () => fallback.orders.find((entry) => entry.order.id === id)?.order,
      async (client) => {
        const record = await client.order.findUnique({
          where: { id },
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
      () =>
        fallback.downloads
          .filter((entry) => entry.customerId === customerId)
          .map((entry) => entry.download),
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
    getCustomerByEmail,
    getCustomerById,
    listCustomerOrders,
    getOrderById,
    listCustomerDownloads,
    getRelatedProducts,
  };
}
