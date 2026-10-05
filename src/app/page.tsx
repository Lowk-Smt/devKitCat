import { CategoriesSection } from "@/components/sections/CategoriesSection";
import { FeaturedProductsSection } from "@/components/sections/FeaturedProductsSection";
import { FinalCta } from "@/components/sections/FinalCta";
import { Hero } from "@/components/sections/Hero";
import { ValueSection } from "@/components/sections/ValueSection";
import { connection } from "next/server";
import { getCachedCategories, getCachedProducts } from "@/lib/server/catalog-cache";

export default async function HomePage() {
  await connection();
  // The Categories links target /#categories. Reuse /products' cache entries so
  // neither categories nor featured products block navigation on a warm read.
  const [categories, products] = await Promise.all([
    getCachedCategories(),
    getCachedProducts(),
  ]);
  const featuredProducts = products.filter((product) => product.isFeatured);

  return (
    <>
      <Hero />
      <CategoriesSection categories={categories} />
      <FeaturedProductsSection
        products={featuredProducts}
        categories={categories}
      />
      <ValueSection />
      <FinalCta />
    </>
  );
}
