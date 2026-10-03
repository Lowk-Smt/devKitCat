import Link from "next/link";
import { AccountPageHeader } from "@/components/account/AccountPageHeader";
import { AccountSection } from "@/components/account/AccountSection";
import { DownloadCard } from "@/components/account/DownloadCard";
import { PurchaseCard } from "@/components/account/PurchaseCard";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Icon } from "@/components/ui/Icon";
import { toIsoDate } from "@/lib/account-presentation";
import { formatDate } from "@/lib/catalog";
import { requireCustomer } from "@/lib/server/auth";
import { listCustomerDownloads, listCustomerOrders } from "@/lib/server/data-access";
import styles from "@/components/account/AccountPage.module.css";

export const metadata = {
  title: "Account overview",
};

const QUICK_LINKS = [
  {
    href: "/account/purchases",
    title: "View purchases",
    description: "Review your order history",
    icon: "receipt",
  },
  {
    href: "/account/downloads",
    title: "View downloads",
    description: "See products in your library",
    icon: "download",
  },
  {
    href: "/account/settings",
    title: "Account settings",
    description: "Review profile and preferences",
    icon: "settings",
  },
] as const;

export default async function AccountOverviewPage() {
  const customer = await requireCustomer();
  const [orders, downloads] = await Promise.all([
    listCustomerOrders(customer.id),
    listCustomerDownloads(customer.id),
  ]);
  const memberSince = toIsoDate(customer.createdAt);

  return (
    <div className={styles.page}>
      <AccountPageHeader
        eyebrow="Customer account"
        title={`Welcome back, ${customer.name.split(" ")[0]}.`}
        description="Your devKitCat purchases and account details, together in one place."
        action={
          <Button href="/products" variant="secondary">
            Browse products <Icon name="arrow-right" size={16} />
          </Button>
        }
      />

      <div className={styles.overviewGrid}>
        <div className={styles.stack}>
          <AccountSection
            title="Recent purchases"
            description="A quick look at your latest orders."
            action={
              <Link className={styles.inlineLink} href="/account/purchases">
                All purchases <Icon name="arrow-right" size={15} />
              </Link>
            }
          >
            {orders.length > 0 ? (
              <div className={styles.purchaseStack}>
                {orders.slice(0, 2).map((order) => (
                  <PurchaseCard key={order.id} order={order} compact />
                ))}
              </div>
            ) : (
              <EmptyState
                icon="receipt"
                title="No purchases yet"
                description="Products you purchase will appear here."
                headingLevel={3}
                action={
                  <Button href="/products" variant="secondary" size="sm">
                    Browse products
                  </Button>
                }
              />
            )}
          </AccountSection>

          <AccountSection
            title="Your library"
            description="Purchased resources linked to your account. File delivery is not enabled yet."
            action={
              <Link className={styles.inlineLink} href="/account/downloads">
                Open library <Icon name="arrow-right" size={15} />
              </Link>
            }
          >
            {downloads.length > 0 ? (
              <div className={styles.downloadStack}>
                {downloads.slice(0, 2).map((download) => (
                  <DownloadCard
                    key={download.product.id}
                    download={download}
                    compact
                  />
                ))}
              </div>
            ) : (
              <EmptyState
                icon="download"
                title="Your library is empty"
                description="Resources from completed purchases will show here."
                headingLevel={3}
                action={
                  <Button href="/products" variant="secondary" size="sm">
                    Explore products
                  </Button>
                }
              />
            )}
          </AccountSection>
        </div>

        <div className={styles.stack}>
          <AccountSection title="Account information">
            <dl className={styles.accountDetails}>
              <div className={styles.detailRow}>
                <dt className={styles.detailLabel}>Display name</dt>
                <dd className={styles.detailValue}>{customer.name}</dd>
              </div>
              <div className={styles.detailRow}>
                <dt className={styles.detailLabel}>Email address</dt>
                <dd className={styles.detailValue}>{customer.email}</dd>
              </div>
              <div className={styles.detailRow}>
                <dt className={styles.detailLabel}>Member since</dt>
                <dd className={styles.detailValue}>
                  <time dateTime={memberSince}>{formatDate(memberSince)}</time>
                </dd>
              </div>
            </dl>
          </AccountSection>

          <AccountSection
            title="Quick actions"
            description="Jump to a part of your customer account."
          >
            <div className={styles.quickLinks}>
              {QUICK_LINKS.map((link) => (
                <Link className={styles.quickLink} href={link.href} key={link.href}>
                  <span className={styles.quickIcon}>
                    <Icon name={link.icon} size={18} />
                  </span>
                  <span className={styles.quickCopy}>
                    <span className={styles.quickTitle}>{link.title}</span>
                    <span className={styles.quickDescription}>
                      {link.description}
                    </span>
                  </span>
                  <Icon
                    className={styles.quickArrow}
                    name="arrow-right"
                    size={16}
                  />
                </Link>
              ))}
            </div>
          </AccountSection>
        </div>
      </div>
    </div>
  );
}
