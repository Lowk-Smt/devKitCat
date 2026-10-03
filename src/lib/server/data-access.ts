import "server-only";
import { categories } from "@/data/categories";
import {
  getMockDownloads,
  getMockOrders,
  mockCustomer,
} from "@/data/mock-account";
import { products } from "@/data/products";
import type { CustomerRecord } from "@/types/account";
import { getDatabaseClient } from "./database";
import { createMarketplaceDataAccess } from "./data-access-core";

const demoCustomerCreatedAt = new Date(
  `${mockCustomer.memberSince}T00:00:00.000Z`,
);

const fallbackCustomer: CustomerRecord = {
  id: mockCustomer.id,
  name: mockCustomer.name,
  email: mockCustomer.email,
  createdAt: demoCustomerCreatedAt,
  updatedAt: demoCustomerCreatedAt,
};

const readers = createMarketplaceDataAccess(
  getDatabaseClient,
  {
    products,
    categories,
    customers: [fallbackCustomer],
    orders: getMockOrders().map((order) => ({
      customerId: mockCustomer.id,
      order,
    })),
    downloads: getMockDownloads().map((download) => ({
      customerId: mockCustomer.id,
      download,
    })),
  },
);

/** Marketplace data uses PostgreSQL when configured, static demo data otherwise. */
export const listProducts = readers.listProducts;
export const getProductBySlug = readers.getProductBySlug;
export const getProductById = readers.getProductById;
export const listCategories = readers.listCategories;
export const getRelatedProducts = readers.getRelatedProducts;

/** Data-only account reads; callers must add authentication/authorization later. */
export const getCustomerByEmail = readers.getCustomerByEmail;
export const getCustomerById = readers.getCustomerById;
export const listCustomerOrders = readers.listCustomerOrders;
export const getOrderById = readers.getOrderById;
export const listCustomerDownloads = readers.listCustomerDownloads;
