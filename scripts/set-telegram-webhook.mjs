#!/usr/bin/env node
/**
 * Registers (or removes) the devKitCat Telegram webhook.
 *
 * The webhook is how the bot hears customers: Telegram POSTs every update to
 * `<url>` and echoes TELEGRAM_WEBHOOK_SECRET in the
 * `X-Telegram-Bot-Api-Secret-Token` header, which the route requires before
 * processing. Run this once per deployment (after `TELEGRAM_BOT_TOKEN`,
 * `TELEGRAM_CHAT_ID`, and `TELEGRAM_WEBHOOK_SECRET` exist) and again whenever
 * the deployment URL changes:
 *
 *   node scripts/set-telegram-webhook.mjs --url https://your-site.vercel.app/api/telegram/webhook
 *   node scripts/set-telegram-webhook.mjs --delete
 *   node scripts/set-telegram-webhook.mjs --info
 *
 * The bot token is read from the environment and never printed; API error
 * text is redacted before logging.
 */

import "dotenv/config";

const TOKEN = process.env.TELEGRAM_BOT_TOKEN?.trim() ?? "";
const SECRET = process.env.TELEGRAM_WEBHOOK_SECRET?.trim() ?? "";

const args = process.argv.slice(2);
function readFlag(name) {
  const index = args.indexOf(name);
  return index === -1 ? null : args[index + 1] ?? null;
}
const hasFlag = (name) => args.includes(name);

if (!TOKEN) {
  console.error("TELEGRAM_BOT_TOKEN must be set in the environment before registering a webhook.");
  process.exit(1);
}

function redact(text) {
  let output = String(text);
  for (const secret of [TOKEN, SECRET].filter(Boolean)) {
    output = output.split(secret).join("[redacted]");
  }
  return output.replace(/\s+/g, " ").trim().slice(0, 300);
}

async function callApi(method, payload) {
  const response = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15000),
  });
  let body;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok || typeof body !== "object" || body === null || body.ok !== true) {
    const description =
      typeof body === "object" && body !== null && typeof body.description === "string"
        ? body.description
        : "No valid Telegram description";
    console.error(`Telegram ${method} failed (HTTP ${response.status}): ${redact(description)}`);
    process.exit(1);
  }
  return body.result;
}

if (hasFlag("--delete")) {
  const result = await callApi("deleteWebhook", { drop_pending_updates: false });
  console.log(`Webhook deleted (pending updates left queued: ${result ? "unknown" : "n/a"}).`);
  process.exit(0);
}

if (hasFlag("--info")) {
  const info = await callApi("getWebhookInfo", {});
  console.log(JSON.stringify(info, null, 2));
  process.exit(0);
}

const url = readFlag("--url");
if (!url || !/^https:\/\/[^\s]+\/api\/telegram\/webhook$/.test(url.trim())) {
  console.error(
    "Pass the public HTTPS URL of this route, e.g.\n" +
      "  node scripts/set-telegram-webhook.mjs --url https://your-site.example/api/telegram/webhook",
  );
  process.exit(1);
}

if (!SECRET) {
  console.error(
    "TELEGRAM_WEBHOOK_SECRET must be set: the route rejects every delivery that does not carry it.",
  );
  process.exit(1);
}

const result = await callApi("setWebhook", {
  url: url.trim(),
  secret_token: SECRET,
  allowed_updates: ["message"],
  drop_pending_updates: false,
});

console.log("Webhook registered.");
console.log(`  url:             ${result.url ?? url.trim()}`);
console.log(`  allowed updates: ${(result.allowed_updates ?? ["message"]).join(", ")}`);
console.log("Customers can now press Start on t.me/<your bot> to connect an order.");
