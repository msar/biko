-- Cap usage becomes per (promotion, paying bank). The same promo (e.g. a MODO
-- promo available for several banks) has an independent monthly cap per bank:
-- paying with Santander doesn't consume BBVA's cap for that promo.

DROP INDEX IF EXISTS "MonthlyCapUsage_householdId_promotionId_yearMonth_key";

-- Existing rows merged all banks per promo; clear and rebuild split by bank.
DELETE FROM "MonthlyCapUsage";

ALTER TABLE "MonthlyCapUsage" ADD COLUMN "entityId" TEXT NOT NULL;

-- Rebuild consumed caps per (household, promotion, paying bank, month) from
-- purchase history. The paying bank is the entity of the payment method used.
INSERT INTO "MonthlyCapUsage" ("id", "householdId", "promotionId", "entityId", "yearMonth", "usedAmount")
SELECT
  md5(random()::text || clock_timestamp()::text || p."householdId" || p."promotionId" || d."entityId" || to_char(p."purchaseDate", 'YYYY-MM')),
  p."householdId",
  p."promotionId",
  d."entityId",
  to_char(p."purchaseDate", 'YYYY-MM'),
  SUM(p."discountAmount")
FROM "Purchase" p
JOIN "PaymentMethod" pm ON pm."id" = p."paymentMethodId"
JOIN "PaymentMethodDefinition" d ON d."id" = pm."definitionId"
WHERE p."promotionId" IS NOT NULL
  AND p."discountAmount" > 0
  AND d."entityId" IS NOT NULL
GROUP BY p."householdId", p."promotionId", d."entityId", to_char(p."purchaseDate", 'YYYY-MM');

CREATE UNIQUE INDEX "MonthlyCapUsage_householdId_promotionId_entityId_yearMonth_key" ON "MonthlyCapUsage"("householdId", "promotionId", "entityId", "yearMonth");

ALTER TABLE "MonthlyCapUsage" ADD CONSTRAINT "MonthlyCapUsage_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
