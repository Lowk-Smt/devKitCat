# devKitCat

**Build better Roblox games.**

devKitCat is a premium developer-resource marketplace for Roblox creators,
selling production-ready systems, UI kits, 3D assets, VFX, audio, developer
tools, templates, and complete starter kits.

## Status

PRs #1 (marketplace foundation/design system), #2 (browsing/search/product
pages/cart UI), #3 (Three.js previews), and #4 (customer/account UI) are merged.
This branch contains the completed implementation for **PR #5 — PostgreSQL +
Prisma backend/database foundation** and is ready for review; PR #5 is not yet merged:

- `/` and the marketplace/product routes read products and categories through a
  server-only data-access layer when `DATABASE_URL` is configured. Without it,
  the existing catalog fixtures remain a database-free preview fallback.
- The marketplace UI remains client-interactive: search, category filters,
  sorting, result counts, cards, product detail, related products, galleries,
  and 3D previews keep their existing component contracts.
- A normalized initial schema, migration, and repeatable seed cover products,
  categories, the demo customer, its historical orders/items, and download
  records.
- Customer account screens remain the intentional PR #4 frontend demo. Their
  displayed identity, purchases, and downloads are still fixed fixtures; the
  database model/read layer does not authenticate visitors or protect routes.
- The client-side **cart UI** remains local-only (`localStorage`) and has no
  checkout or payment behavior.

Not yet implemented (left for future PRs): authentication/session management,
password handling, protected routes, payments/checkout, secure downloads, admin
tooling, real production product imagery, reviews, and online documentation
pages. See [`docs/pr-5-backend-database.md`](docs/pr-5-backend-database.md) for
local database and deployment setup.

## Tech stack

