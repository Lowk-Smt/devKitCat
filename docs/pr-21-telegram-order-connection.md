# PR #21 — Telegram order connection (one-tap deep link, relay, native-Reply admin)

Business decision this PR implements: **after checkout, the order conversation
happens in Telegram, started with one tap, and the owner answers customers
directly from their Telegram app — never from a website form.**

Checkout collects name + phone exactly once; the confirmation page offers
**Start Telegram**; a one-time deep-link token binds the customer's Telegram
chat to that exact order; customer messages are relayed into the staff chat; the
owner answers with Telegram's normal **Reply** action and the bot routes the
answer to the right customer. The website remains the source of truth for
orders; the staff Telegram chat is the working transcript.

Nothing here is merged, deployed, applied to a database, or verified against a
live Telegram bot. The migration is committed for review and must be applied
manually like every previous one (`.github/workflows/migrate-production-database.yml`
remains manual-only).

## What existed and what did not

| Capability needed | State before this PR |
| --- | --- |
| Order with customer name + phone | existed (`Order.customerName/customerPhone`, PR #16) |
| Staff Telegram notification | existed (`src/lib/server/telegram.ts`, one-way, staff chat only) |
| Bot that *receives* Telegram events | did not exist (no API routes at all) |
| Order ↔ Telegram chat binding | did not exist |
| Customer deep-link connection | manual `t.me` support link; customer re-typed their order ID |
| Admin → customer messaging | did not exist |
| Telegram username at checkout | collected (optional) — **removed** by this PR |

## Architecture (one design, no alternatives shipped)

```
Website (orders = source of truth)
  └── checkout: name + phone once → PENDING_PAYMENT order (unchanged, idempotent)
  └── /account/purchases/[id]: "Start Telegram" (Server Function)
        └── issue/rotate one-time token (raw only in the redirect target)
              └── redirect → https://t.me/<bot>?start=<token>

Telegram
  └── /start <token> → POST /api/telegram/webhook (secret header required)
        ├── hash lookup → atomic conditional claim → chat ↔ order bound
        ├── customer ack:  "Thanks! We've received your order DKC-… Please wait…"
        └── staff chat:    full order summary + reply instructions
  └── customer text/media → relayed to staff chat (message id mapped)
  └── staff Reply (native Telegram action) → mapping lookup → customer chat
        └── threaded ✅/⚠️ confirmation back to the staff chat
```

Why the reply mapping is a database row and not something clever in the message:
Telegram provides no custom metadata on messages, the only stable handle is the
staff-chat `message_id` our bot receives when it *sends* the relay, and replies
to older messages must keep working. `TelegramStaffRelay` stores exactly that
pair — `(staffChatId, staffMessageId) → link` — identifiers only, no content, so
it is routing state, not chat history.

Why the button is a Server Function and not a rendered link: the raw token must
exist only in the redirect target. Each click rotates the token, so a stale
copied link dies silently and a fresh one always works; nothing is embeddable in
page HTML or logs.

## Data model (one additive migration, three small tables)

* **`OrderTelegramLink`** — `orderId @unique`, `tokenHash @unique` (SHA-256 hex;
  the raw token is never persisted), `expiresAt`, `consumedAt?`, `chatId?`,
  `connectedAt?`, `telegramName?`. One row per order; issuing rotates it.
  Connection status is derived (chat set ⇒ connected), not an enum.
* **`TelegramStaffRelay`** — `(staffChatId, staffMessageId) @unique → linkId`.
  Makes a native Reply resolvable to exactly one customer connection, forever.
* **`TelegramWebhookEvent`** — `updateId @id`. Telegram retries unacknowledged
  deliveries; the id is recorded *before* processing so a retry is a no-op
  instead of a duplicate relay.
* `Order.telegramHandle` is kept for historical rows but nothing writes it
  anymore; checkout's username field is gone.

`prisma/migrations/20261008120000_add_order_telegram_link/migration.sql` is
strictly additive (verified: no `DROP`/`TRUNCATE`, no `ALTER TABLE "Order"`,
cascade FK from `Order`). Verify with `npm run db:verify:telegram-link`
(PGlite) or `--real` against a disposable scratch database; the production-URL
guard from PR #12 is inherited.

## Security model (what makes the token safe to put in a URL)

1. **Unguessable and unrelated to orders** — 32 CSPRNG bytes, base64url (43
   chars), never derived from the order reference (which has only 5 random
   digits and stays protected by ownership checks).
2. **Hash-only storage** — same doctrine as `Session.tokenHash`; a database
   leak cannot be replayed as a link, and logs never contain the raw token.
3. **One-time, atomic claim** — `updateMany where chatId = null and unexpired`;
   concurrent Starts produce exactly one winner; duplicate Start from the same
   chat is an idempotent re-ack; a different chat is refused without leaking
   whether the order exists.
4. **Identical refusals** — unknown, expired, and stolen tokens get one message,
   so bot replies reveal nothing about orders.
5. **Ownership before issuance** — the Server Function (session customer) plus
   the service (order must be `PENDING_PAYMENT` and owned) both check; a
   connected order is never silently unbound — recovery is an explicit
   "Use a different Telegram account" action (`rebind`).
6. **Webhook authorization** — `X-Telegram-Bot-Api-Secret-Token` compared via
   SHA-256 digests with `timingSafeEqual`, rejected with 401 before the body is
   read; only `message` updates are processed; staff chat classified before
   private chats; other groups/channels ignored.
7. **Reply routing is server state** — destination chat always comes from the
   stored link; a customer cannot influence it, and only the configured staff
   chat can trigger outbound sends.
8. **Non-blocking Telegram failures** — every send is a typed result awaited
   after the database commit; claims survive failed acknowledgments; a failed
   staff reply tells the owner and touches nothing.

## Checkout change

The optional Telegram username field is removed from the checkout form and its
action wiring. `cart-service` still accepts/normalizes a legacy `telegramHandle`
input (so old payloads and the column keep working), but new orders leave it
null. Name + phone behavior, idempotency, statuses, downloads, and the staff
order notification are untouched — the existing suite
(`tests/cart-checkout.test.mjs`, `tests/telegram-checkout.test.mjs`) passes with
only the two source-assertions that pinned the removed field updated.

## Environment

| Variable | Purpose |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | server-only; bot identity for notifications and the customer flow |
| `TELEGRAM_CHAT_ID` | server-only; staff chat for notifications, relays, and replies (numeric id) |
| `TELEGRAM_WEBHOOK_SECRET` | server-only; required by the webhook route; register via `scripts/set-telegram-webhook.mjs` |
| `TELEGRAM_BOT_USERNAME` | optional, public; skips the cached `getMe` lookup when building deep links |
| `TELEGRAM_LINK_TTL_DAYS` | optional; 1–30, default 7 |
| `NEXT_PUBLIC_TELEGRAM_CONTACT_URL` | unchanged fallback used only when the bot is not configured |

## What is deliberately not here

No payment provider, no automated delivery, no guest checkout, no Telegram SDK
(native `fetch`, as before), no queues/workers/cron (webhook + Server Functions
cover it on Vercel), no `/manage` changes (the staff chat *is* the admin
surface; `orders:view` was therefore not needed), no persisted chat history, no
phone-number matching (the phone never establishes identity — the token does).

## Known limitations

* Until Telegram production is configured (token + chat id + webhook secret +
  `set-telegram-webhook` against a deployed URL), real-bot behavior is untested
  by this PR; the suite covers the logic with mocked Telegram transports.
* If the customer blocks the bot, sends fail with typed errors surfaced in the
  staff chat; recovery is the order page's reconnect action.
* Blooms of `TelegramStaffRelay`/`TelegramWebhookEvent` rows are tiny and
  content-free; pruning is left as future hygiene.
* Each click rotates the link: two browser tabs mean only the most recent
  click's deep link is live (by design; the bot refusal explains the fix).
