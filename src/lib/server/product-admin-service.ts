import "server-only";
import type {
  Prisma,
  PrismaClient,
  ProductType as PrismaProductType,
} from "@/generated/prisma/client";
import type { ProductType } from "@/types";
import { toPriceCents, priceCentsToDecimalString } from "@/lib/money";
import { hasStaffPrivilege, type StaffAccess, type StaffPrivilege } from "./staff-core";
import {
  PRODUCT_DRAFT_DEFAULTS,
  draftReleaseDate,
  type ManagedProductRow,
  type ProductAdminFailureCode,
  type ProductAdminResult,
  type ProductReferenceCounts,
  type ValidatedProductDraft,
} from "./product-admin-core";

/**
 * The protected product-management writes.
 *
 * These are the only application code paths that can create, change, publish, or
 * remove a `Product` row, and every one of them requires a verified
 * `StaffAccess` value:
 *
 * * the actor is the object `authorizeStaffAction()` resolved from the session —
 *   never a customer id, a role, or a flag from the request;
 * * `authorize()` below re-checks the privilege, so a caller that forgot its own
 *   guard still cannot write;
 * * the reads here intentionally do **not** filter on `published`, which is why
 *   they live in this module and not in `data-access-core.ts`. Public catalog
 *   reads (`listProducts`, `getProductBySlug`, `getProductById`) keep their
 *   `published: true` filter and are unaffected; and this module is never
 *   wrapped in `unstable_cache`, so a draft cannot leak through the shared
 *   catalog cache.
 *
 * There is no fixture fallback: without a database there is nothing to write to,
 * and reporting `UNAVAILABLE` beats pretending a management surface exists.
 */

/** Prisma's unique-violation code is how a duplicate slug shows up. */
const UNIQUE_VIOLATION_CODE = "P2002";
const RECORD_NOT_FOUND_CODE = "P2025";
const FOREIGN_KEY_CONSTRAINT_CODE = "P2003";

const PRODUCT_TYPE_COLUMN: Record<ProductType, PrismaProductType> = {
  system: "SYSTEM",
  "ui-kit": "UI_KIT",
  "starter-kit": "STARTER_KIT",
  "model-pack": "MODEL_PACK",
  "vfx-pack": "VFX_PACK",
};

const PRODUCT_TYPE_FROM_COLUMN: Record<string, ProductType | undefined> = {
  SYSTEM: "system",
  UI_KIT: "ui-kit",
  STARTER_KIT: "starter-kit",
  MODEL_PACK: "model-pack",
  VFX_PACK: "vfx-pack",
};

/** Exactly what the management list renders — including unpublished drafts. */
const MANAGED_PRODUCT_SELECT = {
  id: true,
  slug: true,
  title: true,
  description: true,
  price: true,
  version: true,
  type: true,
  published: true,
  updatedAt: true,
  isFeatured: true,
  isNew: true,
  category: { select: { slug: true, name: true } },
  orderItems: { take: 1, select: { id: true } },
  downloads: { take: 1, select: { id: true } },
  cartItems: { take: 1, select: { id: true } },
} satisfies Prisma.ProductSelect;

type ManagedProductRecord = Prisma.ProductGetPayload<{
  select: typeof MANAGED_PRODUCT_SELECT;
}>;

/**
 * The only delegates product management may use. Typing the transaction this way
 * keeps `customer`, `session`, `order`, and the account tables out of reach of
 * product management at compile time — a management write cannot read a
 * customer's credentials or edit an order, because those delegates do not exist
 * on the object it is handed.
 */
type ProductAdminTransaction = Pick<
  Prisma.TransactionClient,
  "product" | "category" | "orderItem" | "download" | "cartItem"
>;

export interface ProductPublishOutcome {
  productId: string;
  slug: string;
  published: boolean;
  /** False when the product already had the requested state, so nothing was written. */
  changed: boolean;
}

export interface ProductDeleteOutcome {
  deleted: boolean;
}

