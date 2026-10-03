import type { Product } from "./index";

/** The order states already represented by the customer-facing demo UI. */
export type OrderStatus = "complete" | "processing" | "refunded";

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
