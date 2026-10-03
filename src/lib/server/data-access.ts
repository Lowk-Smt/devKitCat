import "server-only";
import { categories } from "@/data/categories";
import { products } from "@/data/products";
import { createMarketplaceDataAccess } from "./data-access-core";
import { getDatabaseClient } from "./database";

const readers = createMarketplaceDataAccess(getDatabaseClient, {
  products,
  categories,
});

/** Marketplace data uses PostgreSQL when configured, static demo data otherwise. */
export const listProducts = readers.listProducts;
export const getProductBySlug = readers.getProductBySlug;
export const getProductById = readers.getProductById;
export const listCategories = readers.listCategories;
export const getRelatedProducts = readers.getRelatedProducts;

/**
 * Customer-scoped account reads.
 *
 * Callers must pass the customer returned by `requireCustomer()`
 * (`src/lib/server/auth.ts`); these reads never accept a customer identity from
 * a route parameter or form field, and they have no offline fixture fallback.
 */
export const listCustomerOrders = readers.listCustomerOrders;
export const getCustomerOrderById = readers.getCustomerOrderById;
export const listCustomerDownloads = readers.listCustomerDownloads;
