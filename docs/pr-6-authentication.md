# PR #6 — Authentication + Customer Accounts

This document covers real customer authentication for devKitCat: registration,
sign-in, sign-out, database-backed sessions, and route/data protection for the
existing `/account` screens. It builds directly on the PR #5 PostgreSQL + Prisma
foundation and adds **no new npm dependencies**.

It does **not** implement payments, checkout, secure paid-file delivery, email
verification, password reset, login rate limiting, OAuth/social sign-in, or any
admin/seller tooling.

## Architecture

Sessions are opaque random tokens stored server-side, and all authentication
logic runs in Server Functions and Server Components. Nothing about a session or
a password digest is ever sent to the browser beyond the cookie itself.

| Module | Runtime | Responsibility |
| --- | --- | --- |
| `src/lib/server/auth-core.ts` | server, framework-free | Password hashing/verification, session token + cookie policy, input validation and normalization, configuration resolution. Imports only relative paths, so it is unit-testable without Next.js or Prisma. |
| `src/lib/server/auth-service.ts` | `server-only` | `createCustomerAuthService(getClient, getConfig, logger)`: registration, credential checks, session create/read/destroy, profile updates. The only module that touches a password digest or a session token hash. |
| `src/lib/server/auth.ts` | `server-only` | Next.js wiring: `cookies()`, React `cache()`, the `customerAuth` singleton, `getAuthenticatedCustomer()`, `requireCustomer()`, `storeSessionCookie()`, `clearSessionCookie()`, `signOutCurrentSession()`, `isAccountServiceAvailable()`. |
| `src/lib/server/auth-actions.ts` | `"use server"` | `signInAction`, `registerAction`, `signOutAction`, `updateAccountSettingsAction`. Each re-authenticates and re-validates independently. |
| `src/lib/auth-forms.ts` | client-safe | Shared form-state contracts (`AuthFormState`, `SettingsFormState`) so pages and components agree on one shape without importing server code. |
| `src/lib/account-presentation.ts` | client-safe | Presentation helpers: `resolveAuthNotice`, `customerInitials`, `toIsoDate`, `getPasswordConfirmationError`, collection preview states. |
| `src/lib/server/data-access.ts` | `server-only` | Catalog reads plus the customer-scoped account reads `listCustomerOrders`, `getCustomerOrderById`, `listCustomerDownloads`. |

`auth-service.ts` is constructed with injected dependencies (`getClient`,
`getConfig`, `logger`), which keeps database failures testable and guarantees the
service degrades to `UNAVAILABLE` instead of throwing when no client exists.

## Passwords

- Algorithm: Node's built-in `crypto.scrypt` with **N=131072 (2^17), r=8, p=1,
  keylen=64**, a 16-byte `crypto.randomBytes` salt, and
  `maxmem = 128 * N * r * p + 16 MiB`. Measured at roughly **0.4 s** per hash and
  per verification on the reference machine (Node 22.22.3), which is the intended
  interactive cost.
- Storage format: `scrypt$131072$8$1$<base64 salt>$<base64 digest>` in
  `Customer.passwordHash`. Parameters are stored with the digest so they can be
  raised later without invalidating existing passwords.
- Verification uses `crypto.timingSafeEqual` over equal-length buffers.
- `parsePasswordHash` rejects malformed or downgraded digests (wrong segment
  count, non-`scrypt` algorithm, non-integer or out-of-range parameters, wrong
  salt length, wrong digest length) and verification then fails closed.
- Plaintext is never stored, logged, rendered, or returned. Customer reads use an
  explicit `select` projection (`CUSTOMER_SELECT`) that does not include
  `passwordHash`; the digest is added only by the internal credential check.
- An unknown email address — or a customer whose `passwordHash` is null, such as
  the seeded fixture customer — runs `runPasswordVerificationDecoy()` before
  returning the same generic `INVALID_CREDENTIALS` failure, so response timing
  does not reveal whether an account exists.
