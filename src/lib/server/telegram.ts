import "server-only";

/**
 * Server-only Telegram service for devKitCat.
 *
 * Two responsibilities, one HTTP discipline:
 *
 * 1. Staff order notifications (`sendTelegramOrderNotification`) — posted to the
 *    configured staff chat when checkout commits a new order.
 * 2. Order conversations (`sendTelegramChatMessage`,
 *    `forwardTelegramMessage`, `getTelegramBotUsername`) — the bot side of the
 *    customer deep-link connection: delivering the customer acknowledgment and
 *    staff notices, relaying customer messages into the staff chat, and
 *    delivering staff replies to the connected customer chat.
 *
 * Every call uses native `fetch` with an AbortSignal timeout, awaits and
 * validates Telegram's JSON acknowledgment, and reports a typed result instead
 * of throwing, so a Telegram failure can never break a committed order or a
 * webhook run. Credentials (TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID,
 * TELEGRAM_WEBHOOK_SECRET) are strictly server-side and never logged; API
 * descriptions are treated as untrusted text and redacted before logging.
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

/**
 * Result of a bot-to-chat send. `messageId` is Telegram's id for the delivered
 * message; the webhook records it so a staff Reply to that message can be
 * routed back to the customer chat it came from.
 */
export type TelegramChatSendResult =
  | { readonly ok: true; readonly skipped?: true; readonly messageId?: string }
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

/** Everything one Bot API call can report, already separated for logging. */
type TelegramApiOutcome =
  /** A response arrived with a non-2xx status. */
  | { readonly kind: "http-status"; readonly httpStatus: number; readonly apiErrorDescription: string }
  /** A 2xx response whose Telegram JSON `ok` field was present and false. */
  | { readonly kind: "api-error"; readonly httpStatus: number; readonly apiErrorDescription: string }
  /** A 2xx response whose body was not a valid Telegram acknowledgment. */
  | { readonly kind: "invalid"; readonly httpStatus: number }
  /** A 2xx response with Telegram's `ok: true` acknowledgment. */
  | { readonly kind: "ok"; readonly httpStatus: number; readonly result?: unknown }
  /** No usable acknowledgment arrived (network failure, timeout, aborted body). */
  | { readonly kind: "transport"; readonly httpStatus?: number; readonly transportError: TelegramNotificationError };

const TELEGRAM_REQUEST_TIMEOUT_MS = 5000;

/**
 * One Bot API method call. Performs the POST, consumes and validates the JSON
 * acknowledgment within the same deadline, and reports a structured outcome —
 * it never throws and never logs; logging stays with the callers so each
 * public function keeps its own correlated, secret-free wording.
 */
