import type { ProductType } from "@/types";

/** Human-readable labels for each product type. */
export const PRODUCT_TYPE_LABELS: Record<ProductType, string> = {
  system: "System",
  "ui-kit": "UI Kit",
  "starter-kit": "Starter Kit",
  "model-pack": "Model Pack",
  "vfx-pack": "VFX Pack",
};

/** Formats a USD price, e.g. `14.99` → `$14.99`. */
export function formatPrice(price: number): string {
  return price.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}
