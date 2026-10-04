import "server-only";
import { parseBooleanFormField } from "./auth-core";
import type { ManageNoticeCode } from "./staff-core";
import type { ProductType } from "@/types";
import { PRODUCT_TYPE_LABELS } from "@/lib/catalog";
import { MAX_PRICE_CENTS, priceCentsToDecimalString, toPriceCents } from "@/lib/money";

/**
 * Framework-free validation for the minimal protected product-management form.
 *
 * Phase 1 deliberately exposes the smallest useful surface: enough to create a
 * draft, fix its commercial details, publish it, unpublish it, and delete a
 * product that nothing has bought. Media, changelog, documentation, and
 * per-creator ownership are later phases; until then these fields are the only
 * thing anyone can write to a `Product` row through the app.
 *
 * Every rule here is enforced server-side again on every submit — the form is a
 * convenience, not a boundary. There is no field for `published` in the draft
 * form at all: a new product is always created as a draft and publishing is its
 * own explicitly privileged operation, so nothing can be created straight into
 * the public catalog by accident.
 */

export const PRODUCT_TITLE_MIN_LENGTH = 3;
export const PRODUCT_TITLE_MAX_LENGTH = 120;
export const PRODUCT_DESCRIPTION_MIN_LENGTH = 20;
export const PRODUCT_DESCRIPTION_MAX_LENGTH = 2_000;
export const PRODUCT_SLUG_MIN_LENGTH = 2;
export const PRODUCT_SLUG_MAX_LENGTH = 80;
export const PRODUCT_VERSION_MAX_LENGTH = 32;

/** Slugs are the public URL segment, so they stay strict and immutable. */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,31}$/;
const CATEGORY_SLUG_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/** Values the `ProductType` enum accepts, keyed by the app's own labels. */
export const PRODUCT_TYPE_VALUES = Object.keys(PRODUCT_TYPE_LABELS) as ProductType[];

/**
 * Column values a draft needs to satisfy the existing `NOT NULL` schema without
 * inventing marketplace content. They are constants — never form input — so a
 * staff member cannot smuggle, say, a `documentationSummary` past the fields this
 * phase supports.
 */
export const PRODUCT_DRAFT_DEFAULTS = {
  overview: [] as string[],
  features: [] as string[],
  requirements: [] as string[],
  includedFiles: [] as string[],
  installation: [] as string[],
  documentationSummary: "Documentation for this product is still being written.",
  documentationTopics: [] as string[],
  license: "devKitCat Standard License",
  sortOrder: 0,
  isFeatured: false,
  isNew: false,
} as const;

export interface ProductDraftFormInput {
  title: unknown;
  slug: unknown;
  description: unknown;
  price: unknown;
  type: unknown;
  category: unknown;
  version: unknown;
}

export interface ValidatedProductDraft {
  title: string;
  slug: string;
  description: string;
  /** Fixed-point string for the `DECIMAL(10, 2)` column, e.g. `"14.99"`. */
  price: string;
  type: ProductType;
  categorySlug: string;
  version: string;
}

export type ProductFormField =
  | "title"
  | "slug"
  | "description"
  | "price"
  | "type"
  | "category"
  | "version";

export type ProductValidationErrors = Partial<Record<ProductFormField, string>>;

export type ProductValidation<TValue> =
  | { ok: true; value: TValue }
  | { ok: false; errors: ProductValidationErrors };

function readTrimmed(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Collapses runs of whitespace without truncating, so length can be judged. */
function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * Derives a URL-safe slug. Diacritics are folded, everything else non-alphanumeric
 * becomes a separator, and a value that cannot produce at least
 * `PRODUCT_SLUG_MIN_LENGTH` characters is rejected rather than invented.
 */
export function slugifyProductSlug(value: unknown): string | null {
  const slug = readTrimmed(value)
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, PRODUCT_SLUG_MAX_LENGTH);

  if (slug.length < PRODUCT_SLUG_MIN_LENGTH) return null;
  if (!SLUG_PATTERN.test(slug)) return null;

  return slug;
}

