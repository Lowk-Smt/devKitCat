# devKitCat

**Build better Roblox games.**

devKitCat is a premium developer-resource marketplace for Roblox creators,
selling production-ready systems, UI kits, 3D assets, VFX, audio, developer
tools, templates, and complete starter kits.

## Status

PRs #1 (marketplace foundation/design system), #2 (browsing/search/product
pages/cart UI), #3 (Three.js previews), #4 (customer/account UI), #5
(PostgreSQL + Prisma backend/database foundation), and #6 (real authentication,
database-backed sessions, protected accounts) are merged. This branch contains
the completed implementation for **PR #7 — database-backed cart and checkout
foundation** and is ready for review; PR #7 is not yet merged:

- `/login` and `/register` are wired to a real backend. Registration creates a
  `Customer` row with a scrypt password digest; sign-in verifies it and issues an
  opaque session token whose SHA-256 hash is stored in a new `Session` table.
  Sign-out deletes that row, so a copied token stops working immediately.
- `/account`, `/account/purchases`, `/account/purchases/:id`,
  `/account/downloads`, and `/account/settings` require an authenticated
  customer and redirect everyone else to `/login`.
- Account screens are database-backed and scoped to the authenticated customer:
  orders, download records, and preferences are read by that customer's ID, so
  another customer's order ID resolves to a 404 instead of their data. Their
  layout, collection states, and styling are unchanged.
- `/` and the marketplace/product routes read products and categories through a
  server-only data-access layer when `DATABASE_URL` is configured. Without it,
  the existing catalog fixtures remain a database-free preview fallback.
- The marketplace UI remains client-interactive: search, category filters,
  sorting, result counts, cards, product detail, related products, galleries,
  and 3D previews keep their existing component contracts.
- The **cart is database-backed** for signed-in customers: lines persist in a
  new `CartItem` table, survive reloads and devices, support quantities of 1-10
  per product, and every read or mutation is scoped to the session's customer.
  Signed-out visitors keep the existing browser-local cart, which cannot be
  ordered.
- **`/checkout`** reviews the cart and submits an order. Prices and totals are
  recalculated on the server from current catalog rows; the checkout form
  carries no price, total, or owner. Submission writes an **unpaid**
  `PENDING_PAYMENT` order with item snapshots and clears the cart in one
  transaction, then confirms on the order's own page.
- **No payment is taken.** There is no payment provider, card collection,
  payment webhook, or simulated success endpoint; an unpaid order unlocks no
  download, and download buttons remain disabled placeholders.

Account and cart data deliberately have **no** fixture fallback: without
`DATABASE_URL`, `/login` and `/register` report that account services are
unavailable, the protected routes redirect, cart services report themselves
unavailable, and the storefront keeps its browser-local cart — so no demo
identity is ever rendered as if it were signed in.

Not yet implemented (left for future PRs): payments and payment webhooks, secure
downloads, tax/shipping/discount rules, cart merging on sign-in, email
verification, password reset, login rate limiting, OAuth/social sign-in, admin
and seller tooling, real production product imagery, reviews, and online
documentation pages. See
[`docs/pr-7-cart-checkout.md`](docs/pr-7-cart-checkout.md) for the cart and
checkout architecture,
[`docs/pr-6-authentication.md`](docs/pr-6-authentication.md) for the
authentication architecture, and
[`docs/pr-5-backend-database.md`](docs/pr-5-backend-database.md) for local
database and deployment setup.

## Tech stack

