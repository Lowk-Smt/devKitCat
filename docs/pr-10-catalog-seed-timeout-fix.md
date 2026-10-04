# PR #10 — Fix the catalog seed `P2028` failure and its silent error output

Follow-up to [`docs/pr-9-catalog-seed.md`](pr-9-catalog-seed.md). Running
`npm run db:seed:catalog` against the production Neon database failed with
Prisma error code `P2028`, and the CLI printed nothing but that code, so the
cause could not be read off the failure. This change fixes the timeout, makes
the CLI report the real error without ever printing credentials, and keeps the
catalog-only safety and idempotency promises intact.

## Symptom

```
$ npm run db:seed:catalog
> tsx --conditions=react-server prisma/seed-catalog.ts

[devKitCat catalog seed] Failed (P2028). Check DATABASE_URL and apply migrations before seeding the catalog.
```

Migrations were already applied (`prisma migrate status` reported the schema as
up to date), so the fatal-error hint in that line was misleading: the command
never got far enough to hit a schema problem.

## Root cause (measured, not assumed)

`seedCatalog()` ran the whole catalog write in one **interactive** transaction
with **no explicit options**:

```ts
await prisma.$transaction(async (tx) => {
  await writeCatalog(tx, data);
});
```

Prisma's interactive-transaction defaults are `maxWait: 2000` and
`timeout: 5000` (milliseconds) — verified in Prisma 7.10.0 in
`node_modules/@prisma/client/runtime/client.js`
(`transactionOptions:{maxWait:…??2e3,timeout:…??5e3}`) and documented in
`src/generated/prisma/internal/prismaNamespace.ts`.

The catalog write is not a handful of statements. Instrumenting the in-memory
Prisma stand-in shows **41 sequential statements**, plus `BEGIN` and `COMMIT`:

| Statement                        | Count |
| -------------------------------- | ----- |
| `category.upsert`                | 8     |
| `product.upsert`                 | 6     |
| `productImage.deleteMany`        | 6     |
| `productModelPreview.deleteMany` | 6     |
| `productChangelogEntry.deleteMany` | 6   |
| `productImage.upsert`            | 1     |
| `productModelPreview.upsert`     | 2     |
| `productChangelogEntry.upsert`   | 6     |

Every statement is its own network round trip, and nothing is pipelined. With a
remote database (Neon over TLS) the 5-second default budget expires in the
middle of that sequence, and Prisma aborts the transaction:

```
PrismaClientKnownRequestError (P2028)
meta: {"modelName":"ProductImage","operation":"query","timeout":5000,"timeTaken":5792}
message: Transaction API error: A query cannot be executed on an expired
transaction. The timeout for this transaction was 5000 ms, however 5792 ms
passed since the start of the transaction. Consider increasing the interactive
transaction timeout or doing less work in the transaction.
```

The exact failure was reproduced locally without touching any real database:
a local PostgreSQL-compatible server (`prisma dev`, PGlite-based) was seeded
through a TCP relay that delays every packet by 100 ms in each direction
(`node --conditions=react-server --import=tsx prisma/seed-catalog.ts`):

- **Before this change:** `[devKitCat catalog seed] Failed (P2028)` after ~6.8s
  (the transaction expired at 5792 ms, exactly the default `timeout: 5000`).
- **After this change:** succeeds and reports the elapsed time (~25.9s through
  that deliberately slow relay) because the budget is now 60 seconds.

`P2028` has two shapes in the runtime and both were checked:

- **Transaction expiry** (`pn` class): "A … cannot be executed on an expired
  transaction. The timeout for this transaction was X ms, however Y ms passed
  since the start of the transaction." — the production failure.
- **Startup timeout** (`fr` class): "Unable to start a transaction in the given
  time." — this would happen if the pg pool could not hand out a connection
  within `maxWait` (Prisma default 2s), which is why `maxWait` is raised too and
  kept above the pool's own `connectionTimeoutMillis`.

## The fix

