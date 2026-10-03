-- AlterEnum
-- Additive: existing COMPLETE / PROCESSING / REFUNDED rows keep their meaning.
-- PENDING_PAYMENT marks a checkout submission that no payment provider has
-- settled yet, so an unpaid order can never be mistaken for a paid one.
ALTER TYPE "OrderStatus" ADD VALUE 'PENDING_PAYMENT';

-- AlterTable
-- Nullable, so the seeded historical orders are untouched. Postgres treats
-- NULLs as distinct in a unique index, so those rows cannot collide.
ALTER TABLE "Order" ADD COLUMN     "idempotencyKey" VARCHAR(64);

-- CreateTable
CREATE TABLE "CartItem" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CartItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CartItem_customerId_productId_key" ON "CartItem"("customerId", "productId");

-- CreateIndex
CREATE INDEX "CartItem_customerId_idx" ON "CartItem"("customerId");

-- CreateIndex
CREATE INDEX "CartItem_productId_idx" ON "CartItem"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_customerId_idempotencyKey_key" ON "Order"("customerId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "CartItem"
  ADD CONSTRAINT "CartItem_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CartItem"
  ADD CONSTRAINT "CartItem_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
