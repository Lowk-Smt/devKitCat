# devKitCat

**Build better Roblox games.**

devKitCat is a premium developer-resource marketplace for Roblox creators,
selling production-ready systems, UI kits, 3D assets, VFX, audio, developer
tools, templates, and complete starter kits.

## Status

This repository is at **PR #3 — interactive 3D product previews**:

- `/products` is a full marketplace: search, category filter, sorting (Featured,
  Newest, price low→high / high→low), result count, and empty / no-results
  states. Filters combine and live in the URL (`?q=&category=&sort=`).
- Polished product cards with Featured / New badges.
- Product detail pages with a gallery, purchase CTAs, and Overview, Features,
  Requirements, What's included, Installation, Documentation, Changelog and
  License sections, plus related products.
- A reusable, media-aware product gallery (`GalleryItem` list → stage +
  thumbnails), now including interactive GLB/GLTF model previews.
- A client-only, lazy-loaded Three.js viewer: orbit/touch, zoom, reset,
  wireframe, automatic framing, and loading/error/retry states. Small original
  local sample models demonstrate both supported formats.
- A client-side **cart UI** (header button + drawer, persisted in
  `localStorage`). It is UI only — there is no checkout.

Not yet implemented (left for future PRs): backend persistence, authentication,
payments/checkout, admin tooling, secure downloads, real production product
imagery, reviews, and online documentation pages.

## Tech stack

- [Next.js 16](https://nextjs.org) (App Router, Turbopack) + React 19
- TypeScript
- [Three.js](https://threejs.org) + GLTFLoader / OrbitControls (no React 3D framework)
- ESLint (`eslint-config-next`)
- Plain CSS — global design tokens + CSS Modules (no UI framework)
- [Geist](https://vercel.com/font) fonts, self-hosted via the `geist` package

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Scripts

| Command             | Description                              |
| ------------------- | ---------------------------------------- |
| `npm run dev`       | Start the development server             |
| `npm run build`     | Production build                         |
| `npm run start`     | Serve the production build               |
| `npm run lint`      | Run ESLint                               |
| `npm run typecheck` | Run TypeScript checks without emitting   |
| `npm test`          | Gallery, source validation, framing, resource cleanup and demo-asset tests (Node 22.17+) |

## Routes

| Route              | Description                                        |
| ------------------ | -------------------------------------------------- |
| `/`                | Homepage                                           |
| `/products`        | Marketplace (`?q=`, `?category=`, `?sort=` — all optional, combinable) |
| `/products/:slug`  | Product detail (static params from mock data, 404 for unknown slugs) |

## Project structure

```
src/
├── app/                  # Routes, layout, global styles
│   ├── products/         # Catalog + product detail routes
│   ├── globals.css       # Design tokens & layout primitives
│   ├── layout.tsx        # Shell: header, main, footer
│   └── page.tsx          # Homepage composition
├── components/
│   ├── cart/             # CartProvider, drawer, header button (UI only)
│   ├── category/         # CategoryCard
│   ├── layout/           # Header, Footer, Logo
│   ├── marketplace/      # ProductBrowser, search, sort, category filter
│   ├── product/          # ProductCard, badges, image, gallery/, detail/, viewer/
│   ├── sections/         # Homepage sections
│   └── ui/               # Button, SectionHeading, Icon, EmptyState
├── data/                 # Mock categories & products (static)
├── lib/                  # Catalog search/sort, gallery items, cart store, helpers
└── types/                # Shared catalog types
```

## Data

All catalog content lives in `src/data` as static mock data. The `Product`
type in `src/types` covers everything the UI renders (`images`, `modelPreviews`,
`overview`, `features`, `requirements`, `includedFiles`, `installation`, `documentation`,
`changelog`, `license`, `releasedAt`, `isFeatured`, `isNew`, …), so pages are
driven by data rather than per-page markup. Search, filtering, and sorting are
pure functions in `src/lib/catalog.ts`.

Cards still use the first `images` entry, or the original placeholder artwork.
Detail galleries show `modelPreviews` first, then `images`, with a placeholder
when both are empty. Non-3D products do not need any new fields.

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
