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

      {isUnpaid ? (
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
