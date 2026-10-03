import type { Product } from "./index";

/** The order states already represented by the customer-facing demo UI. */
export type OrderStatus = "complete" | "processing" | "refunded";

/** Delivery remains disabled in the frontend; this is a display-only state. */
export type DownloadStatus = "coming-soon";

export interface CustomerRecord {
  id: string;
  email: string;
  name: string;
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
