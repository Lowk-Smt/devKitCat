-- AlterTable
-- Additive: nullable contact fields for manual fulfillment, keeping seeded
-- historical orders and existing records untouched.
ALTER TABLE "Order" ADD COLUMN     "customerName" VARCHAR(120),
ADD COLUMN     "customerPhone" VARCHAR(32),
ADD COLUMN     "telegramHandle" VARCHAR(64);
