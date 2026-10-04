import type { Metadata } from "next";
import { connection } from "next/server";
import { Icon } from "@/components/ui/Icon";
import { ManagedProductRow } from "@/components/manage/ManagedProductRow";
import { ProductDraftForm } from "@/components/manage/ProductDraftForm";
import { StaffAccessPanel } from "@/components/manage/StaffAccessPanel";
import { EmptyState } from "@/components/ui/EmptyState";
import styles from "@/components/manage/manage.module.css";
import { requireCustomer } from "@/lib/server/auth";
import { describeProductAdminFailure } from "@/lib/server/product-admin-core";
import { productAdmin } from "@/lib/server/product-admin";
import { can, requireStaffAccess, staffAccess } from "@/lib/server/staff";
import {
  resolveManageNotice,
  staffRoleLabel,
  STAFF_ROLE_LABELS,
} from "@/lib/server/staff-core";
import { listCategories } from "@/lib/server/data-access";

/**
 * Private product management, Phase 1.
 *
 * There is no link here from the public chrome and no public way to ask for
 * access: for launch, only the owner and the staff an owner has granted can
 * manage products. Anyone may still register a normal customer account, and that
 * account can browse, buy, and use `/account` exactly as before — it simply has
 * no `StaffMembership` row, so every operation on this page refuses it.
 *
 * Two rendering rules matter for security:
 *
 * * `await connection()` plus the session and grant reads below keep this route
 *   dynamic. Nothing here is served from the shared catalog cache
 *   (`src/lib/server/catalog-cache.ts` is public-only by design), so a draft list
 *   can never be cached for anonymous visitors.
 * * `metadata.robots` keeps the page out of search indexes.
 *
 * The data reads are the staff-scoped ones in `product-admin-service.ts`; the
 * public catalog reads in `data-access-core.ts` still filter on `published`.
 */

export const metadata: Metadata = {
  title: "Product management",
  robots: { index: false, follow: false },
};

export default async function ManagePage({ searchParams }: PageProps<"/manage">) {
  await connection();
  const params = await searchParams;

  // Both gates re-read the session; `requireStaffAccess` redirects anyone who is
  // not an authorized staff account before a single product row is queried.
  const customer = await requireCustomer();
  const access = await requireStaffAccess();
  const notice = resolveManageNotice(params);

  const [productsResult, categories] = await Promise.all([
    productAdmin.listProducts(access),
    listCategories(),
  ]);

  const isOwner = can(access, "staff:manage");
  const membershipsResult = isOwner
    ? await staffAccess.listMemberships(access)
    : null;

  const products = productsResult.ok ? productsResult.value : [];
  const draftCount = products.filter((product) => !product.published).length;

  return (
    <div className={`${styles.page} container`}>
      <header className={styles.header}>
        <p className={styles.eyebrow}>Private creator management</p>
        <h1>Product management</h1>
        <p className={styles.description}>
          Create drafts, publish them to the storefront, and retire products again.
          Public creator applications and creator self-service are disabled for
          launch, so this is the only place marketplace products change — and it is
          limited to the owner and the staff an owner has explicitly granted.
        </p>
        <div className={styles.metaRow}>
          <span className={`${styles.badge} ${styles.badgeOk}`}>
            <Icon name="production" size={14} />
            {staffRoleLabel(access.role)} access
          </span>
          <span className={styles.badge}>{customer.email}</span>
          <span className={styles.badge}>
            {products.length} products · {draftCount} unpublished
          </span>
        </div>
      </header>

      {notice ? (
        <p
          className={`${styles.notice} ${
            notice.tone === "ok" ? styles.noticeOk : styles.noticeProblem
          }`}
          role={notice.tone === "ok" ? "status" : "alert"}
        >
          <span className={styles.noticeIcon}>
            <Icon name={notice.tone === "ok" ? "check" : "info"} size={16} />
          </span>
          {notice.message}
        </p>
      ) : null}

      {!productsResult.ok ? (
        <div className={styles.warning} role="alert">
          <strong>Product management is unavailable.</strong>
          <span>{describeProductAdminFailure(productsResult.code)}</span>
        </div>
      ) : null}

      <section className={styles.section} aria-labelledby="manage-catalog">
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle} id="manage-catalog">
            Catalog
          </h2>
          <p className={styles.sectionDescription}>
            Drafts are invisible to customers. Publishing and unpublishing take
            effect immediately, including for the cached marketplace reads.
          </p>
        </div>

        {products.length > 0 ? (
          <ul className={styles.list}>
            {products.map((product) => (
              <ManagedProductRow
                key={product.id}
                product={product}
                categories={categories}
              />
            ))}
          </ul>
        ) : (
          <EmptyState
            icon="templates"
            title="No products yet"
            description="Create the first draft below, or load the curated catalog with `npm run db:seed:catalog`."
            headingLevel={3}
          />
        )}
      </section>

      <section className={styles.section} aria-labelledby="manage-new">
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle} id="manage-new">
            New draft
          </h2>
          <p className={styles.sectionDescription}>
            Only the commercial basics are editable in this phase; media,
            changelog, and documentation stay with the catalog seed until the full
            editor lands.
          </p>
        </div>

        <ProductDraftForm
          categories={categories}
          disabled={!productsResult.ok || categories.length === 0}
        />
      </section>

      <section className={styles.section} aria-labelledby="manage-staff">
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle} id="manage-staff">
            Staff access
          </h2>
          <p className={styles.sectionDescription}>
            {isOwner
              ? "Grant product management to a registered customer account. Owners can also grant the owner role; nobody can raise their own role from here, and the last owner cannot be removed."
              : `Only ${STAFF_ROLE_LABELS.owner} accounts can change staff access, so this list is read-only for you.`}
          </p>
        </div>

        {isOwner ? (
          <StaffAccessPanel
            memberships={
              membershipsResult?.ok ? membershipsResult.value : []
            }
            selfCustomerId={customer.id}
            unavailable={membershipsResult !== null && !membershipsResult.ok}
          />
        ) : (
          <p className={styles.muted}>
            You can manage products, not people. Ask an owner to change your access
            level.
          </p>
        )}
      </section>
    </div>
  );
}
