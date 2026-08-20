-- AlterTable
ALTER TABLE "Purchase" ADD COLUMN "sourceTripId" TEXT;

-- CreateTable
CREATE TABLE "PurchasePayment" (
    "id" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "PurchasePayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PurchasePayment_userId_idx" ON "PurchasePayment"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchasePayment_purchaseId_userId_key" ON "PurchasePayment"("purchaseId", "userId");

-- CreateIndex
CREATE INDEX "Purchase_sourceTripId_idx" ON "Purchase"("sourceTripId");

-- CreateIndex
CREATE UNIQUE INDEX "Purchase_householdId_sourceTripId_key" ON "Purchase"("householdId", "sourceTripId");

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_sourceTripId_fkey" FOREIGN KEY ("sourceTripId") REFERENCES "Trip"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchasePayment" ADD CONSTRAINT "PurchasePayment_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchasePayment" ADD CONSTRAINT "PurchasePayment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill: one payment row per existing purchase (primary payer or logger).
INSERT INTO "PurchasePayment" ("id", "purchaseId", "userId", "amount")
SELECT
  gen_random_uuid()::text,
  p."id",
  COALESCE(p."paidByUserId", p."userId"),
  p."netAmount"
FROM "Purchase" p;
