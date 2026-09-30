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
  | "close";

/** Deliverable format of a product. */
export type ProductType =
  | "system"
  | "ui-kit"
  | "starter-kit"
  | "model-pack"
  | "vfx-pack";

export interface ChangelogEntry {
  version: string;
  date: string;
  notes: string;
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
  description: string;
  /** Slug of the category this product belongs to. */
  category: string;
  /** Price in USD. */
  price: number;
  /**
   * Image paths for the product gallery.
   * Empty for now — real assets are added in a later PR.
   */
  images: string[];
  type: ProductType;
  version: string;
  features: string[];
  requirements: string[];
  includedFiles: string[];
  changelog: ChangelogEntry[];
  license: string;
  isFeatured: boolean;
  isNew: boolean;
}
