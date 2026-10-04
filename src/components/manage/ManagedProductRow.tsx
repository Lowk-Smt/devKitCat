import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { formatPrice, PRODUCT_TYPE_LABELS } from "@/lib/catalog";
import {
  deleteProductAction,
  setProductPublicationAction,
  updateProductAction,
} from "@/lib/server/product-admin-actions";
import type { ManagedProductRow as ManagedProduct } from "@/lib/server/product-admin-core";
import type { Category } from "@/types";
import { PRODUCT_VERSION_MAX_LENGTH } from "@/lib/server/product-admin-core";
import styles from "./manage.module.css";

interface ManagedProductRowProps {
  product: ManagedProduct;
  categories: readonly Category[];
}

/**
 * One product in the management list, with the only four writes this phase
 * supports: publish, unpublish, edit details, delete.
 *
 * Every control is a `<form>` posting to a Server Function that re-checks the
 * actor's privilege, so removing this component from the page changes nothing
 * about what a request is allowed to do. The edit form prefills from the
 * server-rendered row — never from browser state — and the product id is the only
 * identifier it submits; the actor always comes from the session.
 */
export function ManagedProductRow({ product, categories }: ManagedProductRowProps) {
  const idPrefix = product.id.replace(/[^A-Za-z0-9_-]/g, "-");
  const editPath = `/products/${product.slug}`;

  return (
    <li className={styles.row}>
      <div className={styles.rowMain}>
        <div className={styles.titleCell}>
          <span className={styles.titleText}>{product.title}</span>
          <span className={styles.slugText}>/{product.slug}</span>
          <span className={styles.muted}>
            {PRODUCT_TYPE_LABELS[product.type]} · {product.categoryName} · v
            {product.version} · updated{" "}
            {product.updatedAt.toISOString().slice(0, 10)}
          </span>
        </div>

        <div className={styles.rowBadges}>
          <span
            className={
              product.published ? `${styles.badge} ${styles.badgeOk}` : styles.badge
            }
          >
            {product.published ? "Published" : "Draft"}
          </span>
          <span className={styles.priceText}>{formatPrice(Number(product.price))}</span>
        </div>

        <div className={styles.rowActions}>
          <form className={styles.inlineForm} action={setProductPublicationAction} method="post">
            <input type="hidden" name="productId" value={product.id} />
            <input
              type="hidden"
              name="publish"
              value={product.published ? "unpublish" : "publish"}
            />
            <Button type="submit" variant="secondary" size="sm">
              <Icon name={product.published ? "eye-off" : "eye"} size={15} />
              {product.published ? "Unpublish" : "Publish"}
            </Button>
          </form>

          <form className={styles.inlineForm} action={deleteProductAction} method="post">
            <input type="hidden" name="productId" value={product.id} />
            <Button type="submit" variant="secondary" size="sm">
              <Icon name="trash" size={15} />
              Delete
            </Button>
          </form>
        </div>
      </div>

      {product.referenced ? (
        <p className={styles.muted}>
          Orders, downloads, or carts reference this product, so deletion is refused.
          Unpublish it to retire it instead.
        </p>
      ) : null}

      <details className={styles.disclosure}>
        <summary className={styles.disclosureSummary}>
          <Icon name="settings" size={15} />
          Edit details
        </summary>

        <form className={styles.form} action={updateProductAction} method="post">
          <input type="hidden" name="productId" value={product.id} />

          <div className={styles.fieldGrid}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor={`${idPrefix}-title`}>
                Title
              </label>
              <input
                className={styles.input}
                id={`${idPrefix}-title`}
                name="title"
                type="text"
                defaultValue={product.title}
                maxLength={120}
                required
              />
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor={`${idPrefix}-slug`}>
                URL slug
              </label>
              <input
                className={styles.input}
                id={`${idPrefix}-slug`}
                name="slug"
                type="text"
                defaultValue={product.slug}
                maxLength={80}
                required
              />
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor={`${idPrefix}-price`}>
                Price (USD)
              </label>
              <input
                className={styles.input}
                id={`${idPrefix}-price`}
                name="price"
                type="text"
                inputMode="decimal"
                pattern="\d{1,8}(\.\d{1,2})?"
                defaultValue={product.price}
                required
              />
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor={`${idPrefix}-version`}>
                Version
              </label>
              <input
                className={styles.input}
                id={`${idPrefix}-version`}
                name="version"
                type="text"
                defaultValue={product.version}
                maxLength={PRODUCT_VERSION_MAX_LENGTH}
                required
              />
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor={`${idPrefix}-type`}>
                Type
              </label>
              <select
                className={styles.select}
                id={`${idPrefix}-type`}
                name="type"
                defaultValue={product.type}
                required
              >
                {Object.entries(PRODUCT_TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor={`${idPrefix}-category`}>
                Category
              </label>
              <select
                className={styles.select}
                id={`${idPrefix}-category`}
                name="category"
                defaultValue={product.categorySlug}
                required
              >
                {categories.map((category) => (
                  <option key={category.slug} value={category.slug}>
                    {category.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor={`${idPrefix}-description`}>
              Short description
            </label>
            <textarea
              className={styles.textarea}
              id={`${idPrefix}-description`}
              name="description"
              maxLength={2000}
              required
            >
              {product.description}
            </textarea>
          </div>

          <div className={styles.formActions}>
            <Button type="submit" variant="primary" size="sm">
              <Icon name="check" size={15} />
              Save changes
            </Button>
            <Link className={styles.muted} href={editPath}>
              View the public page <Icon name="arrow-up-right" size={14} />
            </Link>
          </div>
        </form>
      </details>
    </li>
  );
}
