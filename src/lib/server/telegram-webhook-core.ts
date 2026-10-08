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
import type { TelegramLinkService } from "./telegram-link-service";

/**
 * The webhook brain: turns one Telegram update into the smallest safe set of
 * database writes and bot messages.
 *
 * Ordering of the three guards, in the order they run:
 *
 * 1. **Update id, first.** Telegram redelivers unacknowledged webhooks, so the
 *    update id is recorded *before* anything is processed and a redelivery is
 *    a no-op. If the marker cannot be written the update is skipped: losing one
 *    message beats relaying it twice.
 * 2. **Chat class.** The configured staff chat is matched first; only private
 *    chats reach customer paths. Any other group or channel is ignored.
 * 3. **Routing state, not message text.** A staff Reply is delivered only when
 *    the replied-to message id maps to a stored relay row, and the destination
 *    is that row's customer chat — never an id from the message itself.
 *
 * Every Telegram call reports a typed result; a delivery failure is logged and
 * swallowed here so a webhook run always ends cleanly (the route acknowledges
 * with 200 either way, and no database state depends on a send succeeding).
 */

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
  /** Processes one raw update; resolves after all best-effort work is done. */
  handleUpdate(update: unknown): Promise<void>;
}

export interface TelegramWebhookProcessorOptions {
  links: TelegramLinkService;
  telegram: TelegramWebhookSender;
  env?: NodeJS.ProcessEnv;
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

  /** Sends a staff notice and maps it so a Reply to it reaches this customer. */
  async function sendMappedStaffMessage(
    linkId: string,
    text: string,
    logLabel: string,
  ): Promise<void> {
    if (!staffChatId) return;
    const result = await sendOrLog(staffChatId, text, { parseMode: "HTML", logLabel });
    if (result.ok && !result.skipped && result.messageId) {
      await links.recordStaffRelay(linkId, staffChatId, result.messageId);
    }
  }

  async function handleCustomerStart(
    update: Extract<ClassifiedUpdate, { kind: "customer-start" }>,
  ): Promise<void> {
    const identity = { chatId: update.chatId, telegramName: update.fromName };

    if (update.token === null) {
      // A bare /start: point an unconnected chat at their order page; tell a
      // connected chat it is already done.
      const connected = await links.findConnectedOrdersByChat(update.chatId);
      if (connected.length === 0) {
        await sendOrLog(update.chatId, CUSTOMER_NOT_CONNECTED_MESSAGE, {
          logLabel: "customer hint",
        });
        return;
      }
      await sendOrLog(
        update.chatId,
        formatCustomerAlreadyConnectedMessage(connected[0].orderId),
        { logLabel: "customer ack" },
      );
      return;
    }

    const claim = await links.claimByToken(update.token, identity);

    if (claim.kind === "rejected") {
      await sendOrLog(update.chatId, CUSTOMER_LINK_REJECTED_MESSAGE, {
        logLabel: "customer link rejection",
      });
      return;
    }

    if (claim.kind === "already-connected-same-chat") {
      await sendOrLog(
        update.chatId,
        claim.order
          ? formatCustomerAlreadyConnectedMessage(claim.order.orderId)
          : CUSTOMER_LINK_REJECTED_MESSAGE,
        { logLabel: "customer ack" },
      );
      return;
    }

    // Freshly claimed: acknowledge the customer first, then brief staff.
    if (!claim.order) {
      await sendOrLog(update.chatId, CUSTOMER_LINK_REJECTED_MESSAGE, {
        logLabel: "customer link rejection",
      });
      return;
    }

    const ack = await sendOrLog(
      update.chatId,
      formatCustomerAckMessage(claim.order.orderId),
      { logLabel: "customer ack" },
    );
    if (!ack.ok) {
      console.warn(
        `[devKitCat telegram-webhook] customer ack failed for order ${claim.order.orderId} (${ack.error}).`,
      );
    }

    await sendMappedStaffMessage(
      claim.linkId ?? "",
      formatTelegramConnectionNotice({ ...claim.order, telegramName: claim.telegramName }),
      "connection notice",
    );
  }