export interface ProductAdminService {
  /** False when no PostgreSQL database is configured for this deployment. */
  isAvailable(): boolean;
  /** Staff-only catalog read that includes unpublished drafts. */
  listProducts(
    actor: StaffAccess | null,
  ): Promise<ProductAdminResult<ManagedProductRow[]>>;
  createProduct(
    actor: StaffAccess | null,
    draft: ValidatedProductDraft,
  ): Promise<ProductAdminResult<ManagedProductRow>>;
  updateProduct(
    actor: StaffAccess | null,
    productId: string,
    draft: ValidatedProductDraft,
  ): Promise<ProductAdminResult<ManagedProductRow>>;
  setPublished(
    actor: StaffAccess | null,
    productId: string,
    published: boolean,
  ): Promise<ProductAdminResult<ProductPublishOutcome>>;
  deleteProduct(
    actor: StaffAccess | null,
    productId: string,
  ): Promise<ProductAdminResult<ProductDeleteOutcome>>;
}

export type ProductAdminLogger = (resource: string, code: string) => void;

function getSafeErrorCode(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    /^[A-Z0-9_]{2,16}$/.test(error.code)
  ) {
    return error.code;
  }

  return "UNKNOWN";
}

/** The refusal half of `ProductAdminResult`, named once for the gate helpers. */
type ProductAdminFailure = {
  ok: false;
  code: ProductAdminFailureCode;
  references?: ProductReferenceCounts;
};

function failure(
  code: ProductAdminFailureCode,
  references?: ProductReferenceCounts,
): ProductAdminFailure {
  return references ? { ok: false, code, references } : { ok: false, code };
}

/** `DECIMAL(10, 2)` back through the same parser the cart uses, never a float. */
function decimalToText(value: unknown): string {
  const cents = toPriceCents(value);
  if (cents === null) throw new Error("The database returned an invalid product price.");

  return priceCentsToDecimalString(cents);
}

function mapManagedProduct(record: ManagedProductRecord): ManagedProductRow {
  const type = PRODUCT_TYPE_FROM_COLUMN[record.type];
  if (!type) throw new Error("The database returned an unsupported product type.");

  return {
    id: record.id,
    slug: record.slug,
    title: record.title,
    description: record.description,
    price: decimalToText(record.price),
    version: record.version,
    type,
    categorySlug: record.category.slug,
    categoryName: record.category.name,
    published: record.published,
    updatedAt: record.updatedAt,
    referenced:
      record.orderItems.length > 0 ||
      record.downloads.length > 0 ||
      record.cartItems.length > 0,
  };
}

/** The write payload shared by create and update. `published` is never here. */
function draftData(draft: ValidatedProductDraft, categoryId: string) {
  return {
    title: draft.title,
    description: draft.description,
    price: draft.price,
    type: PRODUCT_TYPE_COLUMN[draft.type],
    version: draft.version,
    categoryId,
    overview: PRODUCT_DRAFT_DEFAULTS.overview,
    features: PRODUCT_DRAFT_DEFAULTS.features,
    requirements: PRODUCT_DRAFT_DEFAULTS.requirements,
    includedFiles: PRODUCT_DRAFT_DEFAULTS.includedFiles,
    installation: PRODUCT_DRAFT_DEFAULTS.installation,
    documentationSummary: PRODUCT_DRAFT_DEFAULTS.documentationSummary,
    documentationTopics: PRODUCT_DRAFT_DEFAULTS.documentationTopics,
    license: PRODUCT_DRAFT_DEFAULTS.license,
  };
}

export interface ProductAdminServiceOptions {
  /** Injectable for tests; production uses the current month's first day. */
  now?: () => Date;
}

/**
 * Builds the protected product-management service around a Prisma client
 * provider, exactly like the auth and cart services.
 */
