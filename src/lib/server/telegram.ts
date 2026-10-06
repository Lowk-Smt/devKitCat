import "server-only";

/**
 * Server-only Telegram notification service for new devKitCat orders.
 *
 * Uses native fetch with AbortSignal timeout to notify staff via Telegram Bot API.
 * Never throws on network/API failure so order creation in the database is never
 * rolled back or interrupted.
 *
 * Credentials (TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID) are strictly server-side
 * and must never be logged or exposed to client-side code.
 */

export interface TelegramOrderNotificationItem {
  readonly quantity: number;
  readonly productTitle: string;
  readonly unitPrice: string;
}

export interface TelegramOrderNotification {
  readonly orderId: string;
  readonly customerName: string;
  readonly customerEmail: string;
  readonly customerPhone: string;
  readonly telegramHandle?: string | null;
  readonly items: readonly TelegramOrderNotificationItem[];
  readonly total: string;
  readonly currency: string;
  readonly status: string;
}

export interface TelegramNotificationResult {
  readonly ok: boolean;
  readonly skipped?: boolean;
  readonly error?: string;
}

/** Escapes special HTML characters to prevent message injection in Telegram HTML parse_mode. */
export function escapeTelegramHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Formats a structured, readable order summary for the operator Telegram chat. */
export function formatTelegramOrderMessage(
  notification: TelegramOrderNotification,
): string {
  const lines: string[] = [
    `<b>NEW DEVKITCAT ORDER</b>`,
    ``,
    `<b>Order:</b> <code>${escapeTelegramHtml(notification.orderId)}</code>`,
    `<b>Customer:</b> ${escapeTelegramHtml(notification.customerName)} (${escapeTelegramHtml(notification.customerEmail)})`,
    `<b>Phone:</b> <code>${escapeTelegramHtml(notification.customerPhone)}</code>`,
  ];

  if (notification.telegramHandle) {
    lines.push(`<b>Telegram:</b> ${escapeTelegramHtml(notification.telegramHandle)}`);
  }

  lines.push(``, `<b>Items:</b>`);
  for (const item of notification.items) {
    lines.push(
      `• ${item.quantity}x ${escapeTelegramHtml(item.productTitle)} — $${item.unitPrice}`,
    );
  }

  lines.push(
    ``,
    `<b>Total:</b> $${notification.total} ${escapeTelegramHtml(notification.currency)}`,
    `<b>Status:</b> ${escapeTelegramHtml(notification.status)}`,
  );

  return lines.join("\n");
}

/**
 * Dispatches a Telegram message to the configured staff chat.
 * Fails safely and non-destructively: catches network and HTTP errors,
 * never throws, and never exposes or logs the bot token.
 */
export async function sendTelegramOrderNotification(
  notification: TelegramOrderNotification,
  env: NodeJS.ProcessEnv = process.env,
): Promise<TelegramNotificationResult> {
  const token = env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = env.TELEGRAM_CHAT_ID?.trim();

  if (!token || !chatId) {
    console.warn(
      `[devKitCat telegram] TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is not configured. Order notification skipped for ${notification.orderId}.`,
    );
    return { ok: true, skipped: true };
  }

  const message = formatTelegramOrderMessage(notification);

  try {
    const response = await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: message,
          parse_mode: "HTML",
        }),
        signal: AbortSignal.timeout(5000),
      },
    );

    if (!response.ok) {
      console.warn(
        `[devKitCat telegram] Failed to send Telegram notification for order ${notification.orderId} (HTTP ${response.status}).`,
      );
      return { ok: false, error: `HTTP_${response.status}` };
    }

    return { ok: true };
  } catch {
    console.warn(
      `[devKitCat telegram] Network error sending notification for order ${notification.orderId}.`,
    );
    return { ok: false, error: "NETWORK_ERROR" };
  }
}
