CREATE TYPE "CategoryIcon" AS ENUM (
  'SYSTEMS',
  'UI_KITS',
  'ASSETS_3D',
  'VFX',
  'AUDIO',
  'DEVELOPER_TOOLS',
  'TEMPLATES',
  'COMPLETE_KITS'
);

CREATE TYPE "ProductType" AS ENUM (
  'SYSTEM',
  'UI_KIT',
  'STARTER_KIT',
  'MODEL_PACK',
  'VFX_PACK'
);

CREATE TYPE "OrderStatus" AS ENUM (
  'COMPLETE',
  'PROCESSING',
  'REFUNDED'
);

CREATE TYPE "DownloadStatus" AS ENUM (
  'PENDING',
  'AVAILABLE',
  'REVOKED'
);

CREATE TABLE "Category" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "icon" "CategoryIcon" NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Product" (
  "id" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "overview" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "price" DECIMAL(10,2) NOT NULL,
  "type" "ProductType" NOT NULL,
  "version" TEXT NOT NULL,
  "features" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "requirements" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "includedFiles" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "installation" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "documentationSummary" TEXT NOT NULL,
  "documentationTopics" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "license" TEXT NOT NULL,
  "releasedAt" DATE NOT NULL,
  "isFeatured" BOOLEAN NOT NULL DEFAULT false,
  "isNew" BOOLEAN NOT NULL DEFAULT false,
  "published" BOOLEAN NOT NULL DEFAULT false,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "categoryId" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductImage" (
  "id" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "src" TEXT NOT NULL,
  "altText" TEXT,
  "position" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "ProductImage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductModelPreview" (
  "id" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "src" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "position" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "ProductModelPreview_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductChangelogEntry" (
  "id" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "notes" TEXT NOT NULL,
  "position" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "ProductChangelogEntry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Customer" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Order" (
  "id" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "status" "OrderStatus" NOT NULL,
  "total" DECIMAL(10,2) NOT NULL,
  "currency" VARCHAR(3) NOT NULL DEFAULT 'USD',
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OrderItem" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "productTitle" TEXT NOT NULL,
  "productSlug" TEXT NOT NULL,
  "categorySlug" TEXT NOT NULL,
  "categoryName" TEXT NOT NULL,
  "versionAtPurchase" TEXT NOT NULL,
  "unitPrice" DECIMAL(10,2) NOT NULL,
  "quantity" INTEGER NOT NULL DEFAULT 1,
  "position" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Download" (
  "id" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "orderItemId" TEXT,
  "status" "DownloadStatus" NOT NULL DEFAULT 'PENDING',
  "fileKey" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "Download_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Category_slug_key" ON "Category"("slug");
CREATE INDEX "Category_sortOrder_slug_idx" ON "Category"("sortOrder", "slug");

CREATE UNIQUE INDEX "Product_slug_key" ON "Product"("slug");
CREATE INDEX "Product_categoryId_published_sortOrder_idx" ON "Product"("categoryId", "published", "sortOrder");
CREATE INDEX "Product_published_isFeatured_sortOrder_idx" ON "Product"("published", "isFeatured", "sortOrder");

CREATE UNIQUE INDEX "ProductImage_productId_position_key" ON "ProductImage"("productId", "position");
CREATE INDEX "ProductImage_productId_idx" ON "ProductImage"("productId");

CREATE UNIQUE INDEX "ProductModelPreview_productId_position_key" ON "ProductModelPreview"("productId", "position");
CREATE INDEX "ProductModelPreview_productId_idx" ON "ProductModelPreview"("productId");

CREATE UNIQUE INDEX "ProductChangelogEntry_productId_position_key" ON "ProductChangelogEntry"("productId", "position");
CREATE INDEX "ProductChangelogEntry_productId_date_idx" ON "ProductChangelogEntry"("productId", "date");

CREATE UNIQUE INDEX "Customer_email_key" ON "Customer"("email");
CREATE INDEX "Order_customerId_createdAt_idx" ON "Order"("customerId", "createdAt");

CREATE UNIQUE INDEX "OrderItem_orderId_productId_key" ON "OrderItem"("orderId", "productId");
CREATE INDEX "OrderItem_productId_idx" ON "OrderItem"("productId");

CREATE UNIQUE INDEX "Download_orderItemId_key" ON "Download"("orderItemId");
CREATE INDEX "Download_customerId_createdAt_idx" ON "Download"("customerId", "createdAt");
CREATE INDEX "Download_productId_idx" ON "Download"("productId");

ALTER TABLE "Product"
  ADD CONSTRAINT "Product_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "Category"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProductImage"
  ADD CONSTRAINT "ProductImage_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProductModelPreview"
  ADD CONSTRAINT "ProductModelPreview_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProductChangelogEntry"
  ADD CONSTRAINT "ProductChangelogEntry_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Order"
  ADD CONSTRAINT "Order_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OrderItem"
  ADD CONSTRAINT "OrderItem_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OrderItem"
  ADD CONSTRAINT "OrderItem_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Download"
  ADD CONSTRAINT "Download_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Download"
  ADD CONSTRAINT "Download_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Download"
  ADD CONSTRAINT "Download_orderItemId_fkey"
  FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
