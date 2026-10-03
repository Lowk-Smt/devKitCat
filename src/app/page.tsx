import { CategoriesSection } from "@/components/sections/CategoriesSection";
import { FeaturedProductsSection } from "@/components/sections/FeaturedProductsSection";
import { FinalCta } from "@/components/sections/FinalCta";
import { Hero } from "@/components/sections/Hero";
import { ValueSection } from "@/components/sections/ValueSection";
import { connection } from "next/server";
import { listCategories, listProducts } from "@/lib/server/data-access";

export default async function HomePage() {
  await connection();
  const [categories, featuredProducts] = await Promise.all([
    listCategories(),
    listProducts({ featuredOnly: true }),
  ]);

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
