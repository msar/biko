-- CreateEnum
CREATE TYPE "ExpenseScope" AS ENUM ('HOUSEHOLD', 'PERSONAL');

-- AlterTable
ALTER TABLE "Purchase" ADD COLUMN "scope" "ExpenseScope" NOT NULL DEFAULT 'HOUSEHOLD';

-- CreateTable
CREATE TABLE "PurchaseAllocation" (
    "id" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "PurchaseAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseAllocation_purchaseId_userId_key" ON "PurchaseAllocation"("purchaseId", "userId");

-- AddForeignKey
ALTER TABLE "PurchaseAllocation" ADD CONSTRAINT "PurchaseAllocation_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseAllocation" ADD CONSTRAINT "PurchaseAllocation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill: equal split among household members for existing purchases
DO $$
DECLARE
  purchase_rec RECORD;
  user_rec RECORD;
  member_count INT;
  member_idx INT;
  base_share NUMERIC(12,2);
  allocated NUMERIC(12,2);
  last_user_id TEXT;
BEGIN
  FOR purchase_rec IN SELECT p.id, p."householdId", p."userId", p."netAmount" FROM "Purchase" p LOOP
    SELECT COUNT(*) INTO member_count FROM "User" u WHERE u."householdId" = purchase_rec."householdId";

    IF member_count <= 0 THEN
      INSERT INTO "PurchaseAllocation" ("id", "purchaseId", "userId", "amount")
      VALUES (
        'alloc_' || purchase_rec.id || '_' || purchase_rec."userId",
        purchase_rec.id,
        purchase_rec."userId",
        purchase_rec."netAmount"
      );
    ELSE
      base_share := ROUND(purchase_rec."netAmount" / member_count, 2);
      allocated := 0;
      member_idx := 0;

      FOR user_rec IN
        SELECT u.id FROM "User" u
        WHERE u."householdId" = purchase_rec."householdId"
        ORDER BY u.id
      LOOP
        member_idx := member_idx + 1;
        last_user_id := user_rec.id;

        IF member_idx < member_count THEN
          INSERT INTO "PurchaseAllocation" ("id", "purchaseId", "userId", "amount")
          VALUES (
            'alloc_' || purchase_rec.id || '_' || user_rec.id,
            purchase_rec.id,
            user_rec.id,
            base_share
          );
          allocated := allocated + base_share;
        END IF;
      END LOOP;

      INSERT INTO "PurchaseAllocation" ("id", "purchaseId", "userId", "amount")
      VALUES (
        'alloc_' || purchase_rec.id || '_' || last_user_id,
        purchase_rec.id,
        last_user_id,
        purchase_rec."netAmount" - allocated
      );
    END IF;
  END LOOP;
END $$;
