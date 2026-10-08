import { isAuthorizedWebhookRequest } from "@/lib/server/telegram-link-core";
import { telegramLinks } from "@/lib/server/telegram-link";
import {
  forwardTelegramMessage,
  sendTelegramChatMessage,
} from "@/lib/server/telegram";
import { createTelegramWebhookProcessor } from "@/lib/server/telegram-webhook-core";

/**
 * Telegram webhook for the customer order connection.
 *
 * Setup is `scripts/set-telegram-webhook.mjs`, which registers this URL with
 * `setWebhook` and a shared secret. Telegram then echoes that secret in the
 * `X-Telegram-Bot-Api-Secret-Token` header of every delivery; any request
 * without the exact secret is rejected with 401 before the body is read or a
 * single database query runs, so only Telegram can drive this endpoint.
 *
 * The handler always answers 200 once authorized (or 401), never 5xx: a non-2xx
 * answer would make Telegram retry the delivery, and duplicate processing is
 * prevented by the update-id marker instead. Failures inside processing are
 * logged with safe error codes only — never raw bodies, tokens, or secrets.
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
    // Unparseable body from an authorized sender: acknowledge and drop it.
    return new Response(null, { status: 200 });
  }

  try {
    await processor.handleUpdate(update);
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
        ? error.code
        : "UNKNOWN";
    console.error(`[devKitCat telegram-webhook] update processing failed (${code}).`);
  }

  return new Response(null, { status: 200 });
}
