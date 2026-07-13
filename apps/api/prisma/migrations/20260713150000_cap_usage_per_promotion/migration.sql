-- Cap usage moves from per-entity (shared across a bank's promos) to per-promotion.
-- Each promotion now has its own independent monthly reintegro cap.

-- Drop old entity-based constraints/indexes.
ALTER TABLE "MonthlyCapUsage" DROP CONSTRAINT IF EXISTS "MonthlyCapUsage_entityId_fkey";
DROP INDEX IF EXISTS "MonthlyCapUsage_householdId_entityId_yearMonth_key";

-- Old rows are keyed by entity and can't be mapped to a single promotion; clear
-- and rebuild from purchase history below.
DELETE FROM "MonthlyCapUsage";

ALTER TABLE "MonthlyCapUsage" DROP COLUMN "entityId";
ALTER TABLE "MonthlyCapUsage" ADD COLUMN "promotionId" TEXT NOT NULL;

-- Rebuild consumed caps per (household, promotion, month) from existing purchases.
INSERT INTO "MonthlyCapUsage" ("id", "householdId", "promotionId", "yearMonth", "usedAmount")
SELECT
  md5(random()::text || clock_timestamp()::text || p."householdId" || p."promotionId" || to_char(p."purchaseDate", 'YYYY-MM')),
  p."householdId",
  p."promotionId",
  to_char(p."purchaseDate", 'YYYY-MM'),
  SUM(p."discountAmount")
FROM "Purchase" p
WHERE p."promotionId" IS NOT NULL AND p."discountAmount" > 0
GROUP BY p."householdId", p."promotionId", to_char(p."purchaseDate", 'YYYY-MM');

-- Recreate constraints/indexes on the new promotion key.
CREATE UNIQUE INDEX "MonthlyCapUsage_householdId_promotionId_yearMonth_key" ON "MonthlyCapUsage"("householdId", "promotionId", "yearMonth");

ALTER TABLE "MonthlyCapUsage" ADD CONSTRAINT "MonthlyCapUsage_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "Promotion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
