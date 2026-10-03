import Link from "next/link";
import { AccountCollectionState } from "@/components/account/AccountCollectionState";
import { AccountPageHeader } from "@/components/account/AccountPageHeader";
import { AccountSection } from "@/components/account/AccountSection";
import { PurchaseCard } from "@/components/account/PurchaseCard";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Icon } from "@/components/ui/Icon";
import { getMockOrders } from "@/data/mock-account";
import {
  firstSearchParam,
  parseAccountCollectionPreviewState,
} from "@/lib/account-presentation";
import styles from "@/components/account/AccountPage.module.css";

export const metadata = {
  title: "Purchases",
};

export default async function PurchasesPage({
  searchParams,
}: PageProps<"/account/purchases">) {
  const params = await searchParams;
  const previewState = parseAccountCollectionPreviewState(params.preview);
  const query = (firstSearchParam(params.q) ?? "").trim().slice(0, 120);
  const normalizedQuery = query.toLocaleLowerCase("en-US");
  const orders = getMockOrders();
  const matchingOrders = normalizedQuery
    ? orders.filter((order) =>
        [
          order.id,
          ...order.items.flatMap((item) => [
            item.product.title,
            item.categoryName,
            item.product.slug,
          ]),
        ]
          .join(" ")
          .toLocaleLowerCase("en-US")
          .includes(normalizedQuery),
      )
    : orders;

  return (
    <div className={styles.page}>
      <AccountPageHeader
        eyebrow="Your account"
        title="Purchases"
        description="Review the products and order details in your demo purchase history."
      />

      <AccountSection
        title="Purchase history"
        description="Order records are local mock data and are not connected to payment processing."
      >
        <form action="/account/purchases" method="get" className={styles.searchForm}>
          <label className="sr-only" htmlFor="purchase-search">
            Search orders by ID, product, or category
          </label>
          <div className={styles.searchWrap}>
            <Icon className={styles.searchIcon} name="search" size={17} />
            <input
              className={styles.searchInput}
              id="purchase-search"
              name="q"
              type="search"
              maxLength={120}
              defaultValue={query}
              placeholder="Search order ID or product"
            />
          </div>
          {previewState !== "populated" ? (
            <input type="hidden" name="preview" value={previewState} />
          ) : null}
          <Button
            type="submit"
            size="sm"
            variant="secondary"
            className={styles.searchButton}
          >
            Search orders
          </Button>
          {query ? (
            <Link className={styles.clearSearch} href="/account/purchases">
              Clear search
            </Link>
          ) : null}
        </form>

        {previewState === "loading" || previewState === "error" ? (
          <AccountCollectionState
            state={previewState}
            collection="purchases"
            populatedHref="/account/purchases"
          />
        ) : previewState === "empty" ? (
          <EmptyState
            icon="receipt"
            title="No purchases yet"
            description="When you purchase a devKitCat resource, its order details will appear here. This is an empty-state preview."
            action={
              <Button href="/products" variant="secondary">
                Browse products
              </Button>
            }
          />
        ) : matchingOrders.length > 0 ? (
          <div className={styles.purchaseStack}>
            {matchingOrders.map((order) => (
              <PurchaseCard key={order.id} order={order} />
            ))}
          </div>
        ) : (
          <EmptyState
            icon="search"
            title="No matching orders"
            description={`No demo orders match “${query}”. Try another order ID, product name, or category.`}
            action={
              <Link className={styles.inlineLink} href="/account/purchases">
                Clear search <Icon name="arrow-right" size={15} />
              </Link>
            }
          />
        )}
      </AccountSection>
    </div>
  );
}
