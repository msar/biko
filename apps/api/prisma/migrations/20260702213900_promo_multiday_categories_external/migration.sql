-- Promotion: dayOfWeek (single, nullable) -> daysOfWeek (array; vacío = todos los días)
ALTER TABLE "Promotion" ADD COLUMN "daysOfWeek" "DayOfWeek"[] DEFAULT ARRAY[]::"DayOfWeek"[];

-- Migrar datos existentes: un día se vuelve array de un elemento; null queda [].
UPDATE "Promotion" SET "daysOfWeek" = ARRAY["dayOfWeek"]::"DayOfWeek"[] WHERE "dayOfWeek" IS NOT NULL;

ALTER TABLE "Promotion" DROP COLUMN "dayOfWeek";

-- Clave de dedupe para promos scrapeadas
ALTER TABLE "Promotion" ADD COLUMN "externalSource" TEXT;
ALTER TABLE "Promotion" ADD COLUMN "externalId" TEXT;

CREATE UNIQUE INDEX "Promotion_externalSource_externalId_key" ON "Promotion"("externalSource", "externalId");

-- Índice viejo referenciaba dayOfWeek
DROP INDEX IF EXISTS "Promotion_entityId_dayOfWeek_active_idx";
CREATE INDEX "Promotion_entityId_active_idx" ON "Promotion"("entityId", "active");

-- Rubros/categorías por promo
CREATE TABLE "PromotionCategory" (
    "promotionId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,

    CONSTRAINT "PromotionCategory_pkey" PRIMARY KEY ("promotionId","categoryId")
);

ALTER TABLE "PromotionCategory" ADD CONSTRAINT "PromotionCategory_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "Promotion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PromotionCategory" ADD CONSTRAINT "PromotionCategory_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;
