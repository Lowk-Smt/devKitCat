# devKitCat

**Build better Roblox games.**

devKitCat is a premium developer-resource marketplace for Roblox creators,
selling production-ready systems, UI kits, 3D assets, VFX, audio, developer
tools, templates, and complete starter kits.

## Status

This repository is at **PR #2 — marketplace browsing experience**:

- `/products` is a full marketplace: search, category filter, sorting (Featured,
  Newest, price low→high / high→low), result count, and empty / no-results
  states. Filters combine and live in the URL (`?q=&category=&sort=`).
- Polished product cards with Featured / New badges.
- Product detail pages with a gallery, purchase CTAs, and Overview, Features,
  Requirements, What's included, Installation, Documentation, Changelog and
  License sections, plus related products.
- A reusable, media-agnostic product gallery (`GalleryItem` list → stage +
  thumbnails).
- A client-side **cart UI** (header button + drawer, persisted in
  `localStorage`). It is UI only — there is no checkout.

Not yet implemented (left for future PRs): backend persistence, authentication,
payments/checkout, admin tooling, secure downloads, 3D viewer, real product
imagery, reviews, and online documentation pages.

## Tech stack

- [Next.js 16](https://nextjs.org) (App Router, Turbopack) + React 19
- TypeScript
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
│   ├── product/          # ProductCard, badges, image, gallery/, detail/
│   ├── sections/         # Homepage sections
│   └── ui/               # Button, SectionHeading, Icon, EmptyState
├── data/                 # Mock categories & products (static)
├── lib/                  # Catalog search/sort, gallery items, cart store, helpers
└── types/                # Shared catalog types
```

## Data

All catalog content lives in `src/data` as static mock data. The `Product`
type in `src/types` covers everything the UI renders (`images`, `overview`,
`features`, `requirements`, `includedFiles`, `installation`, `documentation`,
`changelog`, `license`, `releasedAt`, `isFeatured`, `isNew`, …), so pages are
driven by data rather than per-page markup. Search, filtering, and sorting are
pure functions in `src/lib/catalog.ts`.

Products with an empty `images` array use the placeholder artwork. To add real
images later, list paths in `images` — cards use the first one and the gallery
shows all of them.

## License

Proprietary — all rights reserved.
