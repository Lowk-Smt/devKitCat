import "server-only";
import type {
  DownloadStatus as PrismaDownloadStatus,
  OrderStatus as PrismaOrderStatus,
  PrismaClient,
  ThemePreference as PrismaThemePreference,
} from "@/generated/prisma/client";
import type { MockOrderStatus } from "@/data/mock-account";
import type { CustomerPreferences as SeedCustomerPreferences } from "@/types/account";
import { buildMarketplaceSeedData, type MarketplaceSeedData } from "./seed-data";
import { writeCatalog } from "./seed-catalog";

const ORDER_STATUS_MAP: Record<MockOrderStatus, PrismaOrderStatus> = {
  complete: "COMPLETE",
  processing: "PROCESSING",
  refunded: "REFUNDED",
};

const PENDING_DOWNLOAD: PrismaDownloadStatus = "PENDING";

const THEME_PREFERENCE_MAP: Record<
  SeedCustomerPreferences["theme"],
  PrismaThemePreference
> = {
  dark: "DARK",
  system: "SYSTEM",
};

export interface SeedSummary {
  categories: number;
  products: number;
  customer: number;
  orders: number;
  orderItems: number;
  downloads: number;
}

/** Upserts the demo catalog and account records inside one database transaction. */
export async function seedMarketplace(
  prisma: PrismaClient,
  data: MarketplaceSeedData = buildMarketplaceSeedData(),
): Promise<SeedSummary> {
  await prisma.$transaction(async (tx) => {
    // Categories, products, and their media/changelog rows are written by the
    // same catalog-only writer that the production catalog seed uses.
    await writeCatalog(tx, data);

    // No passwordHash is written: the fixture customer stays signed-out-only,
    // and re-seeding must never overwrite a real credential.
    const customer = await tx.customer.upsert({
      where: { email: data.customer.email },
      create: {
        id: data.customer.id,
        email: data.customer.email,
        name: data.customer.name,
        themePreference: THEME_PREFERENCE_MAP[data.customer.preferences.theme],
        productUpdates: data.customer.preferences.productUpdates,
        releaseNotes: data.customer.preferences.releaseNotes,
        createdAt: data.customer.createdAt,
      },
      update: { name: data.customer.name },
    });

    const orderItemIds = new Map<string, string>();
    for (const order of data.orders) {
      const orderFields = {
        customerId: customer.id,
        status: ORDER_STATUS_MAP[order.status],
        total: order.total.toFixed(2),
        currency: order.currency,
        createdAt: order.createdAt,
      };
      await tx.order.upsert({
        where: { id: order.id },
        create: { id: order.id, ...orderFields },
        update: orderFields,
      });

      const productIds = order.items.map((item) => item.productId);
      await tx.orderItem.deleteMany({
        where: { orderId: order.id, productId: { notIn: productIds } },
      });

      for (const item of order.items) {
        const itemFields = {
          orderId: order.id,
          productId: item.productId,
          productTitle: item.productTitle,
          productSlug: item.productSlug,
          categorySlug: item.categorySlug,
          categoryName: item.categoryName,
          versionAtPurchase: item.versionAtPurchase,
          unitPrice: item.unitPrice.toFixed(2),
          quantity: item.quantity,
          position: item.position,
        };
        const savedItem = await tx.orderItem.upsert({
          where: {
            orderId_productId: {
              orderId: item.orderId,
              productId: item.productId,
            },
          },
          create: { id: item.id, ...itemFields },
          update: itemFields,
        });
        orderItemIds.set(item.id, savedItem.id);
      }
    }

    for (const download of data.downloads) {
      const orderItemId = orderItemIds.get(download.orderItemKey);
      if (!orderItemId) {
        throw new Error(`No seeded order item exists for download ${download.id}.`);
      }

      const downloadFields = {
        customerId: customer.id,
        productId: download.productId,
        orderItemId,
        status: PENDING_DOWNLOAD,
        fileKey: download.fileKey,
        createdAt: download.createdAt,
      };
      await tx.download.upsert({
        where: { id: download.id },
        create: { id: download.id, ...downloadFields },
        update: downloadFields,
      });
    }
  });

  return {
    categories: data.categories.length,
    products: data.products.length,
    customer: 1,
    orders: data.orders.length,
    orderItems: data.orders.reduce((total, order) => total + order.items.length, 0),
    downloads: data.downloads.length,
  };
}
