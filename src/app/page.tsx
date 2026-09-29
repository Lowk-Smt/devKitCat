import { CategoriesSection } from "@/components/sections/CategoriesSection";
import { FeaturedProductsSection } from "@/components/sections/FeaturedProductsSection";
import { FinalCta } from "@/components/sections/FinalCta";
import { Hero } from "@/components/sections/Hero";
import { ValueSection } from "@/components/sections/ValueSection";
import { categories } from "@/data/categories";
import { getFeaturedProducts } from "@/data/products";

export default function HomePage() {
  const featuredProducts = getFeaturedProducts();

  return (
    <>
      <Hero />
      <CategoriesSection categories={categories} />
      <FeaturedProductsSection products={featuredProducts} />
      <ValueSection />
      <FinalCta />
    </>
  );
}
