# PR #14 — Make the Categories destination as fast as `/products`

Follow-up to the `/products` catalog caching work. `/products` felt fast because
its catalog reads are served from a shared server-side cache; the Categories
destination still paid two uncached database round trips on every request.

## Where "Categories" lives

There is no `/categories` route in this repository. Every Categories link
(header, footer, hero, final call-to-action, and the homepage card grid) points
at `/#categories`, the `id="categories"` section rendered by
`src/components/sections/CategoriesSection.tsx` on the homepage
(`src/app/page.tsx`). Optimizing the Categories destination therefore means
optimizing the homepage's server reads, without changing navigation or UI.

## Root cause

`src/app/page.tsx` awaited both of its catalog reads through the **uncached**
data-access layer on every request:

```tsx
const [categories, featuredProducts] = await Promise.all([
  listCategories(),                    // category.findMany
  listProducts({ featuredOnly: true }), // product.findMany + category/images/modelPreviews/changelog
]);
```

`/products` (the already-optimized route) instead reads
`getCachedCategories()` / `getCachedProducts()` from
`src/lib/server/catalog-cache.ts`, which are `unstable_cache` entries tagged
`catalog` with a 60-second revalidation window.

Two consequences, which together explain the ~1–2 second load:

1. **Two remote round trips per request, plus per-request connection setup.**
   When `DATABASE_URL` is configured, `listCategories`/`listProducts` run Prisma
   queries against the remote PostgreSQL (Neon) instance. The runtime pool is
   deliberately small and short-lived (`max: 1`,
   `connectionTimeoutMillis: 5_000`, `idleTimeoutMillis: 30_000` in
   `src/lib/server/database.ts`), so a cold function pays connect + query
   latency, and the homepage paid it again for the second read.
2. **Nothing was reusable between routes or requests.** Both reads also ran for
   every request even though the public catalog is identical for every visitor
   and only changes on a seed or a product-management write.

The homepage is `await connection()`-dynamic (it must be), so the previous fix
for `/products` — cache the catalog reads, keep the render dynamic — applies
directly.

## What changed

Only the homepage's read path and its cache documentation:

| File                                | Change                                                                                                                                             |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/app/page.tsx`                  | Reads `getCachedCategories()` and `getCachedProducts()` in the existing `Promise.all`, still after `await connection()`. Featured products are selected with `products.filter((product) => product.isFeatured)` — same order, no mutation of the shared array. |
| `src/lib/server/catalog-cache.ts`   | Comment accuracy: the module now documents the homepage/`/#categories` reader, request-triggered stale-while-revalidate semantics, and the immediate `updateTag` path. No key, tag, or TTL changes. |
| `tests/catalog-cache.test.mjs`      | Guards the wiring: the homepage must use both cached readers and must not import the uncached data-access layer; both entries must keep the shared `catalog` tag, their existing keys, and the 60-second revalidation; every successful product write must keep expiring the tag. |

Nothing else changed: no route was added, no UI or design token changed, and
authentication, staff access, checkout, payments, download handling, cart
behavior, and the database schema are untouched.

**No loading UI was added.** The blocking read is now served from cache, so a
fallback would not improve perceived performance here; the only segment
boundary available would be a root `src/app/loading.tsx` that replaces the
homepage hero (and every other route) with a skeleton on navigation — broader
than this change. `/products` keeps its existing `loading.tsx`.

## Cache behavior (revalidation and invalidation)

Both entries live in Next.js' persistent Data Cache and keep the existing
strategy:

- **Tag:** `CATALOG_CACHE_TAG = "catalog"`, shared by the products and
  categories entries.
- **Revalidation window:** `CATALOG_REVALIDATE_SECONDS = 60`. When an entry is
  older than 60 seconds, the next request may be served the stale value while a
  refresh runs in the background (stale-while-revalidate), matching the
  `/products` behavior. If a background refresh fails, the stale entry can
  continue to be served — the window is not a hard freshness guarantee for
  out-of-band changes such as a catalog seed.
- **Immediate invalidation:** every successful product-management write
  (`src/lib/server/product-admin-actions.ts`) still calls
  `updateTag(CATALOG_CACHE_TAG)` before redirecting, so creates, edits,
  publish/unpublish, and deletes expire *both* entries at once. Because
  `updateTag` (not `revalidateTag`) is used, the next-read waits for fresh data
  rather than serving the stale catalog.
- **No private data is cached.** Only the public catalog readers are wrapped;
  customer-scoped reads (orders, downloads, cart, sessions) remain uncached and
  per-request, and `/manage` continues to read through the staff-scoped admin
  service, never this cache.
- Because both routes now call the same two readers, a warm entry serves the
  homepage, `/#categories`, and `/products` alike (and a prefetch of one warms
  the other).

## Validation

Run with `DATABASE_URL` **empty** (fixture catalog, no database connection of
any kind):

| Check                     | Command             | Result                                                                |
| ------------------------- | ------------------- | --------------------------------------------------------------------- |
| Lint                      | `npm run lint`      | Pass (no output)                                                      |
| Typecheck                 | `npm run typecheck` | Pass (`next typegen && tsc --noEmit`)                                  |
| Tests                     | `npm test`          | Pass — 150/150                                                        |
| Production build          | `npm run build`     | Pass — 19/19 static pages generated; `/` and `/products` stay dynamic (`ƒ`) |

Runtime smoke test against the production build (`next start`, fixtures, no
database): `/` and `/products?category=systems` both return `200`, the
`id="categories"` section renders all eight category cards, and the Data Cache
holds exactly **two** entries after repeated requests to both routes with
different `?q=`/`?category=`/`?sort=` combinations — the products and categories
bodies, shared rather than duplicated. With fixture data there is no network
latency to remove locally, so the ~1–2 second improvement can only be confirmed
on a deployment with a configured remote `DATABASE_URL`; no production database
was contacted to measure it.

> Sandbox note: this environment cannot reach `binaries.prisma.sh`, so
> `prisma generate` was run with `PRISMA_SCHEMA_ENGINE_BINARY` pointed at a stub
> path. The `prisma-client` generator requires no engine (the driver-adapter
> client uses the bundled WASM query compiler), generation succeeded normally,
> and the workaround is neither committed nor needed in CI/deployment.
