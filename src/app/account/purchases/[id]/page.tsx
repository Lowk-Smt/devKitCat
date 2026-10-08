import { notFound } from "next/navigation";
import { AccountPageHeader } from "@/components/account/AccountPageHeader";
import { AccountSection } from "@/components/account/AccountSection";
import { OrderLineItem } from "@/components/account/OrderLineItem";
import { OrderSummary } from "@/components/account/OrderSummary";
import { PaymentNotice } from "@/components/checkout/PaymentNotice";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { firstSearchParam, isUnpaidOrderStatus } from "@/lib/account-presentation";
import { formatDate } from "@/lib/catalog";
import { requireCustomer } from "@/lib/server/auth";
import { getCustomerOrderById } from "@/lib/server/data-access";
import { startTelegramConnectionAction } from "@/lib/server/telegram-link-actions";
import {
  isTelegramBotConfigured,
  resolveLinkTtlDays,
  resolveTelegramNotice,
} from "@/lib/server/telegram-link-core";
import { telegramLinks } from "@/lib/server/telegram-link";
import styles from "@/components/account/AccountPage.module.css";

export default async function OrderDetailPage({
  params,
  searchParams,
}: PageProps<"/account/purchases/[id]">) {
  const customer = await requireCustomer();
  const [{ id }, query] = await Promise.all([params, searchParams]);
  // Ownership is part of the lookup, so another customer's order ID 404s here
  // exactly like an order that does not exist.
  const order = await getCustomerOrderById(customer.id, id);

  if (!order) notFound();

  // `?placed=1` marks the redirect that follows a successful checkout. It only
  // ever adds copy for an order that is still unpaid, so a hand-edited URL
  // cannot turn a settled order into a "just placed" one.
  const justPlaced =
    firstSearchParam(query.placed) === "1" && isUnpaidOrderStatus(order.status);
  const isUnpaid = isUnpaidOrderStatus(order.status);

  // Allowlisted result notice from the Telegram Server Function.
  const telegramNotice = resolveTelegramNotice(query.telegram);

  // When the bot is configured, the order page owns the connection: it shows
  // the live one-click deep link, or the connected state once the customer has
  // pressed Start. When it is not, the static support-chat fallback below keeps
  // the previous behavior.
  const botConfigured = isUnpaid && isTelegramBotConfigured();
  const connection = botConfigured
    ? await telegramLinks.getConnection(customer.id, order.id)
    : null;
  const connected =
    connection?.ok && connection.value?.state === "connected" ? connection.value : null;

  const rawContactUrl = process.env.NEXT_PUBLIC_TELEGRAM_CONTACT_URL?.trim();
  const telegramContactUrl = rawContactUrl
    ? rawContactUrl.includes("?")
      ? `${rawContactUrl}&text=${encodeURIComponent(`Hello, I placed order ${order.id}`)}`
      : `${rawContactUrl}?text=${encodeURIComponent(`Hello, I placed order ${order.id}`)}`
    : null;

  return (
    <div className={styles.page}>
      <AccountPageHeader
        eyebrow="Order details"
        title={order.id}
        description={`Placed ${formatDate(order.date)}. Product and price details are recorded from this order.`}
        backLink={{ href: "/account/purchases", label: "Back to purchases" }}
      />

      {justPlaced ? (
        <div className={styles.placedNotice}>
          <PaymentNotice variant="order-placed" />
        </div>
      ) : null}

      {isUnpaid && telegramNotice ? (
        <p className={styles.telegramNotice} role="status">
          {telegramNotice === "connected"
            ? "This order is already connected to a Telegram account."
            : telegramNotice === "unavailable"
              ? "Telegram is temporarily unavailable. Please try again in a moment."
              : "We could not start the Telegram connection. Please try again."}
        </p>
      ) : null}

      {isUnpaid && botConfigured ? (
        <section
          className={styles.telegramActionCard}
          aria-labelledby="next-steps-heading"
        >
          <div className={styles.telegramActionHeader}>
            <span className={styles.telegramActionIcon} aria-hidden="true">
              <Icon name={connected ? "check" : "info"} size={20} />
            </span>
            <div>
              <h2 id="next-steps-heading" className={styles.telegramActionTitle}>
                {connected ? "Telegram connected ✓" : "Order received"}
              </h2>
              <p className={styles.telegramActionSubtitle}>
                {connected ? (
                  <>
                    This order is connected to your Telegram
                    {connected.telegramName ? (
                      <> as <strong>{connected.telegramName}</strong></>
                    ) : null}
                    . Our team will message you there about payment and delivery — you
                    can reply at any time.
                  </>
                ) : (
                  <>
                    Your order is saved. Tap <strong>Start Telegram</strong> to open our
                    bot and connect this order — we will confirm payment and delivery
                    with you there. Your name and phone number are already on file, so
                    you will not be asked for them again.
                  </>
                )}
              </p>
            </div>
          </div>

          <div className={styles.telegramActionButtons}>
            <form action={startTelegramConnectionAction}>
              <input type="hidden" name="orderId" value={order.id} />
              {connected ? <input type="hidden" name="rebind" value="1" /> : null}
              <Button type="submit" variant={connected ? "secondary" : "primary"}>
                {connected ? "Use a different Telegram account" : "Start Telegram"}
                {!connected ? <Icon name="arrow-up-right" size={16} /> : null}
              </Button>
            </form>
            {!connected ? (
              <p className={styles.telegramManualNote}>
                Opens a one-time connection link that expires in{" "}
                {resolveLinkTtlDays()}{" "}
                {resolveLinkTtlDays() === 1 ? "day" : "days"}.
              </p>
            ) : null}
          </div>
        </section>
      ) : null}

      {isUnpaid && !botConfigured ? (
        <section
          className={styles.telegramActionCard}
          aria-labelledby="next-steps-heading"
        >
          <div className={styles.telegramActionHeader}>
            <span className={styles.telegramActionIcon} aria-hidden="true">
              <Icon name="info" size={20} />
            </span>
            <div>
              <h2 id="next-steps-heading" className={styles.telegramActionTitle}>
                Next steps: Manual Telegram fulfillment
              </h2>
              <p className={styles.telegramActionSubtitle}>
                Your order is saved in PostgreSQL. Complete payment and receive your
                purchased assets through Telegram.
              </p>
            </div>
          </div>

          <ol className={styles.nextStepsList}>
            <li>
              <strong>Open Telegram:</strong> Connect with our verified support team.
            </li>
            <li>
              <strong>Send your Order ID:</strong> Share reference{" "}
              <code>{order.id}</code> in the chat.
            </li>
            <li>
              <strong>Complete payment:</strong> We will confirm the amount and provide
              payment instructions.
            </li>
            <li>
              <strong>Receive your files:</strong> Your assets are delivered directly
              in Telegram.
            </li>
          </ol>

          {order.customerPhone ? (
            <p className={styles.contactRecord}>
              <strong>Contact on record:</strong> {order.customerPhone}
              {order.telegramHandle ? ` (${order.telegramHandle})` : ""}
            </p>
          ) : null}

          <div className={styles.telegramActionButtons}>
            {telegramContactUrl ? (
              <Button
                href={telegramContactUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Continue on Telegram <Icon name="arrow-up-right" size={16} />
              </Button>
            ) : (
              <p className={styles.telegramManualNote}>
                Message our staff on Telegram with Order ID <code>{order.id}</code>{" "}
                to complete payment and fulfillment.
              </p>
            )}
          </div>
        </section>
      ) : null}

      <div className={styles.detailGrid}>
        <AccountSection
          title="Items in this order"
          description="Product versions and quantities recorded in this order."
        >
          {order.items.map((item) => (
            <OrderLineItem key={item.productId} item={item} />
          ))}
        </AccountSection>
        <OrderSummary order={order} />
      </div>
    </div>
  );
}