- [Next.js 16](https://nextjs.org) (App Router, Turbopack) + React 19
- TypeScript
- PostgreSQL + Prisma ORM 7 (PostgreSQL driver adapter)
- [Three.js](https://threejs.org) + GLTFLoader / OrbitControls (no React 3D framework)
- Node `crypto` scrypt + database-backed sessions for auth (no auth dependency)
- ESLint (`eslint-config-next`)
- Plain CSS — global design tokens + CSS Modules (no UI framework)
- [Geist](https://vercel.com/font) fonts, self-hosted via the `geist` package

## Getting started

```bash
npm ci
# Database-free catalog preview (account routes report themselves unavailable):
npm run dev

# To use PostgreSQL-backed marketplace reads and customer accounts:
cp .env.example .env
# Edit .env and replace the placeholder DATABASE_URL.
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev
```

Marketplace reads still work without `DATABASE_URL` — they fall back to the
catalog fixtures. Authentication does not: account services report themselves
unavailable until PostgreSQL is reachable, migrated, and seeded. See the
[backend/database guide](docs/pr-5-backend-database.md) for exact setup details
and [`docs/pr-6-authentication.md`](docs/pr-6-authentication.md) for the
authentication design.

Open [http://localhost:3000](http://localhost:3000).

## Scripts

| Command                         | Description                                                        |
| ------------------------------- | ------------------------------------------------------------------ |
| `npm run dev`                   | Generate Prisma Client, then start the development server          |
| `npm run build`                 | Generate Prisma Client, then create the production build           |
| `npm run start`                 | Serve the production build                                         |
| `npm run lint`                  | Run ESLint                                                         |
| `npm run typecheck`             | Generate Prisma Client and run TypeScript checks without emitting |
| `npm test`                      | Run UI, authentication, and seed/data-access unit tests            |
| `npm run db:generate`           | Generate Prisma Client (does not connect to PostgreSQL)            |
| `npm run db:migrate`            | Apply/create development migrations; requires `DATABASE_URL`       |
| `npm run db:deploy`             | Apply committed migrations in deployment environments              |
| `npm run db:seed`               | Idempotently seed the existing marketplace/demo fixture values     |
| `npm run db:seed:catalog`       | Idempotently seed only categories/products (no demo account records) |
| `npm run db:studio`             | Open Prisma Studio against `DATABASE_URL`                          |

## Routes

| Route              | Description                                        |
| ------------------ | -------------------------------------------------- |
| `/`                | Homepage                                           |
| `/products`        | Marketplace (`?q=`, `?category=`, `?sort=` — all optional, combinable) |
| `/products/:slug`  | Product detail (known demo slugs are predeclared; configured DB slugs are read at request time, unknown slugs 404) |
| `/login`            | Sign in with email and password (signed-in visitors go to `/account`) |
| `/register`         | Create an account and sign in; duplicate emails and invalid input are rejected |
| `/account`          | Signed-in customer overview |
| `/account/purchases` | The customer's own order history and search |
| `/account/purchases/:id` | The customer's own order details (404 for unknown or unowned IDs) |
| `/account/downloads` | The customer's own library; download controls are disabled placeholders |
| `/account/settings` | Profile and preferences, persisted for the signed-in customer |
| `/checkout`       | The signed-in customer's cart review and order submission (payment not enabled) |

## Project structure

```
prisma/
├── schema.prisma          # PostgreSQL marketplace/account/session data model
├── migrations/            # Reproducible schema migrations (init + auth + cart/checkout)
├── seed.ts                # Idempotent fixture-based demo seed (catalog + demo account)
├── seed-catalog.ts        # Catalog-only production seed (validates DATABASE_URL first)
└── seed-catalog-runner.ts # Catalog-only seed runner (loads the generated client)
src/
├── app/                    # Routes, layout, global styles
│   ├── products/           # DB-backed catalog + product detail routes
│   ├── account/            # Session-protected customer account pages
│   ├── checkout/           # Cart review + unpaid order submission (protected)
│   ├── login/              # Sign-in screen (posts to a Server Function)
│   ├── register/           # Registration screen (posts to a Server Function)
│   ├── globals.css         # Design tokens & layout primitives
│   ├── layout.tsx          # Shell: header, main, footer
│   └── page.tsx            # Homepage composition
├── components/              # Marketplace, account, cart, checkout and 3D UI
├── data/                    # Catalog fixtures, account/order seed values, no-DB catalog fallback
├── lib/server/              # Server-only Prisma client, data access, auth, cart/checkout, seeding
├── lib/                     # Catalog search/sort, account states, form contracts, money, cart store
└── types/                   # Shared catalog and account read types
```

## Data

`src/data/categories.ts` and `src/data/products.ts` preserve the existing catalog
fixtures as deterministic seed input and as the explicit no-`DATABASE_URL`
fallback. When PostgreSQL is configured, Server Components use
`src/lib/server/data-access.ts`; Prisma and `DATABASE_URL` stay on the server.
Two seeds project those fixtures: `npm run db:seed` additionally writes the demo
customer, orders, and downloads (development only), while
`npm run db:seed:catalog` writes only categories and products and is the command
to populate a deployed catalog — see
[`docs/pr-9-catalog-seed.md`](docs/pr-9-catalog-seed.md). Its interactive
transaction budget, the `P2028` timeout it fixes, and its secret-safe error
reporting are documented in
[`docs/pr-10-catalog-seed-timeout-fix.md`](docs/pr-10-catalog-seed-timeout-fix.md).
The existing `Product` type in `src/types` still covers everything rendered
(`images`, `modelPreviews`, `overview`, `features`, `requirements`,
`includedFiles`, `installation`, `documentation`, `changelog`, `license`,
`releasedAt`, `isFeatured`, `isNew`, …). Search, filtering, and sorting remain
pure functions in `src/lib/catalog.ts` and run in the existing browser UI.

Product cards still use the first gallery image or the original placeholder.
Detail galleries show `modelPreviews` first, then `images`, with a placeholder
when both are empty. For a signed-in customer the cart comes from the database
and always prices itself from the current `Product` rows; for a signed-out
visitor it stays browser-local, resolves known fixture product IDs, and cannot
be ordered.

## Authentication and customer accounts (PR #6)

Sign-in state lives in a database-backed session — not in a JWT and not in the
browser:

1. `/login`, `/register`, and the settings/sign-out forms submit to Server
   Functions in `src/lib/server/auth-actions.ts`. Credentials never reach a
   client component, a route handler, or `localStorage`.
2. Passwords are hashed with Node's built-in `crypto.scrypt` (N=2^17, r=8, p=1,
   64-byte key, 16-byte random salt) and stored as `scrypt$N$r$p$salt$digest` in
   `Customer.passwordHash`. Verification uses `timingSafeEqual`, and an unknown
   email still runs a full decoy verification so response timing does not reveal
   which addresses are registered.
3. A successful sign-in stores a `Session` row holding only the SHA-256 hash of a
   32-byte random token. The token itself is returned once, in an `HttpOnly`,
   `SameSite=Lax`, `Path=/` cookie that is `Secure` in production. Because only
   the hash is stored, a database leak cannot be replayed as a session, and there
   is no signing secret to configure or rotate.
4. Sessions last 7 days, or 30 days with "Remember me"
   (`AUTH_SESSION_MAX_AGE_DAYS`, `AUTH_REMEMBER_ME_MAX_AGE_DAYS`). Expired rows
   are rejected on read and cleaned up opportunistically. Signing in again on
   another device does not revoke the first session.
5. Signing out deletes the `Session` row and clears the cookie in the same
   request.

Every protected page calls `requireCustomer()` itself, not only the account
layout, because Next.js layouts do not re-render on client-side navigation.
Authorization is enforced where the data is read: `getCustomerOrderById(
customerId, orderId)` returns nothing for an order that exists but belongs to
someone else, account queries always filter by the session's customer ID, and
the settings action derives the customer from the session rather than from the
submitted form — so a form cannot name a different account. The email address is
rendered read-only and is deliberately not a submitted field.

Server Functions are public POST endpoints, so each one re-authenticates and
re-validates its input; Next.js also rejects cross-origin action requests.
Nothing sensitive is rendered to the browser: the customer projection selects
explicit columns and never includes `passwordHash`, and session tokens are not
logged.

The seeded `demo-customer` keeps its three historical orders and five download
records but has **no** password hash, so it cannot sign in — no credentials are
committed anywhere. Register your own account to explore the authenticated
screens.

To inspect collection UI states without data, append `?preview=empty`,
`?preview=loading`, or `?preview=error` to `/account/purchases` or
`/account/downloads`. These are fixed visual examples, not simulated requests.

The scope of this PR stops at authentication and customer accounts; the deferred
work is listed once, under **Status**.

## Cart and checkout (PR #7)

A signed-in customer's cart lives in PostgreSQL, not in the browser:

1. The cart UI reads the database cart once per page load through
   `readCartAction`, and every mutation (`add`, quantity change, remove, clear)
   is a Server Function in `src/lib/server/cart-actions.ts`. Each one
   re-authenticates with `requireCustomer()` and derives the owner from the
   session, so no request can name another customer's cart. Signed-out visitors
   keep the existing `localStorage` cart and are sent to sign in to check out.
2. Adding a product requires it to exist and be published. The unique
   `(customerId, productId)` index turns a repeated add into a quantity change,
   so a product can never occupy two lines. Quantities are 1-10 per line and at
   most 20 distinct products per cart; anything else is rejected server-side.
3. Prices are read from the current `Product` row on every read and again inside
   the checkout transaction, and are handled as integer cents
   (`src/lib/money.ts`) before being written back as `DECIMAL(10,2)` text. The
   browser sends no price, total, discount, product name, or owner: the checkout
   form posts only a server-generated idempotency key and the subtotal that was
   displayed.
4. Submitting revalidates the cart, availability, quantities, and prices, then
   writes an `Order` in `PENDING_PAYMENT` with `OrderItem` snapshots (title,
   slug, category, version, unit price, quantity) and clears the cart in **one
   transaction**. A price change since the page rendered refuses the order and
   asks for a fresh review; a failure rolls everything back, so a cart is never
   cleared without an order.
5. The idempotency key is unique per customer in the database, so a double
   submission resolves to the order it already created instead of duplicating
   it. Success redirects to `/account/purchases/:id?placed=1`, the existing
   customer-scoped order page, with a confirmation that nothing was charged.

**Checkout does not take payment.** It writes an unpaid order and nothing else:
no card details are collected, no order is marked paid or complete, no
`Download` row is created, and no download control is enabled. Both the checkout
screen and the confirmation say that no payment provider is connected yet. No
tax, shipping, or discount policy is applied — the subtotal is the catalog
total, and final payment calculations arrive with the payment integration.

The scope of this PR stops at the cart and the checkout foundation; the deferred
work is listed once, under **Status**.

## 3D previews

Try `/products/cozy-furniture-pack` (GLB, plus an image thumbnail) and
`/products/camping-props-pack` (GLTF). The visible captions identify the local
assets as samples, not the complete product packs.

To attach a preview, add an entry in the centralized product data:

```ts
modelPreviews: [{
  src: "/previews/model.glb", // .gltf is also supported
  label: "Model name",
  description: "A useful text alternative describing the model.",
}]
```

`ModelViewer` in `src/components/product/viewer` can also be used independently
with `src`, `title`, and optional `description` props. The lightweight entry
point validates sources and dynamically imports the client implementation
with SSR disabled. Three.js isn't fetched for image-only/placeholder pages.
`GalleryStage` and `GalleryThumb` are the only media renderers; selection,
product detail markup, pricing, cart UI, sections, and related products stay
unchanged.

The viewer centers and normalizes arbitrary model units, fits a perspective
camera against both viewport axes, and lights PBR materials with a small
procedural studio environment plus key/fill lights. `GLTFLoader` parses an
abortable per-instance fetch; GLTF buffers/textures resolve relative to the
model's URL (including redirects). Remote sources must permit CORS. Prefer
small same-origin assets under `public/`; no upload/storage system is provided.

Mouse drag / one-finger touch orbits; wheel / pinch zooms. Native buttons rotate,
zoom, reset the camera, and toggle wireframe without replacing the original
materials. With the canvas focused, arrow keys rotate, +/− zoom, R resets, and
W toggles wireframe. Controls have labels, visible focus, 44px targets, and a
textual On/Off toggle. Loading/errors are announced and errors have retry
controls where appropriate. A local error boundary also contains viewer-module
failures. At small widths the controls wrap and the preview remains usable at
320px; reduced-motion preferences disable the loading animation.

Rendering is **on demand**, not a perpetual animation loop. ResizeObserver
handles the canvas, with DPR capped at 2; resizing preserves relative zoom/orbit
and updates the reset position. On selection/source changes and navigation,
requests, pending frames, controls/listeners, observers, materials, textures,
ImageBitmaps, embedded-image object URLs, geometry, skeletons, instanced
resources, the PMREM render target, and renderer/context are released. A per-parse resource owner also handles
partial and late-loading dependencies.

Scope/limitations: GLB/GLTF only, static model inspection (no animation playback),
and no Draco, Meshopt, or KTX2 decoder bundles. Other file formats and compressed
assets requiring those decoders are not supported yet. WebGL 2 is
required; otherwise the product page keeps working with a friendly fallback.
See `public/previews/README.md` for demo provenance/regeneration and
`docs/pr-3-verification.md` for verification details.

## License

Proprietary — all rights reserved.
