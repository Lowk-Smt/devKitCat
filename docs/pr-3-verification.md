# PR #3 verification — 3D product previews

Verified on 2026-10-02 on `arena/01a0fcfc-devkitcat`, based on the merged PR #2
commit `6d51721`. This change is limited to the 3D preview milestone.

## Implementation / integration

- `ModelViewer` is the reusable, lightweight client entry point. It accepts
  `src`, `title`, and an optional text `description`, validates the source, and
  dynamically imports the implementation with SSR disabled.
- One scene lifetime owns a perspective camera, WebGL renderer, OrbitControls,
  a small procedural PBR environment, lighting, and a subtle ground grid.
  Arbitrary model units/offsets are normalized without editing authored mesh
  transforms. A bounding sphere is fitted against both camera axes.
- A per-instance abortable fetch feeds `GLTFLoader.parseAsync`. The loader
  handles embedded or external buffers/textures; resources use the final model
  response URL as their base, including HTTP redirects. Remote assets need CORS.
- Mouse/touch orbit and zoom, rotate/zoom buttons, reset, and wireframe are
  supported. Wireframe saves/restores original flags without replacing material
  objects or texture maps. Reset restores the initial camera/orbit, not the
  selected material display mode.
- Rendering is on demand, with no perpetual animation loop. ResizeObserver
  resizes the canvas; DPR is capped at 2. Resizing preserves relative zoom/orbit
  and recalculates the default reset position.
- Cleanup aborts requests, cancels pending frames/timeouts, disconnects observers
  and listeners/controls, disposes shared materials/textures/geometry and
  skeleton/instanced resources, closes ImageBitmaps, revokes embedded-image
  object URLs, disposes the PMREM target and renderer, loses the WebGL context,
  and removes the canvas. Partial/late parser dependencies are also owned.
- Cached Next.js page restoration restarts the scene in loading state with fresh
  controls rather than showing a stale ready state after effect cleanup.
- The existing `GalleryItem` union adds `kind: "model"`; only the existing stage
  and thumbnail renderers gain a media case. Selection, image loading/fallback,
  placeholder artwork, product page markup, prices, purchase UI, sections,
  breadcrumbs, related products, marketplace filters, and cart logic are kept.
- `Product.modelPreviews` is optional and centralized in the existing catalog.
  The furniture product demonstrates GLB plus an image; camping demonstrates
  GLTF. These original small assets are visibly identified as samples, not the
  full marketplace packs or protected purchase files.

## Dependencies

Only two direct dependencies were added:

| Dependency | Use |
| --- | --- |
| `three` `^0.186.1` | Required renderer, controls, loader, and environment |
| `@types/three` `^0.186.0` (development) | TypeScript definitions |

The committed unit tests use Node's built-in test runner (Node 22.17+), not a new
unit-test framework. Browser tooling (Playwright, Chromium, axe) was installed
outside the checkout for verification and was not added to `package.json` or
`package-lock.json`. No browser traces/screenshots or large testing artifacts
are included in the PR; the sole committed still is the small demo gallery image.

## Clean command checks

The running server was stopped, `.next` was removed, dependencies were installed
from the lockfile with `npm ci`, and the exact requested commands were run again:

| Check | Result |
| --- | --- |
| `npm install` | Pass; audit reports 0 vulnerabilities |
| `npm test` | Pass; 17/17 tests |
| `npm run lint` | Pass; no lint errors/warnings |
| `npm run typecheck` | Pass |
| `npm run build` | Pass; all existing routes generated successfully |
| `git diff --check` | Pass |

Non-blocking tool notices: the existing ESLint 9 version emits a deprecation
notice during installation, and Node reports typeless-package ESM detection
when the test runner imports TypeScript helpers. The existing package/module
architecture was not changed just to suppress those notices.

