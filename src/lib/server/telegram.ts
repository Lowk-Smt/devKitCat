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

export type TelegramNotificationError =
  | "FORMAT_ERROR"
  | "TIMEOUT"
  | "NETWORK_ERROR"
  | "INVALID_RESPONSE"
  | "TELEGRAM_API_ERROR"
  | `HTTP_${number}`;

export type TelegramNotificationResult =
  | { readonly ok: true; readonly skipped?: true }
  | { readonly ok: false; readonly error: TelegramNotificationError };

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

/** Treat API descriptions as untrusted text; never log a response or exception wholesale. */
function safeTelegramDescription(
  body: unknown,
  secrets: readonly (string | null | undefined)[],
): string {
  if (
    typeof body !== "object" ||
    body === null ||
    !("description" in body) ||
    typeof body.description !== "string"
  ) {
    return "No valid Telegram description";
  }

  let description = body.description;
  // Redact before truncation so a credential crossing the length limit cannot leak.
  for (const secret of secrets) {
    if (secret) description = description.split(secret).join("[redacted]");
  }
  description = description
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, "[redacted-url]")
    .replace(/\b\d+:[A-Za-z0-9_-]{20,}\b/g, "[redacted-token]")
    .replace(/\b(password|secret|token|api[_-]?key)\s*[=:]\s*("[^"]*"|'[^']*'|[^\s,;]+)/gi, "$1=[redacted]");
  // Strip control characters as well as collapsing newlines into one log line.
  description = Array.from(description, (character) => {
    const code = character.charCodeAt(0);
    return code < 32 || (code >= 127 && code <= 159) ? " " : character;
  }).join("");
  return description.replace(/\s+/g, " ").trim().slice(0, 200) || "No valid Telegram description";
}

/**
 * Dispatches a Telegram message to the configured staff chat.
 * Awaits and validates Telegram's JSON acknowledgment, not just HTTP headers.
 * Formatting, network, timeout and API failures never fail the committed order.
 */
export async function sendTelegramOrderNotification(
  notification: TelegramOrderNotification,
  env: NodeJS.ProcessEnv = process.env,
): Promise<TelegramNotificationResult> {
  const token = env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = env.TELEGRAM_CHAT_ID?.trim();

  console.info(
    `[devKitCat telegram] notification invoked for order ${notification.orderId} (telegramConfigured: ${Boolean(token && chatId)}).`,
  );

  if (!token || !chatId) {
    console.warn(
      `[devKitCat telegram] Telegram is not configured; notification skipped for order ${notification.orderId}.`,
    );
    return { ok: true, skipped: true };
  }

  let httpStatus: number | undefined;
  let signal: AbortSignal | undefined;
  let exceptionCode: TelegramNotificationError = "FORMAT_ERROR";
  function fail(error: TelegramNotificationError, description?: string): TelegramNotificationResult {
    const status = httpStatus === undefined ? "" : `, HTTP ${httpStatus}`;
    const detail = description ? `: ${description}` : "";
    console.warn(
      `[devKitCat telegram] notification failed for order ${notification.orderId} (${error}${status})${detail}.`,
    );
    return { ok: false, error };
  }

  try {
    const message = formatTelegramOrderMessage(notification);
    exceptionCode = "NETWORK_ERROR";
    signal = AbortSignal.timeout(5000);
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
        signal,
      },
    );
    httpStatus = response.status;

    let body: unknown;
    try {
      // The same deadline also covers response-body consumption.
      body = await response.json();
    } catch (error) {
      // Invalid JSON is an invalid acknowledgment; transport/abort errors still
      // need the network/timeout classification from the outer catch.
      if (!(error instanceof SyntaxError)) throw error;
    }

    const description = safeTelegramDescription(body, [
      token, chatId, env.DATABASE_URL, notification.customerName,
      notification.customerEmail, notification.customerPhone, notification.telegramHandle,
    ]);
    if (!response.ok) {
      return fail(`HTTP_${response.status}`, description);
    }
    if (
      typeof body !== "object" ||
      body === null ||
      !("ok" in body) ||
      typeof body.ok !== "boolean"
    ) {
      return fail("INVALID_RESPONSE");
    }
    if (!body.ok) {
      return fail("TELEGRAM_API_ERROR", description);
    }

    console.info(
      `[devKitCat telegram] notification acknowledged for order ${notification.orderId} (HTTP ${httpStatus}, telegramOk: true).`,
    );
    return { ok: true };
  } catch (error) {
    const timedOut = signal?.aborted || (error instanceof Error && error.name === "TimeoutError");
    return fail(timedOut ? "TIMEOUT" : exceptionCode);
  }
}
