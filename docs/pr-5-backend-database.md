# PR #5 — Backend + Database Foundation

This document covers the first persistence layer for devKitCat. It adds PostgreSQL
and Prisma for marketplace catalog reads and establishes customer/order/download
models for later work. It does **not** implement authentication, authorization,
checkout, payments, or file delivery.

## Stack and compatibility

- PostgreSQL
- Prisma ORM **7.10.0** with the `prisma-client` generator and PostgreSQL `pg`
  driver adapter
- Observed project/tool versions: Node.js **22.22.3**, npm **10.9.8**, Next.js
  **16.3.7**, React **19.2.8**. Prisma 7.10 supports Node `^20.19 || ^22.12 ||
  >=24.0`; the project was inspected and tested under the Node 22 runtime above.
- One `PrismaClient` is lazily cached per warm Node process. The PostgreSQL pool
  maximum is one connection per serverless instance. The database module is
  marked `server-only`; it is not imported from Client Components.

The application uses the Node.js server runtime, not the Edge runtime, for
Prisma-backed routes. `DATABASE_URL` is read only by server/CLI configuration and
is never exposed through a `NEXT_PUBLIC_*` variable.

## Environment

Only one application environment variable is required:

```dotenv
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/devkitcat?schema=public"
```

`.env.example` contains this safe local placeholder. It is not a working
credential. Copy it to `.env` and replace the value with a real PostgreSQL
connection string; `.env` and other secret-bearing environment files are ignored
by Git. Never commit a real URL, password, or provider secret.

When `DATABASE_URL` is absent, marketplace reads use the existing product and
category fixtures so local UI work and database-free builds do not need a
PostgreSQL service. When it is present, the application uses PostgreSQL. A
configured but unavailable database is **not** silently replaced with fixture
data: the server logs only the operation and a sanitized error code and returns
a generic data-load error. Run migrations and seed before expecting populated
PostgreSQL-backed pages.

## Local setup and commands

With a local or managed PostgreSQL database available:

```bash
npm ci
cp .env.example .env
# Edit .env and set DATABASE_URL to your PostgreSQL connection string.
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev
```

The Prisma client is also generated automatically before `npm run dev`,
`npm run build`, and `npm run typecheck`. Generation does not connect to a
PostgreSQL server, but it needs Prisma's generator/engine tooling available to
the environment.

Commands:

- `npm run db:generate` — generate the TypeScript Prisma client.
- `npm run db:migrate` — run `prisma migrate dev` locally; add a future migration
  with `npm run db:migrate -- --name descriptive_name`.
- `npm run db:deploy` — apply committed migrations with `prisma migrate deploy`
  in deployment environments.
- `npm run db:seed` — run the idempotent demo fixture seed.
- `npm run db:studio` — open Prisma Studio for the configured database.
- `npm run dev` — start Next.js. Without `DATABASE_URL`, use the demo catalog
  fallback; with it, ensure migration and seed have already completed.

For production, apply migrations through the deployment/CI release process
before serving the new app version. `npm run build` generates Prisma Client but
does not migrate or seed production data.

## Prisma schema

`prisma/schema.prisma` models the current marketplace and the customer concepts
already shown by PR #4:

- **Category** — unique slug, name/description/icon, stable display order, and
  product relation.
- **Product** — unique slug, title/description, price, type, version, overview,
  requirements, included files, installation/docs, release date, featured/new
  and published states, timestamps, category relation, and stable order.
- **ProductImage**, **ProductModelPreview**, **ProductChangelogEntry** — ordered
  gallery images, GLB/GLTF preview metadata, and version history, each with
  creation/update timestamps. Product documentation summary/topics are stored
  with Product; no CMS is added.
- **Customer** — unique email, name, timestamps. No password or credential
  column exists.
- **Order** — customer relation, status, total, currency, timestamps.
- **OrderItem** — product relation plus title/slug/category/version and
  unit-price snapshots, quantity, display position, and timestamps captured for
  the order.
- **Download** — customer, product, and optional order-item relations, status,
  timestamps, and an optional internal `fileKey`. The key is not a URL and is
  not returned by the current UI/data-access view.

The initial PostgreSQL migration is
`prisma/migrations/20261003000000_init/migration.sql`; `migration_lock.toml`
records the PostgreSQL provider. The schema uses unique constraints for product
and category slugs and customer email, plus indexes for catalog filtering,
orders, downloads, and child relations.

## Seed behavior

`src/lib/server/seed-data.ts` derives seed input from the existing
`src/data/categories.ts`, `src/data/products.ts`, and `src/data/mock-account.ts`
fixtures. It preserves the current eight categories, six catalog products,
Jordan Taylor demo identity, three displayed order records, their five order
items, and five library entries. It uses stable fixture IDs and upserts by
stable unique keys, so re-running `npm run db:seed` does not append duplicates.

The order-item snapshot fields preserve the values shown by the existing demo
history. Demo downloads are seeded as `PENDING` and have no `fileKey`; this is
only sample database data, not download authorization or serving.

## Server-side data access and route integration

`src/lib/server/data-access.ts` exposes reusable reads backed by Prisma when
configured and the current fixture fallback otherwise:

- `listProducts`, `getProductBySlug`, `getProductById`, and `listCategories`
- `getRelatedProducts`
- `getCustomerByEmail`, `getCustomerById`, `listCustomerOrders`, `getOrderById`,
  and `listCustomerDownloads`

`src/lib/server/data-access-core.ts` contains typed relation mapping and a
unit-testable Prisma-client seam; raw Prisma reads are kept out of components.
The homepage, catalog, and product detail route (including metadata and related
products) use these reads. The dynamic product route continues to predeclare
existing demo slugs while leaving `dynamicParams` enabled for database slugs.
Client search, filters, sorting, card/gallery contracts, Three.js previews, and
the local cart remain intact. The cart continues to use the existing fixture
IDs/prices; it is still not a server cart or a checkout mechanism.

The account routes deliberately remain connected to the fixed PR #4 demo UI
fixtures. The new customer/order/download read functions and seed records are
foundation-only and are not used as an authenticated account experience. The
read functions do not enforce authorization; **do not use customer/order reads
for real user data until a later PR adds verified identity and ownership checks**.

## Vercel deployment

No local filesystem database or permanently running service is introduced.
The Vercel project needs a reachable PostgreSQL database and a server-side
`DATABASE_URL` in the appropriate Development, Preview, and Production
Environment Variables. Use the connection string/pooler mode recommended by the
selected PostgreSQL provider for serverless Node functions, and ensure its
connection limits can accommodate warm function instances. The code does not
require a paid Vercel database integration; any compatible PostgreSQL provider
can supply the URL.

Do not prefix the variable with `NEXT_PUBLIC_`. Do not add database access to
Edge middleware or Client Components. The current routes use the Node runtime.

## Explicitly deferred

The following are still future PR work and are not implied by the database
models or demo fixtures:

- Authentication, session management, and protected routes.
- Password handling/storage or OAuth/social login.
- Payments, checkout, Stripe, PayPal, or other payment providers.
- Secure download authorization, signed URLs, or file serving.
- Admin/product-management UI or any of the unrelated services listed out of
  scope for PR #5.
