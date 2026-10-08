import "server-only";
import { createTelegramLinkService } from "./telegram-link-service";
import { getDatabaseClient } from "./database";

/**
 * Next.js wiring for the order <-> Telegram connection, mirroring
 * `src/lib/server/cart.ts`: one service instance per warm server process, built
 * on the shared Prisma client provider. Without `DATABASE_URL` the service
 * reports itself unavailable; link issuing and the webhook then degrade to
 * safe refusals instead of errors.
 */
export const telegramLinks = createTelegramLinkService(getDatabaseClient);

/** True when a PostgreSQL database is configured to hold connections. */
export function isTelegramLinkServiceAvailable(): boolean {
  return telegramLinks.isAvailable();
}
