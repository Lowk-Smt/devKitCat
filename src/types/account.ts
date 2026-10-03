import type { Product } from "./index";

/**
 * The order states the customer-facing UI represents.
 *
 * `pending-payment` is what checkout creates: a submitted order that no payment
 * provider has settled. It is deliberately not one of the settled states, so an
 * unpaid order can never be rendered as a completed purchase.
 */
export type OrderStatus =
  | "pending-payment"
  | "complete"
  | "processing"
  | "refunded";

/** Delivery remains disabled in the frontend; this is a display-only state. */
export type DownloadStatus = "coming-soon";

/** Theme choices offered by the existing account settings screen. */
export type ThemePreference = "dark" | "system";

/** Persisted customer preferences edited on `/account/settings`. */
export interface CustomerPreferences {
  theme: ThemePreference;
  productUpdates: boolean;
  releaseNotes: boolean;
}

/**
 * The safe customer view shared with Server Components. It intentionally omits
 * the password digest, session tokens, and every other credential field.
 */
export interface CustomerRecord {
  id: string;
  email: string;
  name: string;
  preferences: CustomerPreferences;
  createdAt: Date;
  updatedAt: Date;
}

export interface ResolvedOrderItem {
  productId: Product["id"];
  version: string;
  /** Historical unit price in the order currency. */
  price: number;
  quantity: number;
  product: Product;
  categoryName: string;
}

export interface ResolvedOrder {
  id: string;
  date: string;
  status: OrderStatus;
  total: number;
  currency: string;
  items: ResolvedOrderItem[];
}

export interface ResolvedDownload {
  product: Product;
  categoryName: string;
  version: string;
  fileCount: number;
  lastUpdated: string;
  status: DownloadStatus;
}
