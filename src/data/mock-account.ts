import { getCategoryBySlug } from "@/data/categories";
import { products } from "@/data/products";
import type { Product } from "@/types";

/**
 * Customer-area fixtures for the frontend milestone.
 * These records are local demo data only; they are not authenticated, paid,
 * persisted, or connected to file delivery.
 */
export const mockCustomer = {
  name: "Jordan Taylor",
  email: "jordan.taylor@example.test",
  initials: "JT",
  memberSince: "2025-11-08",
  preferences: {
    theme: "dark",
    productUpdates: true,
    releaseNotes: false,
  },
} as const;

export type MockOrderStatus = "complete" | "processing" | "refunded";

export interface MockOrderItem {
  /** References `Product.id` in the existing marketplace catalog. */
  productId: Product["id"];
  /** Version captured at the time of the demo purchase. */
  version: string;
  /** Historical unit price in USD. */
  price: number;
  quantity: number;
}

export interface MockOrder {
  id: string;
  date: string;
  status: MockOrderStatus;
  total: number;
  items: MockOrderItem[];
}

export const mockOrders: readonly MockOrder[] = [
  {
    id: "DKC-2026-0918-10482",
    date: "2026-09-18",
    status: "complete",
    total: 23.98,
    items: [
      { productId: "prosave", version: "1.4.2", price: 14.99, quantity: 1 },
      {
        productId: "vfx-starter-pack",
        version: "1.3.1",
        price: 8.99,
        quantity: 1,
      },
    ],
  },
  {
    id: "DKC-2026-0804-10296",
    date: "2026-08-04",
    status: "complete",
    total: 14.98,
    items: [
      {
        productId: "cozy-furniture-pack",
        version: "1.0.3",
        price: 7.99,
        quantity: 1,
      },
      {
        productId: "camping-props-pack",
        version: "1.1.0",
        price: 6.99,
        quantity: 1,
      },
    ],
  },
  {
    id: "DKC-2026-0612-09741",
    date: "2026-06-12",
    status: "complete",
    total: 9.99,
    items: [
      {
        productId: "roblox-ui-starter-kit",
        version: "2.1.0",
        price: 9.99,
        quantity: 1,
      },
    ],
  },
];

export type MockDownloadStatus = "coming-soon";

export interface MockDownloadRecord {
  /** References `Product.id` in the existing marketplace catalog. */
  productId: Product["id"];
  status: MockDownloadStatus;
}

/**
 * These are library entries, not file permissions. Download buttons remain
 * disabled throughout the UI until a future authorized delivery service exists.
 */
export const mockDownloadRecords: readonly MockDownloadRecord[] = [
  { productId: "prosave", status: "coming-soon" },
  { productId: "vfx-starter-pack", status: "coming-soon" },
  { productId: "cozy-furniture-pack", status: "coming-soon" },
  { productId: "camping-props-pack", status: "coming-soon" },
  { productId: "roblox-ui-starter-kit", status: "coming-soon" },
];

export interface ResolvedOrderItem extends MockOrderItem {
  product: Product;
  categoryName: string;
}

export interface ResolvedOrder extends Omit<MockOrder, "items"> {
  items: ResolvedOrderItem[];
}

export interface ResolvedDownload {
  product: Product;
  categoryName: string;
  version: string;
  fileCount: number;
  lastUpdated: string;
  status: MockDownloadStatus;
}

function resolveProduct(productId: Product["id"]): Product | undefined {
  return products.find((product) => product.id === productId);
}

function resolveOrder(order: MockOrder): ResolvedOrder | undefined {
  const items: ResolvedOrderItem[] = [];

  for (const item of order.items) {
    const product = resolveProduct(item.productId);
    const category = product ? getCategoryBySlug(product.category) : undefined;
    if (!product || !category) return undefined;
    items.push({ ...item, product, categoryName: category.name });
  }

  return { ...order, items };
}

/** Read-only presentation of the centralized demo order fixtures. */
export function getMockOrders(): ResolvedOrder[] {
  return mockOrders.flatMap((order) => {
    const resolved = resolveOrder(order);
    return resolved ? [resolved] : [];
  });
}

/** Returns undefined for an unknown ID or an invalid catalog reference. */
export function getMockOrderById(orderId: string): ResolvedOrder | undefined {
  const order = mockOrders.find((entry) => entry.id === orderId);
  return order ? resolveOrder(order) : undefined;
}

/**
 * Builds the download-library view from product IDs and the existing catalog.
 * Title, category, version, file count, and last-updated date are not copied
 * into a second product catalogue.
 */
export function getMockDownloads(): ResolvedDownload[] {
  return mockDownloadRecords.flatMap((record) => {
    const product = resolveProduct(record.productId);
    const category = product ? getCategoryBySlug(product.category) : undefined;
    if (!product || !category) return [];

    return [
      {
        product,
        categoryName: category.name,
        version: product.version,
        fileCount: product.includedFiles.length,
        lastUpdated: product.changelog[0]?.date ?? product.releasedAt,
        status: record.status,
      },
    ];
  });
}

/**
 * Presentation-only session fixture. This value is intentionally fixed and
 * has no login, logout, storage, token, or access-control behavior.
 */
export const mockAccountPresentation = {
  status: "demo-signed-in" as const,
  customer: mockCustomer,
};
