import "server-only";
import type { TelegramChatSendResult } from "./telegram";
import {
  CUSTOMER_LINK_REJECTED_MESSAGE,
  CUSTOMER_NOT_CONNECTED_MESSAGE,
  classifyMessage,
  formatCustomerAckMessage,
  formatCustomerAlreadyConnectedMessage,
  formatCustomerMediaNoticeToStaff,
  formatCustomerRelayToStaff,
  formatStaffReplyConfirmation,
  formatStaffReplyFailure,
  formatTelegramConnectionNotice,
  parseTelegramUpdate,
  resolveStaffChatId,
  type ClassifiedUpdate,
} from "./telegram-link-core";
import type {
  TelegramUpdateMarkers,
  TelegramLinkService,
} from "./telegram-link-service";

/**
 * The webhook brain: turns one Telegram update into the smallest safe set of
 * database writes and bot messages — retry-safely.
 *
 * Four guards, in the order they run:
 *
 * 1. **Claim before processing.** The update id is claimed in the
 *    `TelegramWebhookEvent` ledger: the first delivery inserts a `processing`
 *    row with a bounded lease, so concurrent duplicates get `in-flight` and
 *    skip. A redelivery of an already-`done` update skips forever, and a
 *    redelivery after a crashed attempt steals the expired lease and finishes
 *    only the missing work.
 * 2. **Failures stay retryable.** Any transient error releases the lease and
 *    reports `failed`, which the route answers with 500 so Telegram actually
 *    redelivers. Nothing is ever lost to a swallowed failure.
 * 3. **Sends are idempotent per update.** Outbound staff messages are keyed by
 *    `(sourceUpdateId, sourceKind)` in `TelegramStaffRelay`, and customer
 *    acks/replies by message-id markers on the event row — so a retry re-sends
 *    nothing that was already delivered and only rebuilds missing state.
 * 4. **Routing state, not message text.** A staff Reply is delivered only when
 *    the replied-to message id maps to a stored relay row, and the destination
 *    is that row's customer chat — never an id from the message itself.
 */

/** What the route turns into an HTTP status: 200 / 200 / 500. */
export type TelegramUpdateOutcome = "processed" | "skipped" | "failed";

export interface TelegramWebhookSender {
  sendChatMessage(
    chatId: string,
    text: string,
    options?: { parseMode?: "HTML"; replyToMessageId?: string; logLabel?: string },
  ): Promise<TelegramChatSendResult>;
  forwardMessage(
    toChatId: string,
    fromChatId: string,
    messageId: string,
  ): Promise<TelegramChatSendResult>;
}

export interface TelegramWebhookProcessor {
  /**
   * Processes one raw update. Resolves after all best-effort work is done;
   * `"failed"` means the route must answer 500 so Telegram retries, and the
   * update has been left retryable.
   */
  handleUpdate(update: unknown): Promise<TelegramUpdateOutcome>;
}

export interface TelegramWebhookProcessorOptions {
  links: TelegramLinkService;
  telegram: TelegramWebhookSender;
  env?: NodeJS.ProcessEnv;
}

/** Control-flow error that marks the update retryable without leaking detail. */
class UpdateRetryable extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(reason);
    this.name = "UpdateRetryable";
    this.reason = reason;
  }
}

/**
 * Bot API failures that no retry can fix: the chat is gone, the bot was
 * blocked, or the request itself is permanently invalid. Everything else
 * (network, timeout, 429, 5xx) is treated as transient and retried by Telegram.
 */
const PERMANENT_SEND_ERRORS = new Set(["HTTP_400", "HTTP_403", "HTTP_404"]);

function safeReason(error: unknown): string {
  if (error instanceof UpdateRetryable) return error.reason;
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    /^[A-Z0-9_]{2,16}$/.test(error.code)
  ) {
    return error.code;
  }
  return "UNKNOWN";
}