export function createProductAdminService(
  getClient: () => PrismaClient | null,
  logger: ProductAdminLogger = (resource, code) => {
    console.error(`[devKitCat product management] ${resource} failed (${code}).`);
  },
  options: ProductAdminServiceOptions = {},
): ProductAdminService {
  function resolveClient(): PrismaClient | null {
    try {
      return getClient();
    } catch {
      logger("database configuration", "INVALID_DATABASE_URL");
      return null;
    }
  }

  function isAvailable(): boolean {
    return resolveClient() !== null;
  }

  /**
   * The authorization gate. `actor` is the only input it reads, and it is always
   * the session-derived `StaffAccess`; a null actor (signed out, or an ordinary
   * customer) and an actor missing the privilege are both refused before any
   * query runs.
   */
  function authorize(
    actor: StaffAccess | null,
    privilege: StaffPrivilege,
  ): { client: PrismaClient } | ProductAdminFailure {
    const client = resolveClient();
    if (!client) return failure("UNAVAILABLE");
    if (!actor || typeof actor.customerId !== "string" || actor.customerId.length === 0) {
      return failure("UNAUTHENTICATED");
    }
    if (!hasStaffPrivilege(actor, privilege)) return failure("FORBIDDEN");

    return { client };
  }

  function isUsableProductId(value: string): boolean {
    return typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value);
  }

  async function listProducts(
    actor: StaffAccess | null,
  ): Promise<ProductAdminResult<ManagedProductRow[]>> {
    const gate = authorize(actor, "products:view");
    if ("ok" in gate) return gate;

    try {
      const records = await gate.client.product.findMany({
        // No `published` filter: this is the staff view of drafts *and* live
        // products. It is reachable only behind `products:view`.
        select: MANAGED_PRODUCT_SELECT,
        orderBy: [{ published: "asc" }, { updatedAt: "desc" }, { slug: "asc" }],
      });

      return { ok: true, value: records.map(mapManagedProduct) };
    } catch (error) {
      logger("product list read", getSafeErrorCode(error));
      return failure("ERROR");
    }
  }

  async function createProduct(
    actor: StaffAccess | null,
    draft: ValidatedProductDraft,
  ): Promise<ProductAdminResult<ManagedProductRow>> {
    const gate = authorize(actor, "products:manage");
    if ("ok" in gate) return gate;

    try {
      return await gate.client.$transaction(
        async (
          tx: ProductAdminTransaction,
        ): Promise<ProductAdminResult<ManagedProductRow>> => {
          const category = await tx.category.findUnique({
            where: { slug: draft.categorySlug },
            select: { id: true },
          });
          if (!category) return failure("INVALID_CATEGORY");

          const taken = await tx.product.findUnique({
            where: { slug: draft.slug },
            select: { id: true },
          });
          if (taken) return failure("SLUG_TAKEN");

          const created = await tx.product.create({
            data: {
              ...draftData(draft, category.id),
              slug: draft.slug,
              // A new product is always a draft. Publishing is a separate,
              // separately privileged action, so nothing reaches the public
              // catalog without an explicit publish.
              published: false,
              releasedAt: draftReleaseDate(options.now?.()),
              isFeatured: PRODUCT_DRAFT_DEFAULTS.isFeatured,
              isNew: PRODUCT_DRAFT_DEFAULTS.isNew,
              sortOrder: PRODUCT_DRAFT_DEFAULTS.sortOrder,
            },
            select: MANAGED_PRODUCT_SELECT,
          });

          return { ok: true, value: mapManagedProduct(created) };
        },
      );
    } catch (error) {
      const code = getSafeErrorCode(error);
      if (code === UNIQUE_VIOLATION_CODE) return failure("SLUG_TAKEN");

      logger("product create", code);
      return failure("ERROR");
    }
  }

  async function updateProduct(
    actor: StaffAccess | null,
    productId: string,
    draft: ValidatedProductDraft,
  ): Promise<ProductAdminResult<ManagedProductRow>> {
    const gate = authorize(actor, "products:manage");
    if ("ok" in gate) return gate;
    if (!isUsableProductId(productId)) return failure("NOT_FOUND");

    try {
      return await gate.client.$transaction(
        async (
          tx: ProductAdminTransaction,
        ): Promise<ProductAdminResult<ManagedProductRow>> => {
          const existing = await tx.product.findFirst({
            where: { id: productId },
            select: { id: true, slug: true },
          });
          if (!existing) return failure("NOT_FOUND");

          const category = await tx.category.findUnique({
            where: { slug: draft.categorySlug },
            select: { id: true },
          });
          if (!category) return failure("INVALID_CATEGORY");

          if (draft.slug !== existing.slug) {
            const taken = await tx.product.findFirst({
              where: { slug: draft.slug, NOT: { id: existing.id } },
              select: { id: true },
            });
            if (taken) return failure("SLUG_TAKEN");
          }

          const updated = await tx.product.update({
            where: { id: existing.id },
            // `published`, `releasedAt`, and the media relations are not part of
            // this payload: an edit cannot publish, and slug stays the public URL
            // unless staff changed it deliberately.
            data: { ...draftData(draft, category.id), slug: draft.slug },
            select: MANAGED_PRODUCT_SELECT,
          });

          return { ok: true, value: mapManagedProduct(updated) };
        },
      );
    } catch (error) {
      const code = getSafeErrorCode(error);
      if (code === UNIQUE_VIOLATION_CODE) return failure("SLUG_TAKEN");
      if (code === RECORD_NOT_FOUND_CODE) return failure("NOT_FOUND");

      logger("product update", code);
      return failure("ERROR");
    }
  }

  async function setPublished(
    actor: StaffAccess | null,
    productId: string,
    published: boolean,
  ): Promise<ProductAdminResult<ProductPublishOutcome>> {
    const gate = authorize(actor, "products:manage");
    if ("ok" in gate) return gate;
    if (!isUsableProductId(productId)) return failure("NOT_FOUND");

    try {
      const existing = await gate.client.product.findFirst({
        where: { id: productId },
        select: { id: true, slug: true, published: true },
      });
      if (!existing) return failure("NOT_FOUND");

      if (existing.published === published) {
        // Idempotent: a double submit or a second tab reports success without
        // writing, so the notice never claims a change that did not happen.
        return {
          ok: true,
          value: {
            productId: existing.id,
            slug: existing.slug,
            published,
            changed: false,
          },
        };
      }

      const saved = await gate.client.product.update({
        where: { id: existing.id },
        data: { published },
        select: { id: true, slug: true, published: true },
      });

      return {
        ok: true,
        value: {
          productId: saved.id,
          slug: saved.slug,
          published: saved.published,
          changed: true,
        },
      };
    } catch (error) {
      const code = getSafeErrorCode(error);
      if (code === RECORD_NOT_FOUND_CODE) return failure("NOT_FOUND");

      logger("publication change", code);
      return failure("ERROR");
    }
  }

  async function deleteProduct(
    actor: StaffAccess | null,
    productId: string,
  ): Promise<ProductAdminResult<ProductDeleteOutcome>> {
    const gate = authorize(actor, "products:delete");
    if ("ok" in gate) return gate;
    if (!isUsableProductId(productId)) return failure("NOT_FOUND");

    try {
      return await gate.client.$transaction(
        async (
          tx: ProductAdminTransaction,
        ): Promise<ProductAdminResult<ProductDeleteOutcome>> => {
          const existing = await tx.product.findFirst({
            where: { id: productId },
            select: { id: true },
          });
          if (!existing) return failure("NOT_FOUND");

          const [orders, downloads, carts] = await Promise.all([
            tx.orderItem.count({ where: { productId } }),
            tx.download.count({ where: { productId } }),
            tx.cartItem.count({ where: { productId } }),
          ]);

          if (orders + downloads + carts > 0) {
            // Deletion is refused instead of cascading into a customer's purchase
            // history: `OrderItem`/`Download`/`CartItem` are `onDelete: Restrict`,
            // so unpublishing is the supported way to retire a sold product.
            return failure("IN_USE", { orders, downloads, carts });
          }

          await tx.product.delete({ where: { id: existing.id } });

          return { ok: true, value: { deleted: true } };
        },
      );
    } catch (error) {
      const code = getSafeErrorCode(error);
      if (code === RECORD_NOT_FOUND_CODE) return failure("NOT_FOUND");
      // A reference created between the count and the delete is caught by the
      // database's own `Restrict` rule, which means the same refusal.
      if (code === FOREIGN_KEY_CONSTRAINT_CODE) return failure("IN_USE");

      logger("product delete", code);
      return failure("ERROR");
    }
  }

  return {
    isAvailable,
    listProducts,
    createProduct,
    updateProduct,
    setPublished,
    deleteProduct,
  };
}
