import { notFound } from "next/navigation";
import { AccountPageHeader } from "@/components/account/AccountPageHeader";
import { AccountSection } from "@/components/account/AccountSection";
import { OrderLineItem } from "@/components/account/OrderLineItem";
import { OrderSummary } from "@/components/account/OrderSummary";
import { getMockOrderById } from "@/data/mock-account";
import { formatDate } from "@/lib/catalog";
import styles from "@/components/account/AccountPage.module.css";

export default async function OrderDetailPage({
  params,
}: PageProps<"/account/purchases/[id]">) {
  const { id } = await params;
  const order = getMockOrderById(id);

  if (!order) notFound();

  return (
    <div className={styles.page}>
      <AccountPageHeader
        eyebrow="Order details"
        title={order.id}
        description={`Placed ${formatDate(order.date)}. Product and price details are shown from the local demo order.`}
        backLink={{ href: "/account/purchases", label: "Back to purchases" }}
      />

      <div className={styles.detailGrid}>
        <AccountSection
          title="Items in this order"
          description="Product versions and quantities recorded in this demo order."
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
