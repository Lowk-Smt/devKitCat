# devKitCat

**Build better Roblox games.**

devKitCat is a premium developer-resource marketplace for Roblox creators,
selling production-ready systems, UI kits, 3D assets, VFX, audio, developer
tools, templates, and complete starter kits.

## Status

This repository is at **PR #1 — foundation only**:

- Brand, design system, and responsive public shell (header, footer)
- Polished homepage (hero, categories, featured products, value props, CTA)
- Catalog routes: `/products` and `/products/:slug`
- Local mock product/category data with future-friendly types

Not yet implemented (left for future PRs): backend persistence, search,
authentication, payments/checkout, admin tooling, secure downloads, real
product imagery, and documentation pages.

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
| `/products`        | Product catalog (optional `?category=` filtering)  |
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
│   ├── category/         # CategoryCard
│   ├── layout/           # Header, Footer, Logo
│   ├── product/          # ProductCard, ProductThumbnail
│   ├── sections/         # Homepage sections
│   └── ui/               # Button, SectionHeading, Icon
├── data/                 # Mock categories & products (static)
├── lib/                  # Small helpers (formatting, class names)
└── types/                # Shared catalog types
```

## Data

All catalog content lives in `src/data` as static mock data. The `Product`
type in `src/types` is intentionally future-friendly (`images`, `changelog`,
`includedFiles`, `requirements`, `license`, …) so later PRs can extend it
without rewriting the foundation.

## License

Proprietary — all rights reserved.
