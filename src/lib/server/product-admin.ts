import "server-only";
import { getDatabaseClient } from "./database";
import { createProductAdminService } from "./product-admin-service";

/**
 * Wiring for the protected product-management service.
 *
 * It shares the one Prisma client provider used by authentication, the catalog,
 * and the cart, so a request never opens a second pool. Nothing here is cached:
 * these reads include unpublished drafts and must reflect a grant that was
 * revoked a moment ago.
 */
export const productAdmin = createProductAdminService(getDatabaseClient);

/** False when no database is configured, so no management write is possible. */
export function isProductAdminAvailable(): boolean {
  return productAdmin.isAvailable();
}
