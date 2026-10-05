import "server-only";

import { unstable_cache } from "next/cache";

import { listCategories, listProducts } from "./data-access";

/**
 * Cached reads for the **public** marketplace catalog.
 *
 * The homepage (including /#categories) and /products share these entries
 * instead of repeating Prisma round trips on every request. The public catalog
 * is the same for every visitor, so it is safe to cache server-side.
 *
 * This project does not use Cache Components (`cacheComponents` is not
 * enabled), so it reuses `unstable_cache` and Next.js' persistent Data Cache.
 * Entries become stale after 60 seconds; the next request can serve the stale
 * value while refreshing in the background. This is not a hard freshness cap
 * for out-of-band changes such as seeds, especially if a refresh fails.
 * Successful product-management actions already call updateTag(CATALOG_CACHE_TAG)
 * to expire both entries immediately, making the next read wait for fresh data.
 *
 * Customer-scoped reads (orders, downloads, cart) live in
 * `src/lib/server/auth.ts` + `src/lib/server/data-access.ts` and are
 * deliberately NOT wrapped here: they vary per session and must stay private.
 */
export const CATALOG_CACHE_TAG = "catalog";

/** How long a catalog entry stays fresh before request-triggered revalidation. */
export const CATALOG_REVALIDATE_SECONDS = 60;

const CACHE_OPTIONS: { tags: string[]; revalidate: number } = {
  tags: [CATALOG_CACHE_TAG],
  revalidate: CATALOG_REVALIDATE_SECONDS,
};

/** Every published product with the media/detail relations the UI renders. */
export const getCachedProducts = unstable_cache(
  async () => listProducts(),
  ["devkitcat-catalog-products"],
  CACHE_OPTIONS,
);

/** The category list shared by homepage cards and marketplace filter chips. */
export const getCachedCategories = unstable_cache(
  async () => listCategories(),
  ["devkitcat-catalog-categories"],
  CACHE_OPTIONS,
);
