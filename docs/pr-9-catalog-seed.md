# PR #9 — Catalog-only production seed

This documents the production-safe catalog seed: a separate command that
populates the marketplace catalog (categories, products, and their gallery,
model-preview, and changelog rows) without creating any demo customer, order,
order-item, or download records.

It exists because the production Neon database was initialized with the
committed migrations only (see the manual "Initialize production database"
workflow), and the full demo seed (`npm run db:seed`) must never run against
production: it additionally creates a fixture customer with three sample
orders and five sample downloads.

## What changed

- **`src/lib/server/seed-data.ts`** now exposes `buildCatalogSeedData()`: the
  category/product projection (8 categories, 6 published products) extracted
  from the same fixtures the full demo seed uses
  (`src/data/categories.ts`, `src/data/products.ts`). `buildMarketplaceSeedData()`
  reuses it, so both seeds share one catalog projection and cannot drift.
- **`src/lib/server/seed-catalog.ts`** (new) exposes `writeCatalog()` — the
  category/product/image/model-preview/changelog upsert block, typed to accept
  only the five catalog delegates — and `seedCatalog()`, which runs it in one
  database transaction. It has no code path to the `Customer`, `Session`,
  `CartItem`, `Order`, `OrderItem`, or `Download` tables.
- **`src/lib/server/seed-database.ts`** (`seedMarketplace`, the full demo seed)
  now calls `writeCatalog()` for its catalog portion and then writes the demo
  account records exactly as before. Its inputs, outputs, transaction
  boundaries, and CLI (`npm run db:seed` / `prisma db seed`) are unchanged.
- **`prisma/seed-catalog.ts`** (new) is the catalog-only command entrypoint. It
  validates `DATABASE_URL` *before* loading the generated Prisma client (via
  `prisma/seed-catalog-runner.ts`), so a missing or invalid URL fails with a
  clear message and never opens a connection.
- **`package.json`** adds `npm run db:seed:catalog`.
- **`tests/catalog-seed.test.mjs`** proves (with an instrumented in-memory
  Prisma) that the operation performs zero calls against customer, session,
  cart, order, order-item, and download delegates; that all upserts use the
  established stable unique keys; and that repeated runs converge to identical
  table contents.
- The `prisma.config.ts` `migrations.seed` slot still points at the full demo
  seed for local development. That is deliberate: `prisma db seed` behavior
  must not change.

## Safety properties

- **Idempotent.** Categories and products upsert by their fixture `id` (the
  fixture IDs equal the slugs protected by the schema's `@unique`
  constraints), and child rows upsert by `@@unique([productId, position])`
  with positions beyond the fixture list pruned. Re-running the command
  updates the same rows in place and never appends duplicates.
- **Account data untouched.** No customer, session, cart, order, order-item,
  or download rows are read or written. Existing real customers and their
  purchases are unaffected; `Product` rows are referenced by `OrderItem`,
  `Download`, and `CartItem` with `onDelete: Restrict`, and this seed never
  deletes products anyway.
- **Reads unchanged.** Storefront reads keep using the published-filtered
  queries in `src/lib/server/data-access-core.ts`; all six seeded products are
  `published: true`, so the catalog appears immediately after seeding.
- **Single transaction.** Either the whole catalog write commits or nothing
  does; a failed run leaves no partial catalog. Pool size is one connection,
  matching the existing seed and serverless guidance.
- **No production access from this PR.** The command was not executed against
  any real database as part of this change; the tests use an in-memory client.

## Seeding the production catalog (Neon) after merge

Prerequisites: the committed migrations are already applied to the production
database (they are — via the one-time workflow), and you have the production
connection string from the Neon dashboard.

Exact command, run from a local checkout of the merged code:

```bash
git checkout main && git pull
npm ci
npm run db:generate
DATABASE_URL="<paste the Neon connection string here>" npm run db:seed:catalog
```

Expected output:

```
Seeded catalog: 8 categories and 6 products (1 images, 2 model previews, 6 changelog entries) in 1234 ms.
Customer, order, order-item, and download tables were not written.
```

> Follow-up (see [`pr-10-catalog-seed-timeout-fix.md`](pr-10-catalog-seed-timeout-fix.md)):
> the run reported here still used Prisma's default 5s interactive-transaction
> timeout and failed with `P2028`; the seed now passes an explicit
> `{ maxWait: 15_000, timeout: 60_000 }` budget, prints the elapsed time, and
> reports failures with a sanitized code/message/metadata/hint block instead of
> a bare error code. Everything else in this document still applies.

Doing this without exposing credentials:

1. **Never commit the URL.** `.env*` files (except `.env.example`) are
   gitignored. Passing the value inline as above keeps it out of files, but it
   will appear in your shell history — prefer `read -s DATABASE_URL` /
   `export DATABASE_URL` if that matters on your machine.
2. **Either Neon endpoint form works** for this seed. The pooled
   (`-pooler`) connection string that Vercel already uses is fine, as is the
   direct one used by the migration workflow — unlike `prisma migrate`, the
   seed takes no advisory locks. Keep `sslmode=require` as provided by Neon.
3. **Do not change the Vercel `DATABASE_URL`** and do not add the URL to any
   `NEXT_PUBLIC_*` variable; the site already reads the same database.
4. **Re-running is safe.** If the run is interrupted or you are unsure it
   completed, run the identical command again — the upserts converge on the
   same rows.
5. **Verify afterwards** by loading the production site (`/` and `/products`
   should list the catalog and `/products/<slug>` detail pages should render),
   or by checking row counts with Prisma Studio
   (`DATABASE_URL=... npx prisma studio`) or the Neon SQL editor: 8 rows in
   `Category`, 6 in `Product`, and `Customer`/`Order`/`OrderItem`/`Download`
   must remain empty.
6. **Never paste the connection string** into issues, pull requests, chat, or
   CI logs. If it leaks, rotate the role password in the Neon dashboard.

## Explicitly not done

- No demo customer, order, order-item, download, session, or cart rows are
  created anywhere in this change, and none are needed for the public catalog.
- No changes to authentication, cart, checkout, payments, download
  authorization, or any read path.
- The full demo seed (`npm run db:seed`) was not modified in behavior and was
  not run against production.
- Nothing was executed against the production database for this PR; the
  production catalog is populated only when the command above is run by the
  project owner after merge.