Unit coverage includes source validation (missing, formats, protocols, query
strings), placeholder/image/model gallery construction, multiple preview IDs,
centering and unit normalization, empty/degenerate models, framing across aspect
ratios, preservation of original material flags/arrays/maps, deduplicated resource
disposal, skeletons/instances/ImageBitmaps, late/partial resources, and parsing
both checked-in demo model files with GLTFLoader.

## Browser verification

Real Chromium 153 (headless, SwiftShader WebGL 2) was exercised using Playwright
against the production build, with additional development checks. Screenshots
were inspected for desktop, tablet, 375px, 320px, and loading/error layouts.
These are browser/emulated viewport tests, not claims of physical-device or
Safari/Firefox testing.

### Route / viewport matrix

Every cell passed HTTP/render, no horizontal **page** overflow, no nested links,
and existing layout checks. Document and body scroll widths equaled the viewport.

| Route | 320px | 375px | 820px | 1440px |
| --- | --- | --- | --- | --- |
| `/` | Pass | Pass | Pass | Pass |
| `/products` | Pass | Pass | Pass | Pass |
| `/products/prosave` | Pass | Pass | Pass | Pass |
| `/products/roblox-ui-starter-kit` | Pass | Pass | Pass | Pass |
| `/products/simulator-starter-kit` | Pass | Pass | Pass | Pass |
| `/products/vfx-starter-pack` | Pass | Pass | Pass | Pass |
| `/products/cozy-furniture-pack` | Pass | Pass | Pass | Pass |
| `/products/camping-props-pack` | Pass | Pass | Pass | Pass |

Network inspection confirmed that image/placeholder-only pages did **not** fetch
the Three.js renderer/loader bundle. Each 3D demo loaded the split bundle only
when the model preview was rendered.

### Normal interaction / performance checks — passed

- GLB and GLTF load and frame correctly; normal image and placeholder previews
  are preserved. The furniture image thumbnail switches back and forth with 3D.
- Rotate left/right and zoom in/out change the rendered pixels. Reset returns
  to the initial view; wireframe on/off changes/restores the original rendering.
- Mouse drag orbit, wheel zoom, one-finger touch orbit, and two-finger pinch zoom.
- Focused-canvas keyboard rotation, +/− zoom, R reset, and W wireframe.
- Native labeled controls remain usable with at least 44px touch targets. The
  responsive controls wrap at mobile widths. Visible focus and textual On/Off
  are provided; states are not indicated by color alone.
- axe WCAG 2 A/AA and 2.1 AA checks on both 320px viewer regions: 0 violations.
- DPR=4 emulation at 375px: a 333 CSS-pixel-wide canvas uses 666 backing pixels,
  confirming the DPR=2 cap.
- WebGL draw instrumentation remains unchanged while the scene is idle.
- Gallery and client-side product navigation disconnect the old canvas and lose
  its context. Only the current 3D viewer owns a live context; navigating to
  ProSave leaves none. Returning via cached back navigation correctly shows
  loading, then a fresh ready view with consistent wireframe state.
- Marketplace search, no-results/clear, category filter, price sorting, URL
  filters, add/remove cart, drawer, UI-only Buy now, and cart persistence.
- No unexpected console errors or uncaught page errors on the normal route and
  interaction suites.

### Fault / supplementary checks — all 17 passed

Faults were injected via browser network fixtures (and a temporary test-only
static asset server for real CORS/redirect verification), not new app routes,
backend functionality, uploads, or committed broken product data.

1. Missing source: explanatory fallback, no WebGL scene, image still selectable.
2. Unsupported OBJ source: explanatory fallback, no WebGL scene.
3. Delayed root model: visible loading message and disabled controls, then ready.
4. HTTP 404: friendly error, context cleanup, successful retry.
5. Malformed model bytes: friendly error, cleanup, successful retry.
6. WebGL unavailable: complete fallback; the product page remains usable.
7. Forced context loss: error and successful fresh-context retry.
8. 30-second load timeout (accelerated browser clock): error and cleanup.
9. Navigate away during root fetch: no stale scene or uncaught errors.
10. Image request failure: original gallery placeholder fallback.
11. GLTF with external binary buffer and PNG texture, cross-origin CORS and a
    real HTTP redirect: correct relative resource resolution; ImageBitmap closed
    and context released on selection change.
