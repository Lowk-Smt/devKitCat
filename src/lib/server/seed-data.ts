import { categories } from "@/data/categories";
import {
  mockCustomer,
  mockDownloadRecords,
  mockOrders,
} from "@/data/mock-account";
import { products } from "@/data/products";
import type { Category, Product } from "@/types";
import type { CustomerPreferences } from "@/types/account";
import type { MockOrderStatus } from "@/data/mock-account";

export interface SeedCategory {
  id: string;
  name: string;
  slug: string;
  description: string;
  icon: Category["icon"];
  sortOrder: number;
}

export interface SeedProduct extends Product {
  categoryId: string;
  sortOrder: number;
  published: true;
}

export interface SeedOrderItem {
  id: string;
  orderId: string;
  productId: string;
  productTitle: string;
  productSlug: string;
  categorySlug: string;
  categoryName: string;
  versionAtPurchase: string;
  unitPrice: number;
  quantity: number;
  position: number;
}

export interface SeedOrder {
  id: string;
  customerId: string;
  status: MockOrderStatus;
  total: number;
  currency: "USD";
  createdAt: Date;
  items: SeedOrderItem[];
}

export interface SeedDownload {
  id: string;
  customerId: string;
  productId: string;
  orderItemKey: string;
  status: "PENDING";
  fileKey: null;
  createdAt: Date;
}

export interface CatalogSeedData {
  categories: SeedCategory[];
  products: SeedProduct[];
}

export interface MarketplaceSeedData extends CatalogSeedData {
  /**
   * Sample customer for the seeded order/download records. It deliberately has
   * no password, so it cannot sign in; register an account to use `/account`.
   */
  customer: {
    id: string;
    email: string;
    name: string;
    preferences: CustomerPreferences;
    createdAt: Date;
  };
  orders: SeedOrder[];
  downloads: SeedDownload[];
}

function atUtcMidnight(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00.000Z`);
}

/**
 * Projects only the catalog fixtures (`src/data/categories.ts` and
 * `src/data/products.ts`) into stable database seeds. IDs are the fixture IDs,
 * ordering is each fixture's array order, and every product is published, so
 * the result is deterministic and safe to replay. No account fixtures are
 * referenced here: this is the projection a catalog-only seed can use.
 */
export function buildCatalogSeedData(): CatalogSeedData {
  const categoryBySlug = new Map(categories.map((category) => [category.slug, category]));

  const seedCategories: SeedCategory[] = categories.map((category, sortOrder) => ({
    ...category,
    sortOrder,
  }));

  const seedProducts: SeedProduct[] = products.map((product, sortOrder) => {
    const category = categoryBySlug.get(product.category);
    if (!category) {
      throw new Error(`Seed product ${product.id} references an unknown category.`);
    }

    return {
      ...product,
      categoryId: category.id,
      sortOrder,
      published: true,
    };
  });

  return { categories: seedCategories, products: seedProducts };
}

/**
 * Projects the current catalog and PR #4 fixtures into stable database seeds.
 * IDs, ordering, snapshots and values come from those existing fixtures.
 */
export function buildMarketplaceSeedData(): MarketplaceSeedData {
  const { categories: seedCategories, products: seedProducts } = buildCatalogSeedData();
  const categoryBySlug = new Map(categories.map((category) => [category.slug, category]));
  const productById = new Map(products.map((product) => [product.id, product]));

  const seedOrders: SeedOrder[] = mockOrders.map((order) => ({
    id: order.id,
    customerId: mockCustomer.id,
    status: order.status,
    total: order.total,
    currency: "USD",
    createdAt: atUtcMidnight(order.date),
    items: order.items.map((item, position) => {
      const product = productById.get(item.productId);
      const category = product ? categoryBySlug.get(product.category) : undefined;
      if (!product || !category) {
        throw new Error(
          `Seed order ${order.id} references an unknown product or category.`,
        );
      }

      return {
        id: `${order.id}:${product.id}`,
        orderId: order.id,
        productId: product.id,
        productTitle: product.title,
        productSlug: product.slug,
        categorySlug: category.slug,
        categoryName: category.name,
        versionAtPurchase: item.version,
        unitPrice: item.price,
        quantity: item.quantity,
        position,
      };
    }),
  }));

  const orderItemByProductId = new Map<string, SeedOrderItem>();
  for (const order of seedOrders) {
    for (const item of order.items) {
      if (!orderItemByProductId.has(item.productId)) {
        orderItemByProductId.set(item.productId, item);
      }
    }
  }

  const orderById = new Map(seedOrders.map((order) => [order.id, order]));
  const downloads: SeedDownload[] = mockDownloadRecords.map((record) => {
    const orderItem = orderItemByProductId.get(record.productId);
    if (!orderItem) {
      throw new Error(
        `Seed download for ${record.productId} has no matching order item.`,
      );
    }

    return {
      id: `${mockCustomer.id}:${record.productId}`,
      customerId: mockCustomer.id,
      productId: record.productId,
      orderItemKey: `${orderItem.orderId}:${orderItem.productId}`,
      status: "PENDING",
      fileKey: null,
      createdAt:
        orderById.get(orderItem.orderId)?.createdAt ??
        atUtcMidnight(mockCustomer.memberSince),
    };
  });

  return {
    customer: {
      id: mockCustomer.id,
      email: mockCustomer.email,
      name: mockCustomer.name,
      preferences: mockCustomer.preferences,
      createdAt: atUtcMidnight(mockCustomer.memberSince),
    },
    categories: seedCategories,
    products: seedProducts,
    orders: seedOrders,
    downloads,
  };
}
