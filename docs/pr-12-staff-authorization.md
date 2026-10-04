# PR #12 — Private creator management, Phase 1 (owner + authorized staff only)

Business decision this PR implements: **at launch, only the owner and explicitly
authorized staff may create or manage marketplace products.** Anyone may still
register a normal customer account and use the storefront exactly as before.
Public creator applications and creator self-service stay disabled, so this PR
delivers the *authorization foundation* plus the smallest protected management
surface that proves it — not an upload system, not a moderation queue.

Nothing here is merged, deployed, or applied to a database. The migration is
committed for review and must be applied manually (see
[Rollout](#rollout-do-this-by-hand-in-this-order)).

## Root cause: the operation did not exist

`grep` for `admin|staff|creator|role|rbac` across `src/`, `prisma/`, and
`tests/` before this change returned **no product-management code at all**:

| What the brief asks to restrict | State before this PR |
| ------------------------------- | -------------------- |
| Product create                | did not exist |
| Product edit                  | did not exist |
| Publish / unpublish           | only `Product.published` as a column, written by the seed |
| Product delete                | did not exist |
| Who is a creator              | no role, no table, no enum anywhere in the schema |
| Admin routes/actions          | none |

So "restrict product management to staff" cannot be done by adding a check to an
existing endpoint: the endpoint has to be introduced, and it has to be born
restricted. That is why this PR contains both a policy layer (`staff-core.ts`)
and a minimal `/manage` surface — the smallest thing that makes the rule real
and testable. Everything a full editor needs later (media, changelog entries,
documents, pricing history) is deliberately out of scope.

## Data model: a grant is not a customer field

`prisma/schema.prisma` gains exactly two model-level things:

```prisma
enum StaffRole {
  OWNER
  STAFF
}

model StaffMembership {
  id                  String    @id @default(cuid())
  customerId          String    @unique
  role                StaffRole @default(STAFF)
  grantedByCustomerId String?
  createdAt           DateTime  @default(now()) @db.Timestamptz(3)
  updatedAt           DateTime  @updatedAt @db.Timestamptz(3)

  customer  Customer  @relation("StaffMembershipHolder", fields: [customerId], references: [id], onDelete: Cascade, onUpdate: Cascade)
  grantedBy Customer? @relation("StaffMembershipGrantor", fields: [grantedByCustomerId], references: [id], onDelete: SetNull, onUpdate: Cascade)

  @@index([role])
  @@index([grantedByCustomerId])
}
```

plus `Customer.staffMembership StaffMembership?` and
`Customer.grantedStaffMemberships StaffMembership[]`.

Four properties of that shape are the whole security story, and they are the
reason a separate table was chosen over a `role` column on `Customer`:

1. **No user-facing write path can express a grant.** Registration,
   `/account/settings`, cart, and checkout all write `Customer` columns; there is
   no role column on `Customer`, so "sign up as owner" has nothing to write to.
   `StaffMembership` can be created only by `staff-service.ts`.
2. **Ordinary customers are the default, structurally.** A customer *is*
   non-staff unless a row exists. Nothing has to be remembered, defaulted, or
   scrubbed, and a missing row is the same answer as a revoked one.
3. **There is no `CREATOR` enum member.** A future creator cannot accidentally
   satisfy a staff check, because the type cannot name them. Creator permissions
   get their own model in a later phase (see [Extension seams](#extension-seams)).
4. **The grant is auditable and self-limiting.** `grantedByCustomerId` records
   who wrote the row — including `OWNER` rows, so a second owner cannot appear
   unexplained (null only when the CLI wrote it, where the actor is an operator
   rather than a customer);
   `customerId @unique` means a grant can be changed but never stacked, holder
   rows cascade with the account (like `Session`), and the grantor link is
   `SetNull` so deleting a staff account does not silently destroy audit history.

`Product.published @default(false)` was already in the schema and is unchanged —
it is what makes "create" safe: a new draft is invisible to the storefront until
someone explicitly publishes it.

### Migration status

`prisma/migrations/20261004120000_add_staff_access/migration.sql` is strictly
additive: one `CREATE TYPE`, one `CREATE TABLE`, three indexes (one unique), two
`ADD CONSTRAINT` foreign keys. It contains no `DROP`, no `TRUNCATE`, no
`UPDATE`, no `DELETE`, no `INSERT`, and it does not touch `Product`, `Order`,
`CartItem`, `Download`, `Session`, or `Customer` — a test asserts exactly that
(statement-anchored, so `ON DELETE CASCADE` in a comment cannot slip past it).

> **This migration has not been applied anywhere, and it was not machine-checked
> in the environment where this PR was written.** There is no reachable
> PostgreSQL and no working Prisma CLI here (the schema-engine binary in the
> sandbox is a stub, so `prisma migrate diff` cannot run — `prisma validate` and
> `prisma generate` do work). The SQL was hand-written to match the conventions
> of the three committed migrations and the exact `@db`/relation settings above,
> in the same style as the existing hand-written migration directories.
> **Required before merge:** run `prisma migrate dev` (or `migrate diff
> --from-replicas`) against a scratch database and keep the generated SQL, and
> confirm the committed file is byte-compatible with what Prisma produces.

## Security model

### The policy is one pure module

`src/lib/server/staff-core.ts` owns every rule and knows nothing about Next.js,
Prisma, or the request:

```ts
export const STAFF_PRIVILEGES = ["products:view", "products:manage", "products:delete", "staff:manage"]
ROLE_PRIVILEGES = {
  staff: ["products:view", "products:manage", "products:delete"],
  owner: [...those, "staff:manage"],
}
```

* `hasStaffPrivilege(access, privilege)` is the only authorization question, and
  it **re-validates the role** (`isStaffRole(access.role)`) before looking
  privileges up, so a forged `StaffAccess` object carrying its own `privileges`
  array, or a stored role outside the enum, grants nothing. `createStaffAccess`
  fails closed for the same reasons and forces `customerId` to be the session's
  own id.
* Privileges are **derived from the role, never supplied by a caller**. No form
  field, cookie, header, query parameter, or client state is ever read as a
  role. The only role that is parsed from input is an owner's *grant* form, via
  `parseGrantableStaffRole`, whose two outcomes are `owner` and `staff` and which
  defaults to **`staff`** — never upward.
* Delete is its own privilege so a later phase can narrow staff rights (or widen
  a creator's) without touching authentication.
* Refusals are one short generic sentence each (`describeStaffFailure`). None of
  them says whether an account exists, what it holds, or which row was touched;
  `ERROR` is logged as `{ resource, code: "P2xx" }` only, never an email, id, or
  digest (asserted by a test that fails if the log line grows a value).

### The gate, in order

Two entry points, one check:

| Layer | Helper | Behavior on refusal |
| ----- | ------ | ------------------- |
| Pages (`/manage`) | `requireStaffAccess(privilege)` in `src/lib/server/staff.ts` | `redirect()` — signed out → `/login`; authenticated non-staff → `/account?staff=denied` |
| Server Functions | `authorizeStaffAction(privilege)` in `src/lib/server/product-admin-actions.ts` / `staff-actions.ts` | `{ ok: false, code }` → `redirect("/manage?notice=…")` |

Both resolve the actor from the **session** and nothing else:

```
getAuthenticatedCustomer()      // verified scrypt session → { id, email, … }
  → staffAccess.getAccessForCustomer(customer.id)   // StaffMembership lookup
  → getStaffAccess() re-checks access.customerId === customer.id
  → hasStaffPrivilege(access, privilege)
```

Every non-yes branch denies: no session, no `DATABASE_URL`, a lookup that threw,
an unknown role, a missing grant. `getStaffAccess` is wrapped in React's
`cache()` — memoized **per request only**, never in `unstable_cache` — because a
revoked grant must stop working on the next request rather than at the end of a
cache TTL, and because private per-account state must never enter a shared cache.

### The service re-checks, because hiding a button is not security

`createStaffAccessService` and `createProductAdminService` both take the actor as
the **first argument** and call `authorize(actor, privilege)` at the top of every
single method — `listProducts` (`products:view`), `createProduct`, `updateProduct`,
`setPublished` (`products:manage`), `deleteProduct` (`products:delete`),
`grantMembership`/`revokeMembership`/`listMemberships` (`staff:manage`). A caller
that skipped the action-level gate and invoked `productAdmin.deleteProduct(null, id)`
directly gets `FORBIDDEN` and no query. This is asserted for every exported
Server Function (`tests/staff-authorization.test.mjs` reads the source and checks
that `authorizeStaffAction` is the first `await` in each one).

The order inside each action is fixed and tested:

1. `authorizeStaffAction(privilege)`;
2. *then* read the form — product content only, never an id or role;
3. call the service, which re-checks and writes;
4. `updateTag(CATALOG_CACHE_TAG)` + `revalidatePath("/manage")` + redirect to an
   allowlisted notice.

Mutations arrive through plain `<form action={serverFunction}>` on Server
Components (no client JS), so they are same-origin POSTs subject to Next.js's
built-in Server-Action origin check — a cross-site form cannot reach them, and a
GET cannot either.

### The public catalog is untouched

* `data-access-core.ts` still hardcodes `{ published: true }` in its `where` for
  `listProducts`; `/products`, `/products/[slug]`, and the homepage keep using it.
* The tagged shared cache (`catalog-cache.ts`, `revalidate: 60`,
  `tags: ["catalog"]`) is still the only `unstable_cache` in the app, and it is
  still public-only. Management reads bypass it entirely and go straight to
  `PrismaClient`, so a draft list can never be stored under a public cache key.
* Publishing/unpublishing calls `updateTag(CATALOG_CACHE_TAG)` (not the
  deprecated one-argument `revalidateTag`), so the storefront drops the entry
  *immediately* rather than within 60 seconds — "unpublished" means gone now.
* `/manage` calls `await connection()` and sets
  `metadata.robots = { index: false, follow: false }`; `next build` confirms all
  15 routes including `/manage` are `ƒ (Dynamic)` — nothing private is
  prerendered into a shared artifact.
* No product-management surface is linked from the header, footer, or any public
  page (test-enforced). Reaching `/manage` requires knowing the URL; there is no
  public way to ask for access.

### Self-promotion: four independent reasons it cannot happen

1. **Registration/profile code never sees a role.** The self-promotion boundary
   was left exactly as PR #6 built it: `registerCustomerAction` accepts only
   `name`, `email`, `password`, `confirmPassword`, `acceptTerms`, and the service
   writes the `Customer` columns it enumerates. A test asserts that none of
   `auth-core.ts`, `auth-service.ts`, `auth-actions.ts`, or the account settings
   path contains `staffMembership`, `StaffRole`, or `grantedByCustomerId`.
2. **The table has no reachable write path except the service**, and the service's
   grant method requires `staff:manage` from the *session's own* actor.
3. **Grants are addressed by email, never by id.** An owner types an address; the
   server resolves it to a `Customer` row. There is no `customerId`/`actorId`
   field in any management form, so a client cannot name a victim — and it cannot
   name itself either, because raising *your own* role through that form is
   either a no-op (already `owner`) or `FORBIDDEN` (`staff` lacks
   `staff:manage`). The one thing a submission can do to its own actor is
   *lower* a role, which the last-owner guard then limits: `evaluateMembershipChange`
   refuses demoting or revoking the only remaining owner inside the same
   transaction as the write. The panel marks your own row "(you)" for clarity —
   that label is presentation, the guard is server-side.
4. **Bootstrap cannot be triggered by a request.** `bootstrapOwnerAccess` requires
   `confirmation === OWNER_BOOTSTRAP_CONFIRMATION`, and only
   `prisma/grant-owner-runner.ts` imports that constant — a test fails if any
   module under `src/app/` or any `"use server"` module imports it. The first
   registered user, the most recent registered user, and "the account with no
   orders" are never promoted: nothing inspects signup order at all. `seed.ts`
   and `seed-catalog.ts` cannot create or promote staff either (test-enforced),
   so the demo seed cannot mint an owner by accident.

### Owner bootstrap (the only way to create the first grant)

`npm run db:grant-owner` (`prisma/grant-owner.ts` + `grant-owner-runner.ts`):

```
npm run db:grant-owner -- --help
npm run db:grant-owner -- --email you@example.com            # dry run (default)
npm run db:grant-owner -- --email you@example.com --apply    # writes
MARKETPLACE_OWNER_EMAILS="a@x.test, b@y.test" npm run db:grant-owner -- --apply
```

* **Dry run is the default.** `--apply` is required to write, and the dry run
  still connects and reports the *current* state of each address.
* Accepts repeated `--email` **or** `MARKETPLACE_OWNER_EMAILS`, never both, and
  refuses an invalid, over-long, or truncated list (`MAX_BOOTSTRAP_OWNER_EMAILS`
  = 10) rather than silently promoting a subset. Tokens are sanitized
  (control characters and ANSI escapes stripped) before they reach a terminal.
* `DATABASE_URL` is validated (`normalizeDatabaseUrl`, the same helper the seed
  uses) *before* the Prisma import, so a bad connection string produces the
  repo's normal safe error report and never a printed credential.
* Per address it calls `describeBootstrapAccount` and refuses — with a
  non-zero exit code — an address that is not a registered customer, has no
  `passwordHash` (e.g. the seeded demo customer), or cannot be looked up. It
  never creates an account and never sets a password.
* The pool is `max: 1` and disconnected in `finally`; `{granted, alreadyOwner,
  wouldGrant, failed}` is printed per address, so re-running is a no-op.
* The runner passes the confirmation literal and nothing else. There is **no
  shared staff password** anywhere in the repo (test-enforced).

## Environment variables

| Name | Required? | Read by | Notes |
| ---- | --------- | ------- | ----- |
| `DATABASE_URL` | yes for staff access (already required by PRs #5-#7) | `src/lib/server/database.ts`, both seed CLIs, the grant CLI | Without it `isStaffServiceAvailable()` is false, `/manage` refuses as `unavailable`, and the storefront keeps its fixture fallback. Never a "grant bypass" state. |
| `MARKETPLACE_OWNER_EMAILS` | no | **only** `prisma/grant-owner.ts` | Optional convenience list of already-registered addresses the operator may promote. Not a secret, not a sign-in key, not a deploy hook: nothing reads it during a request, so setting or clearing it changes nobody's access. Documented in `.env.example`. |

No new secret is introduced, and no existing one is read by this code. `Auth.js`,
JWTs, `AUTH_SECRET`, and any hardcoded staff password are absent by design.

## Extension seams (so Phase 2/3 cannot widen Phase 1)

* **Creator applications** do not need a `StaffRole` member. A separate
  `CreatorApplication` (or `CreatorProfile`) table holding status + a relation to
  `Customer` is the natural next step: a pending or approved application then
  grants nothing on its own, because `hasStaffPrivilege` only consults
  `ROLE_PRIVILEGES`.
* **Creator product permissions** hang off `STAFF_PRIVILEGES` already
  (`products:view`/`products:manage` are the same names a creator needs). A
  creator's `StaffAccess`-shaped decision would be computed from *their own*
  relation table with `product.ownerId` scoping added to the service's writes —
  the service is already the single place that turns an actor into a query, which
  is why scoping will land in one file rather than in every form.
* **Staff moderation** is what `staff:manage` (owner-only) and
  `listMemberships`/`grantMembership`/`revokeMembership` exist for. A future
  "moderator" is a new privilege in `STAFF_PRIVILEGES` + a new `ROLE_PRIVILEGES`
  entry — never a new way to write `StaffMembership`.
* `MANAGE_NOTICES`, `ManagedProductRow`, `ProductDraftForm`, and
  `validateProductDraftInput` are the seams for the real editor: adding a field
  means adding it to the validator and the row type, not to the authorization
  path.

## Minimal protected surface that ships

`/manage` (`src/app/manage/layout.tsx` + `page.tsx`,
`src/components/manage/*`, `src/components/manage/manage.module.css`):

* **Catalog list** of every product, published or not, with price, version, type,
  category, and reference counts; publish/unpublish toggles; delete (refused with
  an explanation when an `OrderItem`, `Download`, or `CartItem` still references
  the row — those relations are `onDelete: Restrict` on purpose, and unpublishing
  is the supported way to retire a sold product).
* **New draft** form: title, slug, price, version, type, category, description.
  Validation is `validateProductDraftInput` (title 3-120, description 20-2000,
  slug 2-80 `[a-z0-9-]` after an NFKD slugify, price → integer cents then
  `DECIMAL(10,2)`, version and category patterns). The price is *never* trusted
  from the browser: the storefront keeps computing totals from the `Product` row.
  A created product is always `published: false`, and a duplicate slug is
  refused (`SLUG_TAKEN`) rather than rewritten.
* **Staff access** panel, rendered only for `staff:manage` actors: the directory
  (role, grant date, `bootstrapped` marker, whether the holder can sign in) and
  grant/revoke by email. `revokeMembership` maps Prisma's `P2025` to `NOT_FOUND`.
* Notices come from the `MANAGE_NOTICES` allowlist: `?notice=anything-else`
  renders nothing, so the query parameter is never reflected into the page.

## Limitations, and what needs a human

* **No link to `/manage` anywhere in the public UI.** Deliberate for launch; it
  also means an owner must know the URL. Do not add a public "become a creator"
  entry point without the application flow in Phase 2.
* **No `StaffSession`, no impersonation, no separate staff login.** Staff sign in
  with the same customer account. Revoking a grant leaves a working customer
  account — that is the intended behavior, not a leak.
* **An owner can lower their own role** to `staff` when another owner exists (and
  cannot when they are the last one). Self-*raising* is impossible; self-*lowering*
  is a deliberate escape hatch for stepping down, not a bug to fix in the UI.
* **No 2FA, no login rate limiting, no IP/device policy** for staff (inherited
  from PR #6, listed under Status in the README). An owner account whose password
  is compromised can manage products and grant access; treat owner credentials as
  production credentials.
* **Media, changelog entries, documentation, price history, and 3D previews are
  not editable** here; they remain seed-owned. `db:seed:catalog` is still the only
  way to load the curated catalog, and it must never be replaced by the full demo
  seed in production (it creates a passwordless demo customer).
* **Rate limiting on grants**: none, beyond owner-only access to the form. If the
  owner surface is ever exposed to more people, add throttling to
  `grantMembership` in the service (the right layer — the UI is not the guard).
* **Migration is not applied and not machine-verified** in this environment (see
  [Migration status](#migration-status)).
* **No creator application table** was pre-created: an unused schema shape is
  worse than a documented seam.

## Rollout: do this by hand, in this order

1. **Review and merge is a separate decision from deploying.** Nothing in this PR
   runs automatically; there is no post-merge migration hook.
2. **Scratch-database check first:** `npx prisma migrate dev` (or
   `migrate diff`) on a throwaway database, and confirm the committed
   `migration.sql` matches.
3. **Apply the migration** — the additive SQL only — through the existing manual
   `Initialize production database` GitHub Actions workflow (`prisma migrate
   deploy` + `migrate status`, `DATABASE_URL` as a repository secret), or
   `npm run db:deploy` with the Neon **direct** connection string. Re-running is
   safe; existing rows are untouched, and every existing customer stays
   non-staff because no membership row is inserted.
4. **Register the founder as a normal customer** at `/register` (this creates the
   `Customer` row with a `passwordHash`; the address must exist before the grant).
5. **Bootstrap the owner** with `DATABASE_URL` pointed at the same database the
   app uses:
   `npm run db:grant-owner -- --email founder@company.test` → read the dry run
   (it must say `wouldGrant`), then re-run with `--apply`. It refuses a passwordless
   or unknown address. `MARKETPLACE_OWNER_EMAILS` may be used instead of `--email`,
   and should be cleared afterwards.
6. **Verify:** sign in as the founder, open `/manage`, create a draft, publish it,
   confirm it appears in `/products`, unpublish it, confirm it disappears from
   the storefront immediately (`updateTag`, no 60-second window). Then sign in as
   an ordinary customer and confirm `/manage` redirects to `/account?staff=denied`
   and the account area behaves exactly as before.
7. **Grant the first staff member** from the owner's Staff-access panel rather
   than the CLI, so the grant carries `grantedByCustomerId`.
8. **Rollback** is UI/action-level: revert the code and redeploy. The table can
   simply remain — no read path outside this PR consumes it, so leaving it behind
   strands no data. Only if you must drop it, delete the membership rows first;
   never run a destructive migration against production.

## Validation

| Command | Result |
| ------- | ------ |
| `npm run lint` | pass, 0 errors |
| `npm run typecheck` (`prisma generate && next typegen && tsc --noEmit`) | pass |
| `npm test` (group A: 3 files) | 27 tests, 27 pass |
| `npm test` (group B: 6 files, `--conditions=react-server`) | 128 tests, 128 pass, 0 fail, 0 skipped |
| `npm run build` | pass; 14 routes, all dynamic (`ƒ`) except `/_not-found` and `/icon.svg` |

`tests/staff-authorization.test.mjs` (new, 43 tests) covers: the pure policy
(fail-closed, no upward default, unknown role grants nothing, last-owner guard,
notice allowlist, vague refusal copy, log redaction, bootstrap-list parsing);
both services against an in-memory Prisma stand-in (unauthenticated refusal
before any query, ordinary-customer refusal, authorized-staff success,
self-promotion refusal, grant/directory/revoke end to end, idempotent OWNER
promotion + audit row, `P2025 → NOT_FOUND`, draft → edit → publish → delete,
"every write needs a grant including a rename", sold-product delete refusal,
unknown-category refusal); a cross-check that **the staff list shows drafts while
every public read stays `published`-only** (the same fixture through
`createMarketplaceDataAccess`); and source guards (page/layout gating, action
ordering, form fields limited to the draft contract, `published` written only by
the publication path, auth code cannot grant staff, no public link, seeds cannot
promote, migration is additive, only the CLI reaches the bootstrap constant, no
secrets read and nothing cached in the staff modules, `requireStaffAccess`
redirects on every non-authorized state, components submit only to guarded
actions, and the npm scripts/test registration exist).

Writing the suite found a real bug: `productNoticeCode` had a duplicated
`case "FORBIDDEN"` whose first arm returned `invalid-slug`, so a *refusal* was
reported as a *validation* problem. The shadowing arm is gone, `staffNoticeCode`
maps `FORBIDDEN → denied` and `ERROR → error`, and `MANAGE_NOTICES` gained the
`error` entry. It also caught `normalizeGrantEmail` accepting a 240-character
`a@ba@b…` string (it now reuses `normalizeEmail` + `isValidEmailAddress`, so the
same input is `INVALID_INPUT` instead of `NOT_FOUND`), and two cache/notice bugs
in the same review pass.

### Environment note

`prisma generate`/`validate` needed `@prisma/schema-engine-wasm` installed with
`--no-save` plus a stub `schema-engine-debian-openssl-3.0.x` in
`node_modules/@prisma/engines/` (the sandbox has no OpenSSL-3 native engine).
That is `node_modules`-only and is not part of this PR. `prisma migrate diff`
still cannot run there, which is why the migration statement above is honest
about being unverified.

## Files

```
prisma/schema.prisma                                  + StaffRole, StaffMembership, 2 Customer back-relations
prisma/migrations/20261004120000_add_staff_access/migration.sql   (new, additive, NOT applied)
prisma/grant-owner.ts                                 (new) CLI: parse/validate, dry run, refuses
prisma/grant-owner-runner.ts                          (new) only importer of the confirmation literal
src/lib/server/staff-core.ts                          (new) policy, notices, refusal copy, bootstrap parsing
src/lib/server/staff-service.ts                       (new) grants, directory, bootstrap write, re-checked gate
src/lib/server/staff.ts                               (new) requireStaffAccess / authorizeStaffAction / getStaffAccess
src/lib/server/staff-actions.ts                       (new) grant/revoke Server Functions
src/lib/server/product-admin-core.ts                  (new) limits, validation, row mapping, notices
src/lib/server/product-admin-service.ts               (new) list/create/update/publish/delete, gated per call
src/lib/server/product-admin.ts                       (new) service singleton
src/lib/server/product-admin-actions.ts               (new) product Server Functions
src/app/manage/{layout,page}.tsx                      (new) protected page (noindex, dynamic)
src/components/manage/*.{tsx,css}                     (new) draft form, product row, staff panel, styles
tests/staff-authorization.test.mjs                    (new) 43 tests
package.json                                          + db:grant-owner, test registration
.env.example                                          + documented MARKETPLACE_OWNER_EMAILS block
README.md                                             Status / Scripts / Routes / structure / new section
```

Related documents: [`docs/pr-6-authentication.md`](pr-6-authentication.md) (the
session model this borrows), [`docs/pr-5-backend-database.md`](pr-5-backend-database.md)
(local database and deployment setup),
[`docs/pr-9-catalog-seed.md`](pr-9-catalog-seed.md) and
[`docs/pr-10-catalog-seed-timeout-fix.md`](pr-10-catalog-seed-timeout-fix.md)
(why the catalog stays seed-owned for now).