/** The `releasedAt` column is a `DATE`; new drafts land on the current month. */
export function draftReleaseDate(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** True when a checkbox-style flag was asked for. Unknown values read as false. */
export function parseProductFlag(value: unknown): boolean {
  return parseBooleanFormField(value);
}

/** Reads a product id out of a form. Only the shape is checked here. */
export function isProductId(value: unknown): value is string {
  const id = readTrimmed(value);
  return id.length > 0 && /^[A-Za-z0-9_-]{1,64}$/.test(id);
}

/** Reads a publication flag; only an explicit truthy value publishes. */
export function parsePublicationFlag(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  const normalized = readTrimmed(value).toLowerCase();
  // An absent or unexpected value never publishes: publishing is the risky
  // direction, so the form must ask for it explicitly.
  return normalized === "publish" || normalized === "true" || normalized === "1";
}

export function validateProductDraftInput(
  input: ProductDraftFormInput,
): ProductValidation<ValidatedProductDraft> {
  const errors: ProductValidationErrors = {};

  const title = collapseWhitespace(readTrimmed(input.title));
  if (title.length < PRODUCT_TITLE_MIN_LENGTH) {
    errors.title = `Enter a product title of at least ${PRODUCT_TITLE_MIN_LENGTH} characters.`;
  } else if (title.length > PRODUCT_TITLE_MAX_LENGTH) {
    errors.title = `Keep the title to ${PRODUCT_TITLE_MAX_LENGTH} characters or fewer.`;
  }

  const slugSource = readTrimmed(input.slug);
  const slug = slugSource.length > 0 ? slugifyProductSlug(slugSource) : slugifyProductSlug(title);
  if (!slug) {
    errors.slug = "Enter a URL slug of letters, numbers, and hyphens (2-80 characters).";
  }

  const description = collapseWhitespace(readTrimmed(input.description));
  if (description.length < PRODUCT_DESCRIPTION_MIN_LENGTH) {
    errors.description = `Describe the product in at least ${PRODUCT_DESCRIPTION_MIN_LENGTH} characters for the marketplace card.`;
  } else if (description.length > PRODUCT_DESCRIPTION_MAX_LENGTH) {
    errors.description = `Keep the description to ${PRODUCT_DESCRIPTION_MAX_LENGTH} characters or fewer.`;
  }

  const priceCents = toPriceCents(readTrimmed(input.price));
  if (priceCents === null || priceCents > MAX_PRICE_CENTS) {
    errors.price = "Enter a price with at most two decimal places.";
  }

  const type = readTrimmed(input.type).toLowerCase() as ProductType;
  if (!PRODUCT_TYPE_VALUES.includes(type)) {
    errors.type = "Choose one of the listed product types.";
  }

  const categorySlug = readTrimmed(input.category).toLocaleLowerCase("en-US");
  if (!CATEGORY_SLUG_PATTERN.test(categorySlug)) {
    errors.category = "Choose an existing category.";
  }

  const version = readTrimmed(input.version);
  if (!VERSION_PATTERN.test(version)) {
    errors.version = "Enter a version such as 1.0.0 (32 characters or fewer).";
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      title,
      slug: slug as string,
      description,
      price: priceCentsToDecimalString(priceCents as number),
      type,
      categorySlug,
      version,
    },
  };
}

export type ProductAdminFailureCode =
  /** `DATABASE_URL` is not configured, so nothing can be read or written. */
  | "UNAVAILABLE"
  /** No verified customer identity reached the service. */
  | "UNAUTHENTICATED"
  /** Authenticated, but not holding the privilege this operation needs. */
  | "FORBIDDEN"
  | "INVALID_TITLE"
  | "INVALID_SLUG"
  | "INVALID_DESCRIPTION"
  | "INVALID_PRICE"
  | "INVALID_TYPE"
  /** The category does not exist, so no product can point at it. */
  | "INVALID_CATEGORY"
  | "INVALID_VERSION"
  /** Another product already owns that slug. */
  | "SLUG_TAKEN"
  /** No product matched the id — including one that was just deleted. */
  | "NOT_FOUND"
  /** Orders, downloads, or carts reference it, so deletion is refused. */
  | "IN_USE"
  | "ERROR";

