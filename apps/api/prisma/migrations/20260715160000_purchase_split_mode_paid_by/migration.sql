-- AlterEnum
CREATE TYPE "SplitMode" AS ENUM ('EQUAL', 'ASSIGN', 'AMOUNT', 'SHARES', 'PERCENTAGE');

-- AlterTable
ALTER TABLE "Purchase" ADD COLUMN "splitMode" "SplitMode" NOT NULL DEFAULT 'EQUAL';
ALTER TABLE "Purchase" ADD COLUMN "paidByUserId" TEXT;

-- CreateIndex
CREATE INDEX "Purchase_paidByUserId_idx" ON "Purchase"("paidByUserId");

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_paidByUserId_fkey" FOREIGN KEY ("paidByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill paidByUserId from payment method owner, else purchase logger
UPDATE "Purchase" p
SET "paidByUserId" = COALESCE(pm."ownerUserId", p."userId")
FROM "PaymentMethod" pm
WHERE pm.id = p."paymentMethodId";

-- Infer ASSIGN when a single member has 100% of netAmount
UPDATE "Purchase" p
SET "splitMode" = 'ASSIGN'
WHERE p.scope = 'HOUSEHOLD'
  AND (
    SELECT COUNT(*)::int FROM "PurchaseAllocation" a
    WHERE a."purchaseId" = p.id AND a.amount > 0
  ) = 1
  AND EXISTS (
    SELECT 1 FROM "PurchaseAllocation" a
    WHERE a."purchaseId" = p.id AND a.amount = p."netAmount"
  );

-- Infer AMOUNT when unequal multi-member allocations (legacy custom myShare)
UPDATE "Purchase" p
SET "splitMode" = 'AMOUNT'
WHERE p.scope = 'HOUSEHOLD'
  AND p."splitMode" = 'EQUAL'
  AND EXISTS (
    SELECT 1
    FROM "PurchaseAllocation" a1
    JOIN "PurchaseAllocation" a2
      ON a1."purchaseId" = a2."purchaseId" AND a1."userId" <> a2."userId"
    WHERE a1."purchaseId" = p.id AND a1.amount <> a2.amount
  );
