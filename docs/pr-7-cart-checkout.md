# PR #7 — Cart + Checkout Foundation

This document covers the database-backed shopping cart and the checkout
foundation for devKitCat: persistent per-customer carts, a reviewable order
summary, and order submission that writes an **unpaid** order. It builds on the
PR #5 PostgreSQL/Prisma foundation and the PR #6 authentication work, and adds
**no new npm dependencies**.

It does **not** implement payments. There is no payment provider, no card
collection, no payment webhook or simulated success endpoint, no paid-file
hosting or signed download URLs, no seller/admin tooling, and no download
delivery. Download controls remain the disabled placeholders they were before.

## Implementation plan

1. Inspect the merged state: the client-only `localStorage` cart, the catalog
   data-access layer, the auth service/actions pattern, the order/download
   schema, and the existing account pages.
2. Add one additive migration: a `CartItem` table, an `OrderStatus` value for
   unpaid orders, and a per-customer idempotency key on `Order`.
3. Split the new logic the way PR #6 split authentication: framework-free policy
   (`cart-core.ts`, `money.ts`), a database service built on an injected client
   provider (`cart-service.ts`), Next.js wiring (`cart.ts`), and Server
   Functions (`cart-actions.ts`).
4. Point the existing cart UI at the database cart for signed-in customers while
   leaving the browser-local cart for signed-out visitors.
5. Add a server-rendered `/checkout` review screen whose mutations are the same
   Server Functions, and reuse the existing order-detail page as the
   confirmation.
6. Test the policy and the service against an in-memory Prisma stand-in, plus
   source-level guards for authorization and client trust boundaries.

## Architecture

| Module | Runtime | Responsibility |
| --- | --- | --- |
| `src/lib/money.ts` | client-safe, pure | Whole-cent price parsing/formatting (`toPriceCents`, `lineTotalCents`, `sumCents`, `priceCentsToDecimalString`). Amounts never float. |
| `src/lib/cart-contract.ts` | client-safe | The serializable cart view (`CartLineView`, `CartSummaryView`), the shared cart policy constants, mutation/form result contracts, and `summarizeCartLines`. |
| `src/lib/server/cart-core.ts` | server, framework-free | Quantity limits, identifier validation, order references, idempotency keys, and every user-facing failure message. Unit-testable without Next.js or Prisma. |
| `src/lib/server/cart-service.ts` | `server-only` | `createCartService(getClient, logger)`: cart reads and mutations, plus `placeOrder`. The only module that writes `CartItem`/`Order`/`OrderItem` for checkout. |
| `src/lib/server/cart.ts` | `server-only` | Next.js wiring: the `cart` singleton on the shared Prisma client provider and `isCartServiceAvailable()`. |
| `src/lib/server/cart-actions.ts` | `"use server"` | `readCartAction`, `addToCartAction`, `setCartItemQuantityAction`, `removeCartItemAction`, `clearCartAction`, `placeOrderAction`. Each re-authenticates and re-validates. |
| `src/app/checkout/page.tsx` | server | The review screen: reads the customer's cart, renders lines and the summary, generates the idempotency key. |
| `src/components/checkout/*` | client + server | `CheckoutLine` (quantity/remove), `CheckoutSubmit` (`useActionState`), `PaymentNotice` (the "payment is not enabled" copy, reused on the confirmation). |

`cart-service.ts` is constructed with injected dependencies, exactly like
`createCustomerAuthService`, so database failures are testable and a missing
client degrades to `UNAVAILABLE` instead of throwing.

## Database changes

One additive migration:
`prisma/migrations/20261003150000_add_cart_and_checkout_foundation`.

1. **`ALTER TYPE "OrderStatus" ADD VALUE 'PENDING_PAYMENT'`** — the state an
   order has when checkout creates it. `COMPLETE`, `PROCESSING`, and `REFUNDED`
   keep their meaning, so the three seeded historical orders are untouched and
   still render as before. The app-level union gained `"pending-payment"`, which
   the account UI renders as an **"Awaiting payment"** pill.