- **`src/lib/server/seed-catalog.ts`** exports
  `CATALOG_SEED_TRANSACTION_OPTIONS = { maxWait: 15_000, timeout: 60_000 }` and
  passes it to `prisma.$transaction`. Prisma 7 requires *both* keys when an
  options object is supplied (a partial object is rejected with "maxWait is
  required" / "timeout is required"), so both are set explicitly rather than
  relying on client-level defaults. The seed is still one transaction, so the
  catalog remains all-or-nothing.
- **`prisma/seed-catalog-runner.ts`** builds the client with
  `errorFormat: "minimal"` (the default "colorless" format prefixes errors with
  an absolute-path source excerpt that buries the actual cause), keeps
  `max: 1`/`connectionTimeoutMillis: 5_000` (intentionally below `maxWait` so a
  stalled pool surfaces the driver's descriptive error instead of Prisma's
  generic startup-timeout `P2028`), and logs the elapsed time so future runs can
  be compared against the budget.
- **`src/lib/server/seed-error.ts`** (new) turns any thrown value into a
  secret-safe report:
  - error code (`P2028`) and error class name when they match safe patterns,
  - the actual message, single-lined and length-capped,
  - flattened scalar Prisma metadata (for `P2028`: `modelName`, `operation`,
    `timeout`, `timeTaken`), with credential-shaped keys and deep nesting
    dropped,
  - a per-code operator hint (`P2028` explains the budget and that re-running is
    safe; `P2021`/`P2022` point at `npm run db:deploy`; `P1001`/`P1002` at
    connectivity, …).
- **`prisma/seed-catalog.ts`** prints that report on failure, passing the
  connection string in as a secret to be scrubbed.

## Never logging credentials

The redaction pipeline works on both the message and every metadata value, and
is applied *before* anything is written to stderr:

- the configured connection string is replaced whole with
  `[redacted-database-url]`, and its username, password (raw and
  percent-decoded), host, and hostname are scrubbed individually as
  `[redacted]` / `[redacted-host]`;
- any database-shaped URL (`postgres`, `postgresql`, `mysql`, `mssql`,
  `mongodb`, `prisma`, `cockroachdb`, `redis`) is replaced whole;
- credentials embedded in other URLs (`https://user:pass@…`) lose their
  userinfo;
- `password=`/`secret=`/`token=`/`user=`/`role=` assignments and PostgreSQL's
  `for user "…"` phrasing are redacted;
- metadata keys such as `user`, `username`, `password`, `connectionString`,
  `host`, `port`, and `url` are dropped entirely;
- ANSI escapes, control characters, and newlines are collapsed to one line, and
  long values are truncated.

Example output for the fixed command when a transaction does expire (forced with
a 3s budget for the test):

```
[devKitCat catalog seed] Failed (P2028) PrismaClientKnownRequestError.
  message: Invalid `prisma.category.upsert()` invocation: Transaction API error: A query cannot be executed on an expired transaction. The timeout for this transaction was 3000 ms, however 3312 ms passed since the start of the transaction. Consider increasing the interactive transaction timeout or doing less work in the transaction.
  meta: modelName=Category operation=query timeout=3000 timeTaken=3312
  hint: The interactive transaction did not finish inside its budget (see timeout/timeTaken in the metadata above). …
```

## Explicitly unchanged

- **Catalog-only safety.** The typed `CatalogTransaction` still exposes only the
  five catalog delegates; no customer, session, cart, order, order-item, or
  download table is read or written, and the existing test that asserts zero
  delegate calls against those tables still passes.
- **Idempotency.** Same upserts, same stable unique keys, same pruning of
  trailing child positions; only the transaction budget and the error output
  changed.
- **The full demo seed.** `npm run db:seed` / `prisma db seed` and
  `seedMarketplace()` are untouched; only `seedCatalog()` (used by
  `npm run db:seed:catalog`) received the explicit budget.
- **No migration, schema, or read-path changes.** `prisma/schema.prisma` and
  `prisma/migrations/` are untouched, and the storefront read paths are
  unchanged.

## Validation

- `npm test` — 85/85 passing on a generated client (was 76, with 1 skipped): the
  new `tests/seed-error-report.test.mjs` cases plus the new transaction-budget
  case in `tests/catalog-seed.test.mjs`.
- `npm run lint` — clean.
- `npm run typecheck` — clean.
- `npm run build` — clean (18/18 static pages).
- End-to-end against a local PostgreSQL-compatible server (`prisma dev`), using
  a fresh schema: the seed succeeds directly (1.1s) and through a +200 ms RTT
  relay (25.9s — the same run that reproducibly failed with `P2028` before the
  fix); running it twice leaves identical rows (8 `Category`, 6 `Product`, 1
  `ProductImage`, 2 `ProductModelPreview`, 6 `ProductChangelogEntry`) with
  `Customer`, `Session`, `CartItem`, `Order`, `OrderItem`, and `Download` still
  empty.
- The failure path is covered end-to-end: the test suite spawns the CLI with an
  unreachable URL whose username and password are distinctive strings and
  asserts the output contains neither, nor the host.
- No production database was contacted, no production seed was run, and no
  migration was applied for this change. `prisma migrate status` against
  production remains the project owner's check.

### Environment note

The sandbox blocks `binaries.prisma.sh`, so the Prisma CLI's schema-engine
download fails. `prisma generate` (and therefore `npm run typecheck` /
`npm run build`, whose pre-scripts run it) works with a stub engine binary:
`PRISMA_SCHEMA_ENGINE_BINARY=/bin/true npm run typecheck`. That workaround is
only for this environment; no repository file depends on it.