  async function handleCustomerText(
    update: Extract<ClassifiedUpdate, { kind: "customer-text" }>,
  ): Promise<void> {
    const connected = await links.findConnectedOrdersByChat(update.chatId);
    if (connected.length === 0) {
      await sendOrLog(update.chatId, CUSTOMER_NOT_CONNECTED_MESSAGE, {
        logLabel: "customer hint",
      });
      return;
    }

    const primary = connected[0];
    await sendMappedStaffMessage(
      primary.linkId,
      formatCustomerRelayToStaff(
        {
          orderId: primary.orderId,
          customerName: primary.customerName,
          customerPhone: primary.customerPhone,
          otherOrderRefs: connected.slice(1).map((entry) => entry.orderId),
        },
        update.text,
      ),
      "customer relay",
    );
  }

  async function handleCustomerMedia(
    update: Extract<ClassifiedUpdate, { kind: "customer-media" }>,
  ): Promise<void> {
    if (!staffChatId) return;

    const connected = await links.findConnectedOrdersByChat(update.chatId);
    if (connected.length === 0) {
      await sendOrLog(update.chatId, CUSTOMER_NOT_CONNECTED_MESSAGE, {
        logLabel: "customer hint",
      });
      return;
    }

    const primary = connected[0];
    // Forward the attachment untouched, then map the forward so a Reply to it
    // routes back to this customer, then pin the context line under it.
    const forwarded = await telegram.forwardMessage(staffChatId, update.chatId, update.messageId);
    if (!forwarded.ok || forwarded.skipped || !forwarded.messageId) {
      console.warn(
        `[devKitCat telegram-webhook] attachment forward failed for order ${primary.orderId}${"error" in forwarded ? ` (${forwarded.error})` : ""}.`,
      );
      return;
    }
    await links.recordStaffRelay(primary.linkId, staffChatId, forwarded.messageId);

    await sendMappedStaffMessage(
      primary.linkId,
      formatCustomerMediaNoticeToStaff({
        orderId: primary.orderId,
        customerName: primary.customerName,
        customerPhone: primary.customerPhone,
        otherOrderRefs: connected.slice(1).map((entry) => entry.orderId),
      }),
      "attachment notice",
    );
  }

  async function handleStaffReply(
    update: Extract<ClassifiedUpdate, { kind: "staff-reply" }>,
  ): Promise<void> {
    if (!staffChatId || update.chatId !== staffChatId) return;

    const relay = await links.resolveStaffRelay(update.chatId, update.replyToMessageId);
    if (!relay) {
      // Not a reply to anything we relayed: ignore without echo — the admin may
      // simply be talking to a colleague.
      console.info(
        "[devKitCat telegram-webhook] staff reply without a known relay target was ignored.",
      );
      return;
    }

    const text = update.text.trim().slice(0, 4096);
    if (!text) return;

    // The destination comes from the stored connection, never from the message.
    const delivered = await sendOrLog(relay.chatId, text, { logLabel: "staff reply" });
    const confirmation = delivered.ok
      ? formatStaffReplyConfirmation(relay.orderId)
      : formatStaffReplyFailure(relay.orderId);
    await sendOrLog(update.chatId, confirmation, {
      replyToMessageId: update.replyToMessageId,
      logLabel: "staff reply confirmation",
    });
  }

  async function handleUpdate(update: unknown): Promise<void> {
    const { updateId, message } = parseTelegramUpdate(update);
    if (!updateId) return;

    const fresh = await links.markUpdateSeen(updateId);
    if (!fresh) return;

    if (!message) return;
    const classified = classifyMessage(message, staffChatId);

    switch (classified.kind) {
      case "customer-start":
        await handleCustomerStart(classified);
        return;
      case "customer-text":
        await handleCustomerText(classified);
        return;
      case "customer-media":
        await handleCustomerMedia(classified);
        return;
      case "staff-reply":
        await handleStaffReply(classified);
        return;
      case "ignore":
        console.info(`[devKitCat telegram-webhook] update ignored (${classified.reason}).`);
        return;
    }
  }

  return { handleUpdate };
}
