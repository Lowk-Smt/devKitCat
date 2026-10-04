-- Private creator management, Phase 1: the staff grant.
--
-- Strictly additive. No existing table is altered, no row is read, updated, or
-- deleted, and nothing is dropped, so every customer, session, order, cart
-- line, and product keeps its current data and meaning.
--
-- The grant lives in its own table instead of a column on `Customer` so that no
-- user-facing write path (registration, profile editing, cart, checkout) can
-- express one: those paths only ever write `Customer` columns, and
-- `Customer` has no role field. Ordinary customers are exactly the accounts
-- with no `StaffMembership` row, which is every account until an owner or the
-- bootstrap script inserts one.

-- CreateEnum
-- OWNER and STAFF are the only two values, and both must be granted explicitly.
-- There is deliberately no "CREATOR" value here: creator-side permissions get
-- their own model in a later phase and cannot satisfy a staff check.
CREATE TYPE "StaffRole" AS ENUM (
  'OWNER',
  'STAFF'
);

-- CreateTable
CREATE TABLE "StaffMembership" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "role" "StaffRole" NOT NULL DEFAULT 'STAFF',
    "grantedByCustomerId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "StaffMembership_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- One grant per account, and `@unique` is what stops a second row from ever
-- contradicting the first one.
CREATE UNIQUE INDEX "StaffMembership_customerId_key" ON "StaffMembership"("customerId");

-- CreateIndex
-- Backs the "how many owners are left?" query that protects the last owner from
-- being revoked or demoted.
CREATE INDEX "StaffMembership_role_idx" ON "StaffMembership"("role");

-- CreateIndex
CREATE INDEX "StaffMembership_grantedByCustomerId_idx" ON "StaffMembership"("grantedByCustomerId");

-- AddForeignKey
-- Cascade, exactly like `Session`: deleting an account deletes its grant, so a
-- stale grant can never outlive the person it was issued to.
ALTER TABLE "StaffMembership"
  ADD CONSTRAINT "StaffMembership_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
-- SetNull: revoking a staff member's account keeps the audit trail of the grant
-- they issued instead of cascading a deletion through it.
ALTER TABLE "StaffMembership"
  ADD CONSTRAINT "StaffMembership_grantedByCustomerId_fkey"
  FOREIGN KEY ("grantedByCustomerId") REFERENCES "Customer"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
