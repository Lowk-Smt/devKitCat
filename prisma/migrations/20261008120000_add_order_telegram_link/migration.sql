-- Order <-> Telegram connection (customer deep-link flow).
--
-- Strictly additive. No existing table is altered, no row is read, updated, or
-- deleted, and nothing is dropped, so every customer, session, order, cart
-- line, product, and download keeps its current data and meaning. The
-- `Order.telegramLink` back-relation is virtual in Prisma (the foreign key
-- lives on OrderTelegramLink.orderId), so `Order` itself is not touched.
--
-- Three small tables, each with one job:
--   * OrderTelegramLink   — the per-order connection: a one-time deep-link
--                           token stored only as a SHA-256 hash, and, once the
--                           customer presses Start in the bot, the private
--                           chat the order's conversation happens in.
--   * TelegramStaffRelay  — maps one relayed staff-chat message to the customer
--                           chat that sent it, so the owner can answer with
--                           Telegram's normal Reply action. Identifiers only,
--                           never message content. Source-update columns make
--                           outbound sends retry-safe.
--   * TelegramWebhookEvent — per-update processing state: a claim lease keeps
--                           concurrent duplicates out, `done` is permanent
--                           dedup, and a failed attempt stays retryable so a
--                           transient failure can never lose a message.

-- CreateTable
CREATE TABLE "OrderTelegramLink" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "tokenHash" VARCHAR(64) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "consumedAt" TIMESTAMPTZ(3),
    "chatId" VARCHAR(32),
    "connectedAt" TIMESTAMPTZ(3),
    "telegramName" VARCHAR(120),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "OrderTelegramLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelegramStaffRelay" (
    "id" TEXT NOT NULL,
    "linkId" TEXT NOT NULL,
    "staffChatId" VARCHAR(32) NOT NULL,
    "staffMessageId" VARCHAR(32) NOT NULL,
    "sourceUpdateId" VARCHAR(24),
    "sourceKind" VARCHAR(16),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TelegramStaffRelay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
-- The webhook's retry-safe ledger: a claimed lease ("processing") keeps
-- concurrent duplicates out, "done" is permanent dedup, and a failed attempt
-- releases the lease so Telegram's redelivery is processed instead of lost.
CREATE TABLE "TelegramWebhookEvent" (
    "updateId" VARCHAR(24) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'processing',
    "leaseUntil" TIMESTAMPTZ(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "customerMessageId" VARCHAR(32),
    "staffReplyMessageId" VARCHAR(32),
    "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "TelegramWebhookEvent_pkey" PRIMARY KEY ("updateId")
);

-- CreateIndex
-- One connection row per order; issuing a fresh link updates this row.
CREATE UNIQUE INDEX "OrderTelegramLink_orderId_key" ON "OrderTelegramLink"("orderId");

-- CreateIndex
-- The deep-link lookup key. Only the hash is stored, so a database leak cannot
-- be replayed as a link (same doctrine as Session.tokenHash).
CREATE UNIQUE INDEX "OrderTelegramLink_tokenHash_key" ON "OrderTelegramLink"("tokenHash");

-- CreateIndex
-- Answers "which order does this customer chat belong to" when relaying.
CREATE INDEX "OrderTelegramLink_chatId_idx" ON "OrderTelegramLink"("chatId");

-- CreateIndex
-- A Telegram Reply is resolved by (staff chat, replied-to message id); the
-- pair is unique so a reply can only ever route to one customer connection.
CREATE UNIQUE INDEX "TelegramStaffRelay_staffChatId_staffMessageId_key" ON "TelegramStaffRelay"("staffChatId", "staffMessageId");

-- CreateIndex
CREATE INDEX "TelegramStaffRelay_linkId_idx" ON "TelegramStaffRelay"("linkId");

-- CreateIndex
-- Retry dedup: before (re)sending, the webhook checks whether this update
-- already produced the relay/notice/forward.
CREATE INDEX "TelegramStaffRelay_sourceUpdateId_idx" ON "TelegramStaffRelay"("sourceUpdateId");

-- AddForeignKey
-- Cascade, exactly like Session: deleting an order deletes its connection.
ALTER TABLE "OrderTelegramLink"
  ADD CONSTRAINT "OrderTelegramLink_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
-- Cascade: relays are routing state for one connection and mean nothing once
-- the connection row is gone.
ALTER TABLE "TelegramStaffRelay"
  ADD CONSTRAINT "TelegramStaffRelay_linkId_fkey"
  FOREIGN KEY ("linkId") REFERENCES "OrderTelegramLink"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