2. **`CartItem`** — `customerId`, `productId`, `quantity`, timestamps, with
   `@@unique([customerId, productId])`. The unique pair is what makes "add this
   product again" a quantity change instead of a second line. `customerId`
   cascades from `Customer`; `productId` is `RESTRICT` from `Product`, matching
   `OrderItem`, so a product with a cart line cannot be deleted underneath it.
   Prices are deliberately **not** stored on a cart line: every read takes the
   current `Product.price`.
3. **`Order.idempotencyKey VARCHAR(64)`** with
   `@@unique([customerId, idempotencyKey])` — nullable, so existing rows are
   unaffected and Postgres' "NULLs are distinct" rule keeps them from colliding.

Nothing was renamed, dropped, or backfilled, and the seed needed no changes:
`npm run db:seed` still reports 8 categories, 6 products, 1 demo customer,
3 orders, 5 order items, and 5 download records, and running it twice is still a
no-op.

`MockOrderStatus` in `src/data/mock-account.ts` is now
`Extract<OrderStatus, "complete" | "processing" | "refunded">`: the fixtures are
historical purchases, so the seed can never write `PENDING_PAYMENT`. Only
checkout produces that state.

## Cart behaviour

- **Ownership.** Every read and mutation is keyed by the customer resolved from
  the session cookie (`requireCustomer()` in the actions, `getAuthenticatedCustomer()`
  for the read-only sync). No action accepts a customer ID, and the customer
  filter is part of each query rather than applied afterwards.
- **Adding.** The product must exist **and** be `published`. A repeated add
  increments the existing line. A customer can hold at most
  `CART_MAX_LINES = 20` distinct products; adding past that reports
  `CART_FULL`, while an existing line can still change quantity.
- **Quantities.** `1`–`10` per line (`CART_ITEM_MIN_QUANTITY`,
  `CART_ITEM_MAX_QUANTITY`), parsed from untrusted input, so `0`, `11`, `1.5`,
  `"lots"`, and `NaN` are rejected with `INVALID_QUANTITY`. Incrementing past
  the cap lands on the cap instead of erroring, so a double-click is harmless.
- **Removal / clearing** are idempotent: removing a line that is already gone
  (two tabs, a retry) succeeds and returns the refreshed cart.
- **Identifiers.** Product IDs must match `^[A-Za-z0-9_-]{1,64}$` before they
  reach a query, so injected SQL fragments are rejected as unknown products.
- **Signed-out visitors** keep the existing browser-local `localStorage` cart:
  one license per product, no quantities, and no checkout — the drawer sends
  them to `/login`. There is no anonymous database cart, because a cart row with
  no verified owner could not be secured.
- Without `DATABASE_URL`, cart services report `UNAVAILABLE` and the storefront
  keeps the browser-local cart, exactly as account routes already report
  themselves unavailable. There is no fixture cart.

## Prices and totals

- Prices are read from the current `Product` row on every cart read and again
  inside the checkout transaction, and are handled as **integer cents**
  (`src/lib/money.ts`). `Decimal(10,2)` values are written back as fixed-point
  strings, so no float reaches the database.
- A price with more than two decimal places is rejected rather than silently
  rounded.
- The browser supplies **no** price, total, discount, product name, or owner.
  The checkout form posts exactly two server-generated values: the idempotency
  key and the subtotal the customer was shown.
- That reviewed subtotal is **compared, never used**. If the recomputed total
  differs — a price change, a quantity change in another tab, a hand-edited
  field — checkout is refused with `TOTAL_CHANGED`, the cart is left intact, and
  the re-rendered page shows the new total for a fresh review.
- No tax, shipping, or discount policy exists yet. The screen shows the
  subtotal, marks "Tax, fees & discounts — not applied yet", and states that
  final payment calculations arrive with the payment integration.

## Checkout submission

`placeOrder(customerId, { idempotencyKey, reviewedSubtotalCents })` validates
both fields, resolves a previous submission with the same key, and otherwise
runs one transaction:

1. Read the customer's cart lines with their products.
2. Refuse an empty cart (`CART_EMPTY`) or any unpublished line
   (`PRODUCT_UNAVAILABLE`, naming the products so the customer can remove them).
3. Recompute every line total and the order total from current prices; refuse a
   mismatch with the reviewed subtotal.