async function callTelegramApiMethod(
  env: NodeJS.ProcessEnv,
  method: string,
  payload: Record<string, unknown>,
  secrets: readonly (string | null | undefined)[],
): Promise<TelegramApiOutcome> {
  const token = env.TELEGRAM_BOT_TOKEN?.trim();
  let signal: AbortSignal | undefined;
  let httpStatus: number | undefined;

  try {
    signal = AbortSignal.timeout(TELEGRAM_REQUEST_TIMEOUT_MS);
    const response = await fetch(
      `https://api.telegram.org/bot${token}/${method}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
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

    const description = safeTelegramDescription(body, secrets);

    if (!response.ok) {
      return { kind: "http-status", httpStatus, apiErrorDescription: description };
    }
    if (
      typeof body !== "object" ||
      body === null ||
      !("ok" in body) ||
      typeof body.ok !== "boolean"
    ) {
      return { kind: "invalid", httpStatus };
    }
    if (!body.ok) {
      return { kind: "api-error", httpStatus, apiErrorDescription: description };
    }

    const result = "result" in body ? body.result : undefined;
    return { kind: "ok", httpStatus, result };
  } catch (error) {
    const timedOut =
      signal?.aborted || (error instanceof Error && error.name === "TimeoutError");
    // httpStatus is set when the response arrived but its body could not be
    // consumed, so callers can correlate the failure with the attempt.
    return {
      kind: "transport",
      httpStatus,
      transportError: timedOut ? "TIMEOUT" : "NETWORK_ERROR",
    };
  }
}

/** Reads Telegram's delivered `message_id` out of a sendMessage result. */
function readSentMessageId(result: unknown): string | undefined {
  if (
    typeof result === "object" &&
    result !== null &&
    "message_id" in result &&
    (typeof result.message_id === "number" || typeof result.message_id === "string")
  ) {
    return String(result.message_id);
  }
  return undefined;
}

/**
 * Dispatches an order notification to the configured staff chat.
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

  function fail(
    error: TelegramNotificationError,
    httpStatus?: number,
    description?: string,
  ): TelegramNotificationResult {
    const status = httpStatus === undefined ? "" : `, HTTP ${httpStatus}`;
    const detail = description ? `: ${description}` : "";
    console.warn(
      `[devKitCat telegram] notification failed for order ${notification.orderId} (${error}${status})${detail}.`,
    );
    return { ok: false, error };
  }

  let message: string;
  try {
    message = formatTelegramOrderMessage(notification);
  } catch {
    return fail("FORMAT_ERROR");
  }

  const outcome = await callTelegramApiMethod(
    env,
    "sendMessage",
    { chat_id: chatId, text: message, parse_mode: "HTML" },
    [
      token, chatId, env.DATABASE_URL, notification.customerName,
      notification.customerEmail, notification.customerPhone, notification.telegramHandle,
    ],
  );

  switch (outcome.kind) {
    case "transport":
      return fail(outcome.transportError, outcome.httpStatus);
    case "http-status":
      return fail(`HTTP_${outcome.httpStatus}`, outcome.httpStatus, outcome.apiErrorDescription);
    case "api-error":
      return fail("TELEGRAM_API_ERROR", outcome.httpStatus, outcome.apiErrorDescription);
    case "invalid":
      return fail("INVALID_RESPONSE", outcome.httpStatus);
    case "ok":
      console.info(
        `[devKitCat telegram] notification acknowledged for order ${notification.orderId} (HTTP ${outcome.httpStatus}, telegramOk: true).`,
      );
      return { ok: true };
  }
}

export interface TelegramOutgoingMessageOptions {
  /** Omit for plain text. HTML content must already be escaped. */
  readonly parseMode?: "HTML";
  /** Deliver the message as a native Telegram Reply to this message id. */
  readonly replyToMessageId?: string;
  /** Defaults to true: order references and links should not render previews. */
  readonly disableWebPagePreview?: boolean;
  /** Correlated label used in logs, e.g. "customer relay" or "staff reply". */
  readonly logLabel?: string;
  /** Values redacted from any logged API description. */
  readonly redact?: readonly (string | null | undefined)[];
}

/**
 * Sends one bot message to one Telegram chat (customer or staff) and reports
 * the delivered message id so callers can map staff Replies back to the
 * originating customer chat. Like every Telegram call here, a failure is a
 * typed result, never a throw.
 */
export async function sendTelegramChatMessage(
  chatId: string,
  text: string,
  options: TelegramOutgoingMessageOptions = {},
  env: NodeJS.ProcessEnv = process.env,
): Promise<TelegramChatSendResult> {
  const token = env.TELEGRAM_BOT_TOKEN?.trim();
  const label = options.logLabel ?? "chat message";

  if (!token || !chatId.trim()) {
    console.warn(`[devKitCat telegram] Telegram is not configured; ${label} skipped.`);
    return { ok: true, skipped: true };
  }

  const payload: Record<string, unknown> = {
    chat_id: chatId,
    text,
    disable_web_page_preview: options.disableWebPagePreview ?? true,
  };
  if (options.parseMode) payload.parse_mode = options.parseMode;
  if (options.replyToMessageId) payload.reply_to_message_id = options.replyToMessageId;

  const outcome = await callTelegramApiMethod(
    env,
    "sendMessage",
    payload,
    [token, chatId, env.DATABASE_URL, ...(options.redact ?? [])],
  );

  switch (outcome.kind) {
    case "transport":
      console.warn(`[devKitCat telegram] ${label} failed (${outcome.transportError}).`);
      return { ok: false, error: outcome.transportError };
    case "http-status":
      console.warn(
        `[devKitCat telegram] ${label} failed (HTTP_${outcome.httpStatus})${outcome.apiErrorDescription ? `: ${outcome.apiErrorDescription}` : ""}.`,
      );
      return { ok: false, error: `HTTP_${outcome.httpStatus}` };
    case "api-error":
      console.warn(
        `[devKitCat telegram] ${label} failed (TELEGRAM_API_ERROR)${outcome.apiErrorDescription ? `: ${outcome.apiErrorDescription}` : ""}.`,
      );
      return { ok: false, error: "TELEGRAM_API_ERROR" };
    case "invalid":
      console.warn(`[devKitCat telegram] ${label} failed (INVALID_RESPONSE).`);
      return { ok: false, error: "INVALID_RESPONSE" };
    case "ok":
      console.info(`[devKitCat telegram] ${label} delivered (HTTP ${outcome.httpStatus}).`);
      return { ok: true, messageId: readSentMessageId(outcome.result) };
  }
}

/**
 * Forwards any customer message (media, stickers, voice — anything the bot can
 * receive) into the staff chat unchanged. Used for attachments the text relay
 * cannot carry; the delivered message id is mapped like a text relay so the
 * owner can Reply to it.
 */
export async function forwardTelegramMessage(
  toChatId: string,
  fromChatId: string,
  messageId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<TelegramChatSendResult> {
  const token = env.TELEGRAM_BOT_TOKEN?.trim();
  const label = "customer attachment forward";

  if (!token || !toChatId.trim()) {
    console.warn(`[devKitCat telegram] Telegram is not configured; ${label} skipped.`);
    return { ok: true, skipped: true };
  }

  const outcome = await callTelegramApiMethod(
    env,
    "forwardMessage",
    {
      chat_id: toChatId,
      from_chat_id: fromChatId,
      message_id: Number(messageId),
    },
    [token, toChatId, fromChatId, env.DATABASE_URL],
  );

  switch (outcome.kind) {
    case "transport":
      console.warn(`[devKitCat telegram] ${label} failed (${outcome.transportError}).`);
      return { ok: false, error: outcome.transportError };
    case "http-status":
      console.warn(
        `[devKitCat telegram] ${label} failed (HTTP_${outcome.httpStatus})${outcome.apiErrorDescription ? `: ${outcome.apiErrorDescription}` : ""}.`,
      );
      return { ok: false, error: `HTTP_${outcome.httpStatus}` };
    case "api-error":
      console.warn(
        `[devKitCat telegram] ${label} failed (TELEGRAM_API_ERROR)${outcome.apiErrorDescription ? `: ${outcome.apiErrorDescription}` : ""}.`,
      );
      return { ok: false, error: "TELEGRAM_API_ERROR" };
    case "invalid":
      console.warn(`[devKitCat telegram] ${label} failed (INVALID_RESPONSE).`);
      return { ok: false, error: "INVALID_RESPONSE" };
    case "ok":
      console.info(`[devKitCat telegram] ${label} delivered (HTTP ${outcome.httpStatus}).`);
      return { ok: true, messageId: readSentMessageId(outcome.result) };
  }
}

/* Bot username (deep-link construction)
   -------------------------------------------------------------------------- */

const TELEGRAM_BOT_USERNAME_PATTERN = /^[A-Za-z0-9_]{5,32}$/;
const BOT_USERNAME_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

let botUsernameCache: { username: string; fetchedAt: number } | null = null;

/** Validates and normalizes a bot username (no leading @, Telegram character set). */
export function normalizeTelegramBotUsername(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const username = value.trim().replace(/^@/, "");
  return TELEGRAM_BOT_USERNAME_PATTERN.test(username) ? username : null;
}

/** Extracts the bot username from a getMe result payload. Exported for tests. */
export function parseTelegramBotUsername(result: unknown): string | null {
  if (
    typeof result === "object" &&
    result !== null &&
    "username" in result &&
    typeof result.username === "string"
  ) {
    return normalizeTelegramBotUsername(result.username);
  }
  return null;
}

/**
 * Resolves the bot's public username for deep-link construction
 * (`https://t.me/<username>?start=<token>`).
 *
 * `TELEGRAM_BOT_USERNAME` (a public value) short-circuits the lookup. Otherwise
 * one getMe call is made and cached per warm server process; failures return
 * null so callers fall back to the static contact link instead of failing.
 */
export async function getTelegramBotUsername(
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | null> {
  const override = normalizeTelegramBotUsername(env.TELEGRAM_BOT_USERNAME);
  if (override) return override;

  const token = env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) return null;

  if (botUsernameCache && Date.now() - botUsernameCache.fetchedAt < BOT_USERNAME_CACHE_TTL_MS) {
    return botUsernameCache.username;
  }

  const outcome = await callTelegramApiMethod(env, "getMe", {}, [
    token,
    env.DATABASE_URL,
  ]);

  const username = outcome.kind === "ok" ? parseTelegramBotUsername(outcome.result) : null;
  if (!username) {
    console.warn("[devKitCat telegram] could not resolve the bot username via getMe.");
    return null;
  }

  botUsernameCache = { username, fetchedAt: Date.now() };
  return username;
}