/**
 * How many purchase, library, and cart records still point at a product. Returned
 * alongside an `IN_USE` refusal so the operator can see what is holding it.
 */
export interface ProductReferenceCounts {
  orders: number;
  downloads: number;
  carts: number;
}

export type ProductAdminResult<TValue> =
  | { ok: true; value: TValue }
  | { ok: false; code: ProductAdminFailureCode; references?: ProductReferenceCounts };

/**
 * The refusal copy an operator sees. It is generic on purpose: the management
 * surface is private, so it confirms nothing about accounts or rows beyond what
 * the operator's own form already knows.
 */
export function describeProductAdminFailure(code: ProductAdminFailureCode): string {
  switch (code) {
    case "UNAVAILABLE":
      return "Product management is unavailable because no database is configured for this deployment.";
    case "UNAUTHENTICATED":
      return "Sign in with an authorized staff account to continue.";
    case "FORBIDDEN":
      return "This change is limited to explicitly authorized staff accounts.";
    case "INVALID_TITLE":
      return "The title is missing or too short.";
    case "INVALID_SLUG":
      return "The slug must be 2-80 lowercase letters, numbers, and single hyphens.";
    case "INVALID_DESCRIPTION":
      return "The description is missing or too long.";
    case "INVALID_PRICE":
      return "The price must be a non-negative amount with at most two decimal places.";
    case "INVALID_TYPE":
      return "The product type is not one devKitCat sells.";
    case "INVALID_CATEGORY":
      return "That category does not exist. Categories are managed by the catalog seed.";
    case "INVALID_VERSION":
      return "The version is missing or malformed.";
    case "SLUG_TAKEN":
      return "Another product already uses that slug.";
    case "NOT_FOUND":
      return "That product no longer exists.";
    case "IN_USE":
      return "This product is referenced by orders, downloads, or carts, so it cannot be deleted. Unpublish it instead.";
    case "ERROR":
      return "The change could not be saved. Nothing was written.";
  }
}

/** Maps a product failure onto the allowlisted `/manage` notice. */
export function productNoticeCode(code: ProductAdminFailureCode): ManageNoticeCode {
  switch (code) {
    case "UNAVAILABLE":
      return "unavailable";
    case "UNAUTHENTICATED":
      return "signed-out";
    case "NOT_FOUND":
      return "not-found";
    case "SLUG_TAKEN":
      return "slug-taken";
    case "IN_USE":
      return "in-use";
    case "INVALID_TITLE":
      return "invalid-title";
    case "INVALID_PRICE":
      return "invalid-price";
    case "INVALID_VERSION":
      return "invalid-version";
    case "INVALID_CATEGORY":
      return "invalid-category";
    case "INVALID_SLUG":
      return "invalid-slug";
    case "INVALID_DESCRIPTION":
      return "invalid-description";
    case "INVALID_TYPE":
      return "invalid-input";
    case "FORBIDDEN":
      return "denied";
    case "ERROR":
      return "error";
  }
}

/**
 * Narrows a validation failure to one allowlisted notice. The first problem in
 * form order wins, which matches how the fields are laid out, and the message is
 * generic because the detail lives in this module rather than in a URL.
 */
export function productValidationNoticeCode(
  errors: ProductValidationErrors,
): ManageNoticeCode {
  if (errors.title) return "invalid-title";
  if (errors.slug) return "invalid-slug";
  if (errors.description) return "invalid-description";
  if (errors.price) return "invalid-price";
  if (errors.type) return "invalid-input";
  if (errors.category) return "invalid-category";
  if (errors.version) return "invalid-version";

  return "invalid-input";
}

/* The management row shape: everything a staff list needs, and no more.
   ------------------------------------------------------------------ */

export interface ManagedProductRow {
  id: string;
  slug: string;
  title: string;
  /** Prefills the edit form; the marketplace card reads the same column. */
  description: string;
  /** `DECIMAL(10, 2)` read back as a fixed-point string; never a float. */
  price: string;
  version: string;
  type: ProductType;
  categorySlug: string;
  categoryName: string;
  published: boolean;
  updatedAt: Date;
  /** True when a purchase, download, or cart line still points at it. */
  referenced: boolean;
}