- Policy: 8–128 characters, no character-class rules (length is the effective
  control, and it matches the existing UI's `minLength={8}` hint). Emails are
  trimmed and lowercased, capped at 254 characters, and must look like
  `local@domain.tld`. Display names are 2–80 characters after control-character
  stripping and whitespace collapsing.

## Sessions and cookies

- Token: `crypto.randomBytes(32).toString("base64url")` — 43 characters, 256 bits
  of entropy, generated per sign-in.
- Storage: only `sha256(token)` (hex) is written to `Session.tokenHash`, which has
  a unique index. A database leak therefore cannot be replayed as a session, and
  there is **no signing secret to configure or rotate** — which is why this PR
  needs no `SESSION_SECRET`.
- Cookie: `devkitcat_session`, `HttpOnly`, `SameSite=Lax`, `Path=/`, with both
  `Expires` and `Max-Age` derived from the same instant that produced
  `Session.expiresAt`. `Secure` is set whenever `NODE_ENV === "production"`, or
  when `AUTH_COOKIE_SECURE=true` in a non-production HTTPS preview. Production
  cannot be configured into an insecure cookie.
- Lifetime: 7 days by default, 30 days with "Remember me"; both are clamped to
  1–365 days and remember-me is never shorter than the normal lifetime.
- Reading a session re-checks `expiresAt` against the current time; expired rows
  are rejected and deleted. Expired rows are also cleaned up opportunistically on
  sign-in. Cleanup failures never block authentication.
- Signing in on a second device creates a second session and does not revoke the
  first. Signing out deletes **that** session row and clears the cookie in the
  same request, so a token copied before sign-out stops working immediately.
- Cookie values that are not well-formed tokens are rejected before any database
  lookup.

## Environment

`.env.example` documents every variable this PR reads. Only `DATABASE_URL` is
required; the rest are optional tuning values with the defaults shown.

```dotenv
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/devkitcat?schema=public"
AUTH_SESSION_MAX_AGE_DAYS="7"
AUTH_REMEMBER_ME_MAX_AGE_DAYS="30"
# AUTH_COOKIE_SECURE="true"
```

No secret is introduced by this PR, and none is committed: `.env.example` holds
placeholders only, `.gitignore` ignores `.env*` (with `!.env.example`), and the
demo seed customer has no password hash.

## Database changes

One additive migration: `prisma/migrations/20261003120000_add_customer_authentication`.

- `Customer` gains `passwordHash String?` (null = cannot sign in),
  `themePreference ThemePreference @default(DARK)`, `productUpdates Boolean
  @default(true)`, and `releaseNotes Boolean @default(false)` — the fields the
  existing settings UI already presented.
- New `enum ThemePreference { DARK SYSTEM }`.
- New `Session` model: `id`, unique `tokenHash`, `customerId`, `expiresAt`,
  `createdAt`, `updatedAt`, with `onDelete: Cascade` to `Customer` and indexes on
  `customerId` and `expiresAt`.

No existing table, column, index, or relation was renamed or removed, and no
catalog/order/download data was rewritten. The seed stays idempotent and keeps
seeding 8 categories, 6 products, 1 demo customer, 3 orders, 5 order items, and 5
download records; the demo customer is intentionally seeded **without** a
password hash so no credential is committed.

`prisma.config.ts` also gained `--conditions=react-server` for the seed command.
This mirrors the flags the test scripts already use and fixes a pre-existing
failure: `prisma/seed.ts` transitively imports a `server-only` module, which
throws under plain `tsx` because that package's export map only resolves under
the `react-server` condition.

## Protected routes and authorization

`/account`, `/account/purchases`, `/account/purchases/[id]`,
`/account/downloads`, and `/account/settings` each call `requireCustomer()`,
which redirects to `/login` when there is no valid session.

- The check lives in **each page**, not only in `src/app/account/layout.tsx`.
  Next.js layouts do not re-render on client-side navigation and do not control
  whether the rest of a route renders, so a layout-only guard is not a boundary.
  The layout also calls it to render the sidebar identity.
- `requireCustomer()` reads the session cookie **before** checking service
  availability. Reading cookies opts the route into per-request rendering, which
  keeps these routes dynamic; without that ordering Next.js prerendered them as
  static redirects at build time.
- There is no `proxy.ts`/middleware guard. Proxy-level checks are optimistic only
  and must never be the sole defense; enforcement happens where the data is read.
- Every account read is scoped by the session's customer ID.
  `getCustomerOrderById(customerId, orderId)` filters on
  `{ customerId, id }` and returns `undefined` both when an order does not exist
  and when it belongs to someone else, so an unowned order ID renders the
  existing "not part of your purchase history" 404 rather than another
  customer's data. The previous unscoped `getOrderById` was removed.
- Server Functions accept only IDs plus the requested change — never an owner ID
  or a record. `updateAccountSettingsAction` takes the customer from
  `requireCustomer()`, so the submitted form cannot name a different account, and
  the email address is rendered read-only **without** a `name` attribute so it is
  not submitted at all. Email changes are out of scope for this PR.

## Server Functions and forms

Server Functions are public POST endpoints, so each one authorizes and validates
independently of what the UI rendered:

- `signInAction` / `registerAction` validate with `validateLoginInput` /
  `validateRegistrationInput`, map service failures to stable user-facing
  messages (`EMAIL_TAKEN`, `INVALID_CREDENTIALS`, `UNAVAILABLE`, generic error),
  and never echo the submitted password back.
- `registerAction` creates the customer and signs the new account in during the
  same request, then redirects to `/account`.
- `signOutAction` calls `signOutCurrentSession()` (delete row + clear cookie) and
  redirects to `/login?signed-out=1`.
- `updateAccountSettingsAction` validates, updates, and calls
  `revalidatePath("/account", "layout")` **before** any `redirect()`, since
  `redirect()` throws control flow.
- Next.js rejects cross-origin action requests. Verified against the production
  build: the same sign-in POST is processed with no `Origin` header or a
  same-origin `Origin`, but is rejected with a 500 and issues no cookie when it
  carries `Origin: https://evil.example`.
- Forms are plain `<form action={serverAction} method="post">` with
  `useActionState`, so they also work without JavaScript through the hidden
  `$ACTION_*` fields React renders. The client-side confirm-password check calls
  `preventDefault()`, which cancels the action submission.
- `/login` and `/register` keep their existing `AuthPanel` visual language,
  `autoComplete` hints, hints/errors rendered by `FormField`, and responsive
  layout. Signed-in visitors are redirected away from both to `/account`.
- Query-parameter notices (`?error=service-unavailable`, `?signed-out=1`) are
  resolved through a fixed allow-list in `resolveAuthNotice`, so reflected query
  text is never rendered.

## Behaviour without a database

Account routes have **no** fixture fallback — the PR #4 demo identity is gone.
When `DATABASE_URL` is missing or unusable, `isAccountServiceAvailable()` is
false: `/login` and `/register` render an "Account services unavailable" notice
with disabled inputs, account reads resolve to empty, and protected routes
redirect. The marketplace keeps its existing database-free catalog fallback
(`{ products, categories }`), which is unchanged behaviour from PR #5.

## Testing

`npm test` runs two groups:

1. `node --experimental-strip-types --test tests/account-presentation.test.mjs
   tests/model-preview.test.mjs` — 24 tests.
2. `node --conditions=react-server --import=tsx --test
   tests/authentication.test.mjs tests/database-foundation.test.mjs` — 43 tests
   (35 new authentication tests plus the 8 existing data-layer tests).

`tests/authentication.test.mjs` covers, without a database: scrypt digest format
and rejection of malformed/downgraded digests, decoy verification timing,
registration success/duplicate/validation, sign-in success and all three failure
modes, generic errors with sanitized logging, `UNAVAILABLE` when no client
exists, invalid `DATABASE_URL` handling, token entropy and cookie policy
(`HttpOnly`/`SameSite`/`Secure`/`Path`/`Max-Age`) and lifetime clamping, session
read/expiry/tamper/logout/multi-device behaviour, profile-update scoping, the
credential-free customer projection, a source-level guard that every protected
route calls `requireCustomer()`, Server Function authorization order, absence of
credential logging, and the `.env.example`/`.gitignore` secret rules.

`tests/database-foundation.test.mjs` was updated for the new contracts: account
reads return empty with no database, order reads are keyed by
`{ customerId, id }` (asserted exactly), and the fallback shape is
`{ products, categories }`.

`tests/account-presentation.test.mjs` no longer asserts the PR #4 "forms cannot
submit" behaviour. It now asserts that the auth and settings forms post to Server
Functions, expose exactly the named controls the server validates, keep
`autoComplete`/`minLength`/required semantics, render the settings email as
read-only without a `name`, store no credentials in the browser, and cover the
new `customerInitials`, `toIsoDate`, and `resolveAuthNotice` helpers.

## Verification performed

All commands were run against the branch with a locally provisioned PostgreSQL
18.4 instance (see "Environment limitations" below):

- `npm run lint` — exit 0, no findings.
- `npm run typecheck` — exit 0.
- `npm run build` (production, without `DATABASE_URL`) — exit 0. `/`,
  `/products`, `/products/[slug]`, `/login`, `/register`, `/account`,
  `/account/purchases`, `/account/purchases/[id]`, `/account/downloads`, and
  `/account/settings` all report `ƒ (Dynamic)`; only `/_not-found` and
  `/icon.svg` are static.
- Migrations applied to a fresh database, then `npm run db:seed` twice — the
  second run is a no-op, confirming idempotence.
- `npm test` — 67 tests, 0 failures.
- An end-to-end HTTP run against `next start` with a real database (108 checks,
  0 failures) that submits the actual rendered forms as a browser would:
  registration → session cookie attributes → duplicate email → five invalid
  registration cases → wrong password/unknown email/invalid input → mixed-case
  sign-in → remember-me lifetime → each protected page → another customer's order
  ID returning 404 → settings read/update/invalid/unauthenticated → cross-origin
  rejection → logout (row deleted, cookie cleared, revoked cookie rejected,
  other sessions unaffected) → signed-in visitors redirected off `/login` →
  expired-session cleanup → no credential material in any response.

No real browser was available in this environment, so interactive behaviours
that require one — focus management, the password visibility toggle,
`useActionState` pending transitions, and the responsive layout at real
viewports — were verified by code inspection and by the existing component
tests, not by driving a browser. The HTTP end-to-end run covers the
progressive-enhancement (no-JavaScript) form path, which exercises the same
Server Functions the client calls.

## Environment limitations

- `sudo apt-get install postgresql` failed (unreachable package indexes), so a
  temporary PostgreSQL 18.4 cluster was provisioned in `/tmp` via the npm
  `embedded-postgres` package, outside the repository. No repository file,
  script, or dependency was added for it.
- Prisma's schema-engine binary could not be downloaded (binary CDNs are
  unreachable here). `prisma generate` and `prisma validate` succeed with
  `PRISMA_SCHEMA_ENGINE_BINARY` pointed at a local stub, so `prisma migrate
  dev`/`migrate diff` could not be exercised. The migration SQL is hand-written
  and was applied to a real database with `pg`, then verified by inspecting the
  resulting tables and columns.
- No `psql` client is available; database inspection was done with Node and the
  repository's existing `pg` dependency.

## Explicitly deferred

Payment provider integration, checkout, real payment processing, secure paid-file
delivery (download buttons stay disabled), admin and seller dashboards, email
verification, password-reset email infrastructure, OAuth/social login, login rate
limiting/brute-force throttling, account deletion, email address changes, and any
visual redesign.

Known accepted trade-offs: registration reports "an account already uses this
email address", which is enumerable by design (sign-in deliberately is not);
sessions are not rotated on privilege change because there is no privilege
system yet; and there is no per-IP throttling on sign-in, which should be added
before production traffic.