- [Next.js 16](https://nextjs.org) (App Router, Turbopack) + React 19
- TypeScript
- PostgreSQL + Prisma ORM 7 (PostgreSQL driver adapter)
- [Three.js](https://threejs.org) + GLTFLoader / OrbitControls (no React 3D framework)
- ESLint (`eslint-config-next`)
- Plain CSS — global design tokens + CSS Modules (no UI framework)
- [Geist](https://vercel.com/font) fonts, self-hosted via the `geist` package

## Getting started

```bash
npm ci
# Database-free frontend preview:
npm run dev

# To use PostgreSQL-backed marketplace reads:
cp .env.example .env
# Edit .env and replace the placeholder DATABASE_URL.
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev
```

The app can still run without `DATABASE_URL`; marketplace reads then use the
existing demo fixtures. Migrations and seeding require a reachable PostgreSQL
database. See the [backend/database guide](docs/pr-5-backend-database.md) for
exact setup details.

Open [http://localhost:3000](http://localhost:3000).

## Scripts

| Command                         | Description                                                        |
| ------------------------------- | ------------------------------------------------------------------ |
| `npm run dev`                   | Generate Prisma Client, then start the development server          |
| `npm run build`                 | Generate Prisma Client, then create the production build           |
| `npm run start`                 | Serve the production build                                         |
| `npm run lint`                  | Run ESLint                                                         |
| `npm run typecheck`             | Generate Prisma Client and run TypeScript checks without emitting |
| `npm test`                      | Run existing UI tests plus seed/data-access unit tests             |
| `npm run db:generate`           | Generate Prisma Client (does not connect to PostgreSQL)            |
| `npm run db:migrate`            | Apply/create development migrations; requires `DATABASE_URL`       |
| `npm run db:deploy`             | Apply committed migrations in deployment environments              |
| `npm run db:seed`               | Idempotently seed the existing marketplace/demo fixture values     |
| `npm run db:studio`             | Open Prisma Studio against `DATABASE_URL`                          |

## Routes

| Route              | Description                                        |
| ------------------ | -------------------------------------------------- |
| `/`                | Homepage                                           |
| `/products`        | Marketplace (`?q=`, `?category=`, `?sort=` — all optional, combinable) |
| `/products/:slug`  | Product detail (known demo slugs are predeclared; configured DB slugs are read at request time, unknown slugs 404) |
| `/login`            | Sign-in UI preview; no authentication or credential handling |
| `/register`         | Registration UI preview; no account creation |
| `/account`          | Demo customer overview |
| `/account/purchases` | Demo order history and search |
| `/account/purchases/:id` | Demo order details (404 for unknown IDs) |
| `/account/downloads` | Demo library; download controls are disabled placeholders |
| `/account/settings` | Presentational profile and preference controls |

## Project structure

```
prisma/
├── schema.prisma          # PostgreSQL marketplace/account data model
├── migrations/            # Initial reproducible schema migration
└── seed.ts                 # Idempotent fixture-based Prisma seed
src/
├── app/                    # Routes, layout, global styles
│   ├── products/           # DB-backed catalog + product detail routes
│   ├── account/            # Intentionally frontend-only demo account pages
│   ├── login/              # Frontend-only sign-in screen
│   ├── register/           # Frontend-only registration screen
│   ├── globals.css         # Design tokens & layout primitives
│   ├── layout.tsx          # Shell: header, main, footer
│   └── page.tsx            # Homepage composition
├── components/              # Existing marketplace, account, cart and 3D UI
├── data/                    # Existing fixtures, seed values and no-DB fallback
├── lib/server/              # Server-only Prisma client, data access and seeding
├── lib/                     # Catalog search/sort, account states, cart store, helpers
└── types/                   # Shared catalog and account read types
```

## Data

`src/data/categories.ts` and `src/data/products.ts` preserve the existing catalog
fixtures as deterministic seed input and as the explicit no-`DATABASE_URL`
fallback. When PostgreSQL is configured, Server Components use
`src/lib/server/data-access.ts`; Prisma and `DATABASE_URL` stay on the server.
The existing `Product` type in `src/types` still covers everything rendered
(`images`, `modelPreviews`, `overview`, `features`, `requirements`,
`includedFiles`, `installation`, `documentation`, `changelog`, `license`,
`releasedAt`, `isFeatured`, `isNew`, …). Search, filtering, and sorting remain
pure functions in `src/lib/catalog.ts` and run in the existing browser UI.

Product cards still use the first gallery image or the original placeholder.
Detail galleries show `modelPreviews` first, then `images`, with a placeholder
when both are empty. The local cart continues to resolve known fixture product
IDs; checkout and server-side cart validation are not part of this PR.

## Customer account frontend (PR #4)

The customer routes remain an integrated **frontend-only preview**. Their fixed
demo identity, order records, and product-ID download entries live in
`src/data/mock-account.ts`; catalog product names, categories, versions, and file
counts come from the existing product fixtures. The same demo concepts are
included in the optional database seed, but the account UI continues to read its
centralized mock data and has no login/logout logic, client storage, sessions,
or access control.

`/login` and `/register` are visual states only. Their forms use browser/client
validation and explicitly discard the entered values; they do not transmit or
store passwords or create accounts. Settings are presentational and are not
persisted. Download buttons are disabled and do not point to a file or endpoint.
The new customer/order/download data-access functions are server-only building
blocks, not authentication or authorization; callers must add both before using
them for private customer data.

Authentication/session management, password handling, protected routes,
payment processing, checkout, and secure downloads are intentionally deferred.
To inspect collection UI states without a service, append `?preview=empty`,
`?preview=loading`, or `?preview=error` to `/account/purchases` or
`/account/downloads`; the default state is populated. These are fixed visual
examples, not simulated requests.

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
assets requiring those decoders are not supported in this PR. WebGL 2 is
required; otherwise the product page keeps working with a friendly fallback.
See `public/previews/README.md` for demo provenance/regeneration and
`docs/pr-3-verification.md` for verification details.

## License

Proprietary — all rights reserved.
