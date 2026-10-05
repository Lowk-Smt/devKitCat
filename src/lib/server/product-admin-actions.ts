"use server";

import { revalidatePath, updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { MANAGE_PATH, authorizeStaffAction } from "./staff";
import {
  staffNoticeCode,
  type ManageNoticeCode,
  type StaffFailureCode,
} from "./staff-core";
import { productAdmin } from "./product-admin";
import {
  isProductId,
  parsePublicationFlag,
  productNoticeCode,
  productValidationNoticeCode,
  validateProductDraftInput,
  type ProductAdminFailureCode,
  type ProductValidation,
  type ValidatedProductDraft,
} from "./product-admin-core";
import { CATALOG_CACHE_TAG } from "./catalog-cache";

/**
 * Server Functions behind the protected product-management forms.
 *
 * Each one is a public POST endpoint, so each one re-authorizes before it touches
 * the database — hiding a button is presentation, not protection. The order is
 * fixed, and `tests/staff-authorization.test.mjs` asserts it for every export:
 *
 * 1. `authorizeStaffAction(privilege)` resolves the actor from the verified
 *    session and asks `staff-core.ts` whether that role holds the privilege;
 * 2. only then is any form field read — and only product content. No management
 *    form has a `customerId`, `actorId`, `role`, `privileges`, or `isStaff`
 *    field, and none is read even if a client submits one;
 * 3. the service re-checks the same privilege and performs the write, so a caller
 *    that skipped step 1 still cannot write;
 * 4. the shared catalog cache is dropped and the page re-renders.
 *
 * Prices are no exception to "the client is never trusted": `price` is text that
 * the server validates and normalizes into the `DECIMAL(10, 2)` column, and the
 * storefront keeps computing cart totals from the `Product` row itself.
 */

/** Not exported: a `"use server"` module may only export async functions. */
function draftInputFromForm(
  formData: FormData,
): ProductValidation<ValidatedProductDraft> {
  return validateProductDraftInput({
    title: formData.get("title"),
    slug: formData.get("slug"),
    description: formData.get("description"),
    price: formData.get("price"),
    type: formData.get("type"),
    category: formData.get("category"),
    version: formData.get("version"),
  });
}

/**
 * Expires the public catalog cache after a management write.
 *
 * `updateTag` rather than `revalidateTag`: these run inside a Server Action, and
 * `updateTag` expires the entry immediately instead of serving stale content
 * while it revalidates. That is the difference between "unpublished" meaning
 * "gone from the storefront" and "gone in up to 60 seconds".
 */
function refreshCatalogCache(): void {
  updateTag(CATALOG_CACHE_TAG);
  revalidatePath(MANAGE_PATH);
}

function done(notice: ManageNoticeCode): void {
  refreshCatalogCache();
  redirect(`${MANAGE_PATH}?notice=${notice}`);
}

function refuse(notice: ManageNoticeCode): void {
  // No cache refresh: nothing was written, so there is nothing to re-render
  // beyond this page's own notice.
  redirect(`${MANAGE_PATH}?notice=${notice}`);
}

function refuseProduct(code: ProductAdminFailureCode): void {
  refuse(productNoticeCode(code));
}

function refuseStaff(code: StaffFailureCode): void {
  refuse(staffNoticeCode(code));
}

/** Creates a draft product. A new product is never published by this action. */
export async function createProductDraftAction(formData: FormData): Promise<void> {
  const authorization = await authorizeStaffAction("products:manage");
  if (!authorization.ok) return refuseStaff(authorization.code);

  const validation = draftInputFromForm(formData);
  if (!validation.ok) return refuse(productValidationNoticeCode(validation.errors));

  const created = await productAdmin.createProduct(authorization.value, validation.value);
  if (!created.ok) return refuseProduct(created.code);

  done("created");
}

/** Saves the commercial details of an existing product, draft or published. */
export async function updateProductAction(formData: FormData): Promise<void> {
  const authorization = await authorizeStaffAction("products:manage");
  if (!authorization.ok) return refuseStaff(authorization.code);

  const productId = formData.get("productId");
  if (!isProductId(productId)) return refuseProduct("NOT_FOUND");

  const validation = draftInputFromForm(formData);
  if (!validation.ok) return refuse(productValidationNoticeCode(validation.errors));

  const updated = await productAdmin.updateProduct(
    authorization.value,
    productId,
    validation.value,
  );
  if (!updated.ok) return refuseProduct(updated.code);

  done("updated");
}

/** Publishes or unpublishes one product. This is the only path that sets `published`. */
export async function setProductPublicationAction(formData: FormData): Promise<void> {
  const authorization = await authorizeStaffAction("products:manage");
  if (!authorization.ok) return refuseStaff(authorization.code);

  const productId = formData.get("productId");
  if (!isProductId(productId)) return refuseProduct("NOT_FOUND");

  const published = parsePublicationFlag(formData.get("publish"));

  const result = await productAdmin.setPublished(authorization.value, productId, published);
  if (!result.ok) return refuseProduct(result.code);

  done(result.value.published ? "published" : "unpublished");
}

/**
 * Deletes a product that nothing has bought.
 *
 * The service refuses — and the notice explains — when an order item, a download
 * record, or a cart line still references the row: `onDelete: Restrict` in the
 * schema is what protects a customer's purchase history, and unpublishing is the
 * supported way to retire a product people have bought.
 */
export async function deleteProductAction(formData: FormData): Promise<void> {
  const authorization = await authorizeStaffAction("products:delete");
  if (!authorization.ok) return refuseStaff(authorization.code);

  const productId = formData.get("productId");
  if (!isProductId(productId)) return refuseProduct("NOT_FOUND");

  const result = await productAdmin.deleteProduct(authorization.value, productId);
  if (!result.ok) return refuseProduct(result.code);

  done("deleted");
}
