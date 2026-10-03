import { notFound } from "next/navigation";
import { AccountPageHeader } from "@/components/account/AccountPageHeader";
import { AccountSection } from "@/components/account/AccountSection";
import { OrderLineItem } from "@/components/account/OrderLineItem";
import { OrderSummary } from "@/components/account/OrderSummary";
import { PaymentNotice } from "@/components/checkout/PaymentNotice";
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
