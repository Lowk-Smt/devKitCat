/**
 * Shared catalog types for devKitCat.
 *
 * These shapes are intentionally future-friendly: later PRs can extend them
 * (e.g. reviews, downloads, related products) without rewriting the mock data.
 */

/** Names of the inline SVG icons available app-wide. */
export type IconName =
  | "systems"
  | "ui-kits"
  | "3d-assets"
  | "vfx"
  | "audio"
  | "developer-tools"
  | "templates"
  | "complete-kits"
  | "production"
  | "reuse"
  | "quality"
  | "docs"
  | "arrow-right"
  | "menu"
  | "close"
  | "cart"
  | "search"
  | "check"
  | "trash";

/** Deliverable format of a product. */
export type ProductType =
  "system" | "ui-kit" | "starter-kit" | "model-pack" | "vfx-pack";

export interface ChangelogEntry {
  version: string;
  date: string;
  notes: string;
}

/** Where a product's documentation lives and what it covers. */
export interface ProductDocumentation {
  summary: string;
  /** Topics covered by the bundled documentation. */
  topics: string[];
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  description: string;
  icon: IconName;
}

export interface Product {
  id: string;
  title: string;
  slug: string;
  /** Short summary used on cards, in search, and as the detail-page lede. */
  description: string;
  /** Longer overview copy for the detail page, one entry per paragraph. */
  overview: string[];
  /** Slug of the category this product belongs to. */
  category: string;
  /** Price in USD. */
  price: number;
  /**
   * Image paths for the product gallery (first image is the card preview).
   * Empty for now — products fall back to the placeholder artwork until real
   * assets are added.
   */
  images: string[];
  type: ProductType;
  version: string;
  features: string[];
  requirements: string[];
  includedFiles: string[];
  /** Ordered installation steps. */
  installation: string[];
  documentation: ProductDocumentation;
  /** Newest entry first. */
  changelog: ChangelogEntry[];
  license: string;
  /** ISO date (YYYY-MM-DD) of first release; drives "Newest" sorting. */
  releasedAt: string;
  isFeatured: boolean;
  isNew: boolean;
}