export function createTelegramWebhookProcessor(
  options: TelegramWebhookProcessorOptions,
): TelegramWebhookProcessor {
  const { links, telegram } = options;
  const staffChatId = resolveStaffChatId(options.env ?? process.env);

  async function sendOrLog(
    chatId: string,
    text: string,
    sendOptions?: { parseMode?: "HTML"; replyToMessageId?: string; logLabel?: string },
  ): Promise<TelegramChatSendResult> {
    return telegram.sendChatMessage(chatId, text, sendOptions);
  }

  /**
   * Sends the update's one customer-facing message unless a previous attempt
   * already did, and records the delivered message id so later attempts skip.
   */
  async function sendCustomerMessageOnce(
    updateId: string,
    chatId: string,
    text: string,
    markers: TelegramUpdateMarkers,
    logLabel: string,
  ): Promise<void> {
    if (markers.customerMessageId) return;
    const sent = await sendOrLog(chatId, text, { logLabel });
    if (!sent.ok) throw new UpdateRetryable(`${logLabel} delivery failed`);
    if (!sent.messageId) return; // Telegram not configured: nothing to remember.
    // Best effort: if this write fails the update stays retryable anyway
    // (completeUpdate fails the same way), so no delivery is silently lost.
    const recorded = await links.recordUpdateOutbound(updateId, {
      customerMessageId: sent.messageId,
    });
    if (!recorded) {
      console.warn(
        `[devKitCat telegram-webhook] ${logLabel} marker could not be recorded; update stays retryable.`,
      );
    }
  }

  /**
   * Sends one staff-chat message and maps it so a Reply to it reaches this
   * customer — unless this exact update already produced that message, in
   * which case the mapping exists and nothing is re-sent.
   */
  async function sendMappedStaffMessage(
    linkId: string,
    text: string,
    logLabel: string,
    source: { updateId: string; kind: string },
  ): Promise<void> {
    if (!staffChatId) return; // Staff routing not configured: nothing to deliver or map.
    const existing = await links.findStaffRelayBySource(source.updateId, source.kind);
    if (!existing.ok) throw new UpdateRetryable("relay lookup failed");
    if (existing.value) return; // Delivered and mapped by an earlier attempt.
    const result = await sendOrLog(staffChatId, text, { parseMode: "HTML", logLabel });
    if (!result.ok) throw new UpdateRetryable(`${logLabel} failed (${result.error})`);
    if (result.skipped || !result.messageId) return;
    const recorded = await links.recordStaffRelay(linkId, staffChatId, result.messageId, source);
    if (!recorded) throw new UpdateRetryable(`${logLabel} mapping failed`);
  }

  async function handleCustomerStart(
    updateId: string,
    update: Extract<ClassifiedUpdate, { kind: "customer-start" }>,
    markers: TelegramUpdateMarkers,
  ): Promise<void> {
    const identity = { chatId: update.chatId, telegramName: update.fromName };

    if (update.token === null) {
      // A bare /start: point an unconnected chat at their order page; tell a
      // connected chat it is already done.
      const connected = await links.findConnectedOrdersByChat(update.chatId);
      if (!connected.ok) throw new UpdateRetryable("connection lookup failed");
      const text =
        connected.value.length === 0
          ? CUSTOMER_NOT_CONNECTED_MESSAGE
          : formatCustomerAlreadyConnectedMessage(connected.value[0].orderId);
      await sendCustomerMessageOnce(updateId, update.chatId, text, markers, "customer ack");
      return;
    }

    const claim = await links.claimByToken(update.token, identity);

    if (claim.kind === "rejected" || !claim.order) {
      // Unknown, expired, or stolen token: one identical refusal, so the reply
      // reveals nothing about orders.
      await sendCustomerMessageOnce(
        updateId,
        update.chatId,
        CUSTOMER_LINK_REJECTED_MESSAGE,
        markers,
        "customer link rejection",
      );
      return;
    }

    // Freshly claimed or a retry of a claimed update (the token now resolves to
    // "already connected" for this chat): make sure the customer has been
    // acknowledged, then make sure staff have the connection notice. Both are
    // gated, so a retry only fills whatever the crashed attempt left out.
    if (!markers.customerMessageId) {
      const text =
        claim.kind === "claimed"
          ? formatCustomerAckMessage(claim.order.orderId)
          : formatCustomerAlreadyConnectedMessage(claim.order.orderId);
      const sent = await sendOrLog(update.chatId, text, { logLabel: "customer ack" });
      if (!sent.ok) throw new UpdateRetryable("customer ack delivery failed");
      if (sent.messageId) {
        const recorded = await links.recordUpdateOutbound(updateId, {
          customerMessageId: sent.messageId,
        });
        if (!recorded) {
          console.warn(
            "[devKitCat telegram-webhook] customer ack marker could not be recorded; update stays retryable.",
          );
        }
      }
    }

    await sendMappedStaffMessage(
      claim.linkId ?? "",
      formatTelegramConnectionNotice({ ...claim.order, telegramName: claim.telegramName }),
      "connection notice",
      { updateId, kind: "connect-notice" },
    );
  }

  async function handleCustomerText(
    updateId: string,
    update: Extract<ClassifiedUpdate, { kind: "customer-text" }>,
    markers: TelegramUpdateMarkers,
  ): Promise<void> {
    const connected = await links.findConnectedOrdersByChat(update.chatId);
    if (!connected.ok) throw new UpdateRetryable("connection lookup failed");
    if (connected.value.length === 0) {
      await sendCustomerMessageOnce(
        updateId,
        update.chatId,
        CUSTOMER_NOT_CONNECTED_MESSAGE,
        markers,
        "customer hint",
      );
      return;
    }

    const primary = connected.value[0];
    await sendMappedStaffMessage(
      primary.linkId,
      formatCustomerRelayToStaff(
        {
          orderId: primary.orderId,
          customerName: primary.customerName,
          customerPhone: primary.customerPhone,
          otherOrderRefs: connected.value.slice(1).map((entry) => entry.orderId),
        },
        update.text,
      ),
      "customer relay",
      { updateId, kind: "relay" },
    );
  }

  async function handleCustomerMedia(
    updateId: string,
    update: Extract<ClassifiedUpdate, { kind: "customer-media" }>,
    markers: TelegramUpdateMarkers,
  ): Promise<void> {
    if (!staffChatId) return;

    const connected = await links.findConnectedOrdersByChat(update.chatId);
    if (!connected.ok) throw new UpdateRetryable("connection lookup failed");
    if (connected.value.length === 0) {
      await sendCustomerMessageOnce(
        updateId,
        update.chatId,
        CUSTOMER_NOT_CONNECTED_MESSAGE,
        markers,
        "customer hint",
      );
      return;
    }

    const primary = connected.value[0];

    // Forward the attachment untouched (once), map the forward so a Reply to it
    // routes back to this customer, then pin the mapped context line under it.
    const existingForward = await links.findStaffRelayBySource(updateId, "forward");
    if (!existingForward.ok) throw new UpdateRetryable("relay lookup failed");
    if (!existingForward.value) {
      const forwarded = await telegram.forwardMessage(staffChatId, update.chatId, update.messageId);
      if (!forwarded.ok) {
        throw new UpdateRetryable(`attachment forward failed (${forwarded.error})`);
      }
      if (forwarded.messageId) {
        const recorded = await links.recordStaffRelay(
          primary.linkId,
          staffChatId,
          forwarded.messageId,
          { updateId, kind: "forward" },
        );
        if (!recorded) throw new UpdateRetryable("attachment mapping failed");
      }
    }

    await sendMappedStaffMessage(
      primary.linkId,
      formatCustomerMediaNoticeToStaff({
        orderId: primary.orderId,
        customerName: primary.customerName,
        customerPhone: primary.customerPhone,
        otherOrderRefs: connected.value.slice(1).map((entry) => entry.orderId),
      }),
      "attachment notice",
      { updateId, kind: "media-notice" },
    );
  }

  async function handleStaffReply(
    updateId: string,
    update: Extract<ClassifiedUpdate, { kind: "staff-reply" }>,
    markers: TelegramUpdateMarkers,
  ): Promise<void> {
    if (!staffChatId || update.chatId !== staffChatId) return;

    const relay = await links.resolveStaffRelay(update.chatId, update.replyToMessageId);
    if (!relay.ok) throw new UpdateRetryable("relay lookup failed");
    if (!relay.value) {
      // Not a reply to anything we relayed: ignore without echo — the admin may
      // simply be talking to a colleague.
      console.info(
        "[devKitCat telegram-webhook] staff reply without a known relay target was ignored.",
      );
      return;
    }

    const text = update.text.trim().slice(0, 4096);
    if (!text) return;
    if (markers.staffReplyMessageId) return; // Delivered by an earlier attempt.

    // The destination comes from the stored connection, never from the message.
    const delivered = await sendOrLog(relay.value.chatId, text, { logLabel: "staff reply" });
    if (!delivered.ok) {
      if (PERMANENT_SEND_ERRORS.has(delivered.error)) {
        // Undeliverable for good (customer blocked the bot, chat gone): retrying
        // can never succeed, so stop, keep the update done, and tell the admin.
        const failure = await sendOrLog(update.chatId, formatStaffReplyFailure(relay.value.orderId), {
          replyToMessageId: update.replyToMessageId,
          logLabel: "staff reply failure",
        });
        if (!failure.ok) {
          console.warn(
            `[devKitCat telegram-webhook] staff reply failure notice failed (${failure.error}).`,
          );
        }
        return;
      }
      throw new UpdateRetryable(`staff reply delivery failed (${delivered.error})`);
    }
    if (delivered.messageId) {
      const recorded = await links.recordUpdateOutbound(updateId, {
        staffReplyMessageId: delivered.messageId,
      });
      if (!recorded) {
        console.warn(
          "[devKitCat telegram-webhook] staff reply marker could not be recorded; update stays retryable.",
        );
      }
    }

    // Best effort: the reply itself was delivered, so a failed confirmation
    // must never make the whole update — and the customer's reply — retry.
    const confirmation = formatStaffReplyConfirmation(relay.value.orderId);
    const confirmationResult = await sendOrLog(update.chatId, confirmation, {
      replyToMessageId: update.replyToMessageId,
      logLabel: "staff reply confirmation",
    });
    if (!confirmationResult.ok) {
      console.warn(
        `[devKitCat telegram-webhook] staff reply confirmation failed (${confirmationResult.error}).`,
      );
    }
  }

  /**
   * Marks a handled update done. If the ledger write itself fails, the lease is
   * released too so Telegram's retry is claimed immediately instead of waiting
   * out the lease — markers and source rows already protect against re-sends.
   */
  async function finish(updateId: string): Promise<TelegramUpdateOutcome> {
    if (await links.completeUpdate(updateId)) return "processed";
    await links.releaseUpdate(updateId).catch(() => undefined);
    console.warn(
      "[devKitCat telegram-webhook] update finished but could not be marked done; left retryable.",
    );
    return "failed";
  }

  async function handleUpdate(update: unknown): Promise<TelegramUpdateOutcome> {
    const { updateId, message } = parseTelegramUpdate(update);
    if (!updateId) return "skipped"; // Nothing to dedupe and nothing to retry.

    const claim = await links.claimUpdate(updateId);
    if (claim.kind === "error") return "failed"; // Ledger unavailable: let Telegram retry.
    if (claim.kind === "done") return "skipped"; // Permanently processed duplicate.
    if (claim.kind === "in-flight") return "skipped"; // A live delivery owns it.

    if (!message) {
      // Not a message update (edit, callback query, …): nothing to do, ever.
      return finish(updateId);
    }

    const classified = classifyMessage(message, staffChatId);
    if (classified.kind === "ignore") {
      console.info(`[devKitCat telegram-webhook] update ignored (${classified.reason}).`);
      return finish(updateId);
    }

    try {
      switch (classified.kind) {
        case "customer-start":
          await handleCustomerStart(updateId, classified, claim.markers);
          break;
        case "customer-text":
          await handleCustomerText(updateId, classified, claim.markers);
          break;
        case "customer-media":
          await handleCustomerMedia(updateId, classified, claim.markers);
          break;
        case "staff-reply":
          await handleStaffReply(updateId, classified, claim.markers);
          break;
      }
    } catch (error) {
      // Transient failure: expire the lease so the retry is claimed
      // immediately, and report failure so Telegram actually retries.
      await links.releaseUpdate(updateId).catch(() => undefined);
      console.warn(
        `[devKitCat telegram-webhook] update processing failed (${safeReason(error)}); left retryable.`,
      );
      return "failed";
    }

    return finish(updateId);
  }

  return { handleUpdate };
}
