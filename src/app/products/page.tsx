import type { Metadata } from "next";
import { connection } from "next/server";
import { ProductBrowser } from "@/components/marketplace/ProductBrowser";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { products } from "@/data/products";
import { cx } from "@/lib/cx";
import styles from "./products.module.css";

export const metadata: Metadata = {
  title: "Marketplace",
  description:
    "Browse production-ready systems, UI kits, assets, and developer resources for Roblox creators.",
};

export default async function ProductsPage() {
  // Render per request so the server HTML already reflects the URL's
  // search / category / sort (ProductBrowser reads them with useSearchParams).
  await connection();

  return (
    <div className={cx("section", styles.page)}>
      <div className="container">
        <SectionHeading
          level={1}
          eyebrow="Build better Roblox games"
          title="Marketplace"
          description="Production-ready systems, UI kits, 3D assets, VFX, and tools — search the catalog or filter by category to find your next building block."
        />
        <ProductBrowser products={products} />
      </div>
    </div>
  );
}
