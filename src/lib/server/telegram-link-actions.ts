"use server";

import { redirect } from "next/navigation";
import type { TelegramNoticeCode } from "./telegram-link-core";
import { buildTelegramDeepLink, isTelegramBotConfigured } from "./telegram-link-core";
import { getTelegramBotUsername } from "./telegram";
import { telegramLinks } from "./telegram-link";
import { requireCustomer } from "./auth";

/**
 * Server Functions behind the order page's Telegram buttons.
 *
 * The button is a form post, not a rendered link, on purpose: the raw token is
 * created at click time, exists only inside the redirect target, and is never
 * stored in cleartext or embedded in page HTML. Each click rotates the link, so
 * the newest click is the only working one.
 *
 * Like every Server Function, identity comes from the session cookie and the
 * service re-checks order ownership; the form only names the order.
 */

function backToOrder(orderId: string, notice: TelegramNoticeCode): never {
  redirect(
    `/account/purchases/${encodeURIComponent(orderId)}?telegram=${notice}`,
  );
}

/**
 * "Start Telegram": issues a fresh one-time token and hands the customer to the
 * bot. `rebind` is the recovery path — it also clears an existing connection so
 * another Telegram account can take over deliberately.
 */
export async function startTelegramConnectionAction(formData: FormData): Promise<void> {
  const customer = await requireCustomer();

  const orderId = formData.get("orderId");
  const rebind = formData.get("rebind") === "1";
  if (typeof orderId !== "string" || orderId.length === 0 || orderId.length > 64) {
    redirect("/account/purchases");
  }

  if (!isTelegramBotConfigured()) {
    backToOrder(orderId, "unavailable");
  }

  // The bot username is a public value; resolving it before rotating the link
  // means a Telegram outage cannot burn a token.
  const botUsername = await getTelegramBotUsername();
  if (!botUsername) {
    backToOrder(orderId, "unavailable");
  }

  const result = await telegramLinks.issueLink(customer.id, orderId, { rebind });
  if (!result.ok) {
    backToOrder(orderId, result.code === "NOT_FOUND" ? "error" : "unavailable");
  }

  if ("alreadyConnected" in result.value) {
    backToOrder(orderId, "connected");
  }

  const deepLink = buildTelegramDeepLink(botUsername, result.value.token);
  if (!deepLink) {
    backToOrder(orderId, "error");
  }

  redirect(deepLink);
}
