import "server-only";
import { createCartService } from "./cart-service";
import { getDatabaseClient } from "./database";

/**
 * Next.js wiring for the cart, mirroring `src/lib/server/auth.ts`: one service
 * instance per warm server process, built on the shared Prisma client provider.
 *
 * Cart data has the same rule as account data — there is no fixture fallback.
 * Without `DATABASE_URL` the service reports itself unavailable, the signed-in
 * cart cannot exist, and the storefront keeps the browser-local cart it has
 * always had.
 */
export const cart = createCartService(getDatabaseClient);

/** True when a PostgreSQL database is configured to hold carts and orders. */
export function isCartServiceAvailable(): boolean {
  return cart.isAvailable();
}
