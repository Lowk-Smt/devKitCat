import { isAuthorizedWebhookRequest } from "@/lib/server/telegram-link-core";
import { telegramLinks } from "@/lib/server/telegram-link";
import {
  forwardTelegramMessage,
  sendTelegramChatMessage,
} from "@/lib/server/telegram";
import {
  createTelegramWebhookProcessor,
  type TelegramUpdateOutcome,
} from "@/lib/server/telegram-webhook-core";

/**
 * Telegram webhook for the customer order connection.
 *
 * Setup is `scripts/set-telegram-webhook.mjs`, which registers this URL with
 * `setWebhook` and a shared secret. Telegram then echoes that secret in the
 * `X-Telegram-Bot-Api-Secret-Token` header of every delivery; any request
 * without the exact secret is rejected with 401 before the body is read or a
 * single database query runs, so only Telegram can drive this endpoint.
 *
 * Retry semantics (no message is ever lost to a transient failure):
 *
 * * Processing state lives in `TelegramWebhookEvent` — a claimed lease keeps
 *   concurrent duplicates out, `done` is permanent deduplication, and a failed
 *   attempt releases its lease.
 * * The route answers 200 when an update was processed, deliberately ignored,
 *   or is a duplicate; it answers 500 (empty body, no detail) when processing
 *   failed, so Telegram redelivers and the update is retried. Redeliveries
 *   re-send nothing that already arrived: outbound staff messages are keyed by
 *   the update id, and customer-facing sends leave retry-skip markers.
 *
 * Failures are logged with safe error codes only — never raw bodies, tokens,
 * secrets, or raw Telegram API errors.
 */

const processor = createTelegramWebhookProcessor({
  links: telegramLinks,
  telegram: {
    sendChatMessage: (chatId, text, options) =>
      sendTelegramChatMessage(
        chatId,
        text,
        {
          parseMode: options?.parseMode,
          replyToMessageId: options?.replyToMessageId,
          disableWebPagePreview: true,
          logLabel: options?.logLabel,
        },
        process.env,
      ),
    forwardMessage: (toChatId, fromChatId, messageId) =>
      forwardTelegramMessage(toChatId, fromChatId, messageId, process.env),
  },
  env: process.env,
});

export async function POST(request: Request): Promise<Response> {
  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim() ?? "";
  const providedSecret =
    request.headers.get("x-telegram-bot-api-secret-token") ?? "";

  if (!isAuthorizedWebhookRequest(providedSecret, expectedSecret)) {
    return new Response(null, { status: 401 });
  }

  let update: unknown;
  try {
    update = await request.json();
  } catch {
    // Unparseable body from an authorized sender: retrying cannot help.
    return new Response(null, { status: 200 });
  }

  let outcome: TelegramUpdateOutcome = "failed";
  try {
    outcome = await processor.handleUpdate(update);
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
        ? error.code
        : "UNKNOWN";
    console.error(`[devKitCat telegram-webhook] update processing failed (${code}).`);
  }

  // 200: processed, ignored, or duplicate. 500: left retryable for Telegram.
  return new Response(null, { status: outcome === "failed" ? 500 : 200 });
}