12. Touch orbit and pinch zoom: rendered view changes; reset restores it.
13. Reduced-motion loading: spinner animation is disabled.
14. Embedded GLB image decode failure: blob URLs revoked and context released.
15. Embedded GLB image decoding completes after navigation: late ImageBitmap
    closed, blob URLs gone, no old context/scene revived.
16. Non-3D image-gallery fixture: normal image display and no WebGL context.
17. Viewer JavaScript chunk failure: local fallback contains the error, purchase
    UI/cart still work, and retry reloads into a successful preview.

Deliberate 404/chunk/image-decode faults produce the expected browser/Three.js
resource diagnostic messages. They produced no uncaught page errors and did not
crash the product page. Normal usage and navigation produced zero console errors.

## Actual working-tree / scope audit

The complete source tree, not only the displayed diff, was inspected. A
TypeScript AST check covered all 56 source TS/TSX files and found no duplicate
imports or top-level declarations. There is one viewer implementation (a thin
lazy entry, React scene lifecycle, and imperative scene helper), not two competing
renderers. Product-specific URLs live only in centralized demo data.

- No duplicated viewer, product type, gallery type, or icon import/implementation.
- No nested links in any of the 32 route/viewport combinations.
- All six existing product detail pages still work.
- `src/app`, cart/marketplace components, product cards, purchase panel, and
  existing image implementation are unchanged.
- No new app routes, backend/database/authentication, checkout/payments,
  protected download system, admin dashboard, reviews, or real uploads/storage.
- No PR #4+ milestone functionality. The PR is for review only, not merging.

## Files changed

New viewer implementation:

- `src/components/product/viewer/ModelViewer.tsx`
- `src/components/product/viewer/ModelViewerClient.tsx`
- `src/components/product/viewer/ViewerChrome.tsx`
- `src/components/product/viewer/ModelViewer.module.css`
- `src/components/product/viewer/model-viewer.ts`
- `src/components/product/viewer/model-framing.ts`
- `src/components/product/viewer/model-resources.ts`
- `src/lib/model-preview.ts`

Existing gallery/catalog integration:

- `src/components/product/gallery/GalleryStage.tsx`
- `src/components/product/gallery/GalleryStage.module.css`
- `src/components/product/gallery/GalleryThumb.tsx`
- `src/components/product/gallery/GalleryThumb.module.css`
- `src/components/ui/Icon.tsx`
- `src/lib/gallery.ts`
- `src/types/index.ts`
- `src/data/products.ts`

Demo assets, checks, and documentation/config:

- `public/previews/cozy-lounge.glb`
- `public/previews/camping-lantern.gltf`
- `public/previews/cozy-lounge.png`
- `public/previews/README.md`
- `scripts/generate-preview-models.mjs`
- `tests/model-preview.test.mjs`
- `README.md`
- `docs/pr-3-verification.md`
- `package.json`
- `package-lock.json`
- `next.config.ts` (development preview origin allowance only)

## Known limitations / deliberate scope

- GLB/GLTF only; no FBX/OBJ/STL. Static model inspection only; animation clips
  are not played. No Draco, Meshopt, or KTX2 decoder bundles.
- WebGL 2 is required; missing/failed WebGL uses the friendly fallback.
- Remote model/resources need valid CORS configuration. Prefer small local assets.
- Demo models are original test content, not the actual full commercial packs.
- Only Chromium/software WebGL and emulated device widths were verified here;
  real-device GPU and cross-browser QA remain a follow-up verification activity,
  not additional functionality in this PR.
