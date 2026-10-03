import "server-only";
import type {
  CategoryIcon as PrismaCategoryIcon,
  DownloadStatus as PrismaDownloadStatus,
  OrderStatus as PrismaOrderStatus,
  PrismaClient,
  ProductType as PrismaProductType,
  ThemePreference as PrismaThemePreference,
} from "@/generated/prisma/client";
import type { MockOrderStatus } from "@/data/mock-account";
import type { Product } from "@/types";
import type { CustomerPreferences as SeedCustomerPreferences } from "@/types/account";
import {
  buildMarketplaceSeedData,
  type MarketplaceSeedData,
  type SeedProduct,
} from "./seed-data";

const CATEGORY_ICON_MAP: Record<string, PrismaCategoryIcon> = {
  systems: "SYSTEMS",
  "ui-kits": "UI_KITS",
  "3d-assets": "ASSETS_3D",
  vfx: "VFX",
  audio: "AUDIO",
  "developer-tools": "DEVELOPER_TOOLS",
  templates: "TEMPLATES",
  "complete-kits": "COMPLETE_KITS",
};

const PRODUCT_TYPE_MAP: Record<Product["type"], PrismaProductType> = {
  system: "SYSTEM",
  "ui-kit": "UI_KIT",
  "starter-kit": "STARTER_KIT",
  "model-pack": "MODEL_PACK",
  "vfx-pack": "VFX_PACK",
};

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

function categoryIcon(icon: string): PrismaCategoryIcon {
  const mapped = CATEGORY_ICON_MAP[icon];
  if (!mapped) throw new Error(`No database category icon mapping exists for ${icon}.`);
  return mapped;
}

function productType(type: SeedProduct["type"]): PrismaProductType {
  return PRODUCT_TYPE_MAP[type];
}

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
    for (const category of data.categories) {
      const fields = {
        name: category.name,
        slug: category.slug,
        description: category.description,
        icon: categoryIcon(category.icon),
        sortOrder: category.sortOrder,
      };
      await tx.category.upsert({
        where: { id: category.id },
        create: { id: category.id, ...fields },
        update: fields,
      });
    }

    for (const product of data.products) {
      const fields = {
        slug: product.slug,
        title: product.title,
        description: product.description,
        overview: product.overview,
        price: product.price.toFixed(2),
        type: productType(product.type),
        version: product.version,
        features: product.features,
        requirements: product.requirements,
        includedFiles: product.includedFiles,
        installation: product.installation,
        documentationSummary: product.documentation.summary,
        documentationTopics: product.documentation.topics,
        license: product.license,
        releasedAt: new Date(`${product.releasedAt}T00:00:00.000Z`),
        isFeatured: product.isFeatured,
        isNew: product.isNew,
        published: product.published,
        sortOrder: product.sortOrder,
        categoryId: product.categoryId,
      };

      await tx.product.upsert({
        where: { id: product.id },
        create: { id: product.id, ...fields },
        update: fields,
      });

      await tx.productImage.deleteMany({
        where: { productId: product.id, position: { gte: product.images.length } },
      });
      for (const [position, src] of product.images.entries()) {
        const imageFields = { src, altText: null };
        await tx.productImage.upsert({
          where: { productId_position: { productId: product.id, position } },
          create: { productId: product.id, position, ...imageFields },
          update: imageFields,
        });
      }

      const modelPreviews = product.modelPreviews ?? [];
      await tx.productModelPreview.deleteMany({
        where: { productId: product.id, position: { gte: modelPreviews.length } },
      });
      for (const [position, preview] of modelPreviews.entries()) {
        const previewFields = {
          src: preview.src,
          label: preview.label,
          description: preview.description,
        };
        await tx.productModelPreview.upsert({
          where: { productId_position: { productId: product.id, position } },
          create: { productId: product.id, position, ...previewFields },
          update: previewFields,
        });
      }

      await tx.productChangelogEntry.deleteMany({
        where: { productId: product.id, position: { gte: product.changelog.length } },
      });
      for (const [position, entry] of product.changelog.entries()) {
        const changelogFields = {
          version: entry.version,
          date: new Date(`${entry.date}T00:00:00.000Z`),
          notes: entry.notes,
        };
        await tx.productChangelogEntry.upsert({
          where: { productId_position: { productId: product.id, position } },
          create: { productId: product.id, position, ...changelogFields },
          update: changelogFields,
        });
      }
    }

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
