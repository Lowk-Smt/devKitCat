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
  | "trash"
  | "rotate-left"
  | "rotate-right"
  | "zoom-in"
  | "zoom-out"
  | "wireframe";

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

/** Public/static preview media, not a downloadable product file. */
export interface ProductModelPreview {
  /** Local path or HTTP(S) URL ending in .glb or .gltf. */
  src: string;
  /** Short name for gallery selection. */
  label: string;
  /** Text alternative describing the model, also shown below the viewer. */
  description: string;
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
  /** Image paths for the gallery; the first image remains the card preview. */
  images: string[];
  /** Optional interactive previews. Products without media keep their artwork. */
  modelPreviews?: ProductModelPreview[];
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