4. Clear the cart. Clearing *before* the insert is the concurrency guard:
   Postgres row locks make a second, concurrent checkout wait, and it then finds
   nothing left to order. A count that disagrees with what was read is treated
   as a changed cart, not as a success.
5. Create the `Order` — `status: PENDING_PAYMENT`, a server-computed `total`,
   `currency: USD`, the idempotency key, and an ID in the seeded
   `DKC-YYYY-MMDD-NNNNN` shape — with nested `OrderItem` snapshots of
   `productTitle`, `productSlug`, `categorySlug`, `categoryName`,
   `versionAtPurchase`, `unitPrice`, `quantity`, and `position`. Later catalog
   edits cannot rewrite a historical order.

Any failure rolls the whole transaction back, so a customer never ends up with a
cleared cart and no order (or the reverse).

**Idempotency.** The key is 32 random bytes (base64url), generated per checkout
render and rendered into a hidden field. A submission that already succeeded is
resolved to its order — both by an upfront lookup and, if two requests race, by
the `P2002` from the unique index. A double submission therefore returns the
same order reference instead of creating a second one, and the guarantee is
enforced by the database rather than by a disabled button.

**Confirmation.** A successful submission redirects to
`/account/purchases/:id?placed=1`, which is the existing customer-scoped order
detail page (another customer's ID still 404s). The `placed=1` flag only adds
copy, and only while the order is still `pending-payment`, so a hand-edited URL
cannot turn a settled order into a "just placed" one.

## Payment and download safety

- No card or payment details are collected, stored, or rendered anywhere.
- Checkout never writes `COMPLETE`/`PROCESSING`/`REFUNDED`; the only status it
  can produce is `PENDING_PAYMENT`.
- Checkout never writes the `Download` table, so an order grants no library
  entry and no file access. `DownloadCard`/`OrderLineItem` keep their disabled
  placeholders, and `mapDownload` still reports `coming-soon` unconditionally.
- There is no payment-success route, webhook, mock payment endpoint, or any
  client-reachable way to change an order's status. The only status writer is
  the checkout transaction.
- The checkout screen and the confirmation both state that no payment provider
  is connected, that nothing was charged, and that no download was unlocked.

## Server-side security

- Every Server Function is a public POST endpoint, so each calls
  `requireCustomer()` (or `getAuthenticatedCustomer()` for the read-only sync)
  and validates its own input. A test asserts all five mutating actions do so.
- A `"use server"` module may only export async functions; a test asserts that,
  because a stray value export breaks the module and can leak server code.
- Returned values are display strings plus server-computed cart numbers. Failure
  messages come from a fixed table, so raw database errors, connection strings,
  and stack traces never reach a response. Logging records a sanitized Prisma
  error code and a resource name only.
- CSRF handling is unchanged: Next.js rejects action requests whose `Origin`
  does not match the host, and the session cookie stays `SameSite=Lax`.
- Client components import no Prisma and no `server-only` module; the only
  server import is the `cart-actions` action reference module, and the checkout
  components import only the cents formatter from `src/lib/money.ts`. Both are
  asserted in tests.

## Testing

`npm test` runs two groups; the second now includes
`tests/cart-checkout.test.mjs` (28 new tests):

1. `node --experimental-strip-types --test tests/account-presentation.test.mjs
   tests/model-preview.test.mjs` — 24 tests, unchanged.
2. `node --conditions=react-server --import=tsx --test
   tests/authentication.test.mjs tests/database-foundation.test.mjs
   tests/cart-checkout.test.mjs` — 71 tests (35 authentication, 8 existing
   data-layer, 28 new cart/checkout).

The new suite covers, without a database: cent parsing and rejection of
ambiguous amounts, integer line totals/subtotals, quantity parsing and clamping,
identifier and idempotency-key validation, order-reference shape, every failure
message, the shared cart summary, empty-cart reads, add/repeat-add/no-duplicate
lines, quantity changes, idempotent removal, clearing, `CART_FULL`, rejection of
unknown/unpublished/malformed products and invalid quantities, isolation between
two customers (including that every cart query names its owner), `UNAUTHENTICATED`
for a missing identity and `UNAVAILABLE` with no client, sanitized database
errors, the unpaid order and its item snapshots, forged reviewed subtotals,
price changes and unpublished lines between review and checkout, rollback of the
cart when the transaction fails, double-submission idempotency, another customer
being unable to read the new order, no `Download` rows from checkout,
`isUnpaidOrderStatus`, and the source-level guards described above.

Existing tests were not modified or weakened; the previously skipped
"Prisma client initializes lazily" test now runs (the client is generated in
this environment) rather than being skipped.

## Verification performed

- `npm run lint` — exit 0, no findings.
- `npm run typecheck` — exit 0.
- `npm run build` (production, without `DATABASE_URL`) — exit 0. `/checkout`
  reports `ƒ (Dynamic)`; every previously dynamic route still does, and only
  `/_not-found` and `/icon.svg` are static.
- `prisma validate` — schema is valid. `prisma generate` — client generated with
  `CartItem`, the `customerId_productId` compound key, `Order.idempotencyKey`,
  and the `PENDING_PAYMENT` enum value.
- `npm test` — 95 tests across both groups, 0 failures.
- Against a real PostgreSQL 18.4 cluster (see "Environment limitations"): all
  three migrations applied to a fresh database in order; the resulting
  `OrderStatus` values, unique indexes, `VARCHAR(64)` nullability, and `CartItem`
  foreign keys were inspected and match the schema; `npm run db:seed` run twice
  reported identical counts.
- Also against that database, an end-to-end harness ran the real
  `src/lib/server/cart.ts` service: 15 checks covering empty carts, duplicate
  adds, invalid products/quantities/identifiers, unpublished products, isolation
  between two customers, scoped quantity changes and removals, catalog-derived
  subtotals, forged and malformed submissions leaving the cart intact, an unpaid
  order with correct snapshots plus a cleared cart, no download record,
  double-submission idempotency, customer-scoped order reads as
  `pending-payment`, a price change caught at checkout, an unpublished line
  blocking checkout by name, and `UNAUTHENTICATED` for a missing identity. The
  harness lived outside the repository's tracked files and was deleted after the
  run.
- `git diff --check` — no whitespace errors.

No browser was available in this environment. Focus management in the cart
dialog, `useActionState`/transition pending states, and the responsive layout at
real viewports were verified by code inspection, not by driving a browser; no
HTTP end-to-end run of the rendered checkout form was performed.

## Environment limitations

- `sudo apt-get install postgresql` was not possible (unreachable package
  indexes), so a temporary PostgreSQL 18.4 cluster was provisioned in `/tmp` with
  the npm `embedded-postgres` package, installed with `--no-save` outside the
  dependency list. No repository file, script, or dependency was added for it,
  and `package-lock.json` is unchanged.
- Prisma's schema-engine binary could not be downloaded (binary CDNs are
  unreachable here). `prisma generate` and `prisma validate` were run with
  `PRISMA_SCHEMA_ENGINE_BINARY` pointed at a local stub. `prisma migrate dev`,
  `migrate deploy`, and `migrate diff` could not be exercised, so the migration
  SQL is hand-written; it was applied to the real database with `pg` and the
  resulting schema inspected, and it was also executed against `pg-mem` (an
  in-memory Postgres emulator, also `--no-save` and outside the repository) to
  confirm the uniqueness rules behave as intended.
- No `psql` client is available; inspection used Node and the repository's
  existing `pg` dependency.

## Explicitly deferred

Payment provider integration (Stripe/PayPal/Roblox), card collection, payment
webhooks or any simulated payment-success endpoint, marking orders paid, secure
paid-file delivery and signed download URLs (download buttons stay disabled),
tax/shipping/discount rules and coupons, cart merging when a signed-out visitor
signs in, cart expiry or abandoned-cart cleanup, seller dashboards, product
uploads, admin tooling, email verification, password reset, OAuth, and any
visual redesign.

Known accepted trade-offs: the header cart reads the database cart once per page
load through a Server Function, because reading the session in the root layout
would make every page dynamic; the browser-local cart of a signed-out visitor is
not merged into the account cart on sign-in; order references use a random
five-digit serial per day, so a collision is rejected by the primary key and
surfaces as a retryable error rather than being retried automatically; and a
cart line for a product that was unpublished stays in the cart (visible, marked
unavailable, and blocking checkout) until the customer removes it.
