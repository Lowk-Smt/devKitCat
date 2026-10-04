import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { PRODUCT_TYPE_LABELS } from "@/lib/catalog";
import { PRODUCT_VERSION_MAX_LENGTH } from "@/lib/server/product-admin-core";
import { createProductDraftAction } from "@/lib/server/product-admin-actions";
import type { Category } from "@/types";
import styles from "./manage.module.css";

interface ProductDraftFormProps {
  /** Categories come from the catalog read; an empty list disables submission. */
  categories: readonly Category[];
  disabled?: boolean;
}

const TYPE_VALUES = Object.keys(PRODUCT_TYPE_LABELS) as [
  keyof typeof PRODUCT_TYPE_LABELS,
  ...Array<keyof typeof PRODUCT_TYPE_LABELS>,
];

/**
 * Creates a draft product.
 *
 * A plain `<form>` posting to a Server Function: no client component, no
 * browser state, and no hidden `published` or role field. The draft it produces is
 * never published — `createProductDraftAction` forces `published: false`, and
 * publishing is the separate, separately checked action on each row below.
 */
export function ProductDraftForm({ categories, disabled = false }: ProductDraftFormProps) {
  const blocked = disabled || categories.length === 0;

  return (
    <form className={styles.form} action={createProductDraftAction} method="post">
      <div className={styles.fieldGrid}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="draft-title">
            Title
          </label>
          <input
            className={styles.input}
            id="draft-title"
            name="title"
            type="text"
            maxLength={120}
            required
            disabled={blocked}
            placeholder="ProSave — DataStore System"
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="draft-slug">
            URL slug <span className={styles.muted}>(optional)</span>
          </label>
          <input
            className={styles.input}
            id="draft-slug"
            name="slug"
            type="text"
            maxLength={80}
            disabled={blocked}
            placeholder="Derived from the title when left blank"
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="draft-price">
            Price (USD)
          </label>
          <input
            className={styles.input}
            id="draft-price"
            name="price"
            type="text"
            inputMode="decimal"
            pattern="\d{1,8}(\.\d{1,2})?"
            required
            disabled={blocked}
            placeholder="14.99"
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="draft-version">
            Version
          </label>
          <input
            className={styles.input}
            id="draft-version"
            name="version"
            type="text"
            maxLength={PRODUCT_VERSION_MAX_LENGTH}
            required
            disabled={blocked}
            placeholder="1.0.0"
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="draft-type">
            Type
          </label>
          <select
            className={styles.select}
            id="draft-type"
            name="type"
            required
            disabled={blocked}
          >
            {TYPE_VALUES.map((value) => (
              <option key={value} value={value}>
                {PRODUCT_TYPE_LABELS[value]}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="draft-category">
            Category
          </label>
          <select
            className={styles.select}
            id="draft-category"
            name="category"
            required
            disabled={blocked}
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
        <label className={styles.label} htmlFor="draft-description">
          Short description
        </label>
        <textarea
          className={styles.textarea}
          id="draft-description"
          name="description"
          maxLength={2000}
          required
          disabled={blocked}
          placeholder="What the product does, and which engine or framework it targets."
        />
      </div>

      <div className={styles.formActions}>
        <Button type="submit" variant="primary" size="sm" disabled={blocked}>
          <Icon name="check" size={16} />
          Create draft
        </Button>
        <p className={styles.muted}>
          New products are created unpublished, so nothing reaches the storefront
          until you publish it from the list below.
        </p>
      </div>
    </form>
  );
}
