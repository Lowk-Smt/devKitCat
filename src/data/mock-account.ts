import type { Product } from "@/types";
import type { DownloadStatus, OrderStatus } from "@/types/account";

/**
 * Marketplace demo fixtures used as the deterministic database seed input.
 *
 * These records are sample catalog data, not an account experience: the
 * customer below has no password, so it cannot sign in, and no screen reads
 * these values directly any more. Account pages render the authenticated
 * `Customer` and its own orders/downloads instead.
 */
export const mockCustomer = {
  /** Stable demo fixture ID shared with the idempotent database seed. */
  id: "demo-customer",
  name: "Jordan Taylor",
  email: "jordan.taylor@example.test",
  memberSince: "2025-11-08",
  /** Seeded onto the fixture customer so stored preferences are reproducible. */
  preferences: {
    theme: "dark",
    productUpdates: true,
    releaseNotes: false,
  },
} as const;

export type MockOrderStatus = OrderStatus;

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

export type MockDownloadStatus = DownloadStatus;

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
