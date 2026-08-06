-- Readable trip invite slugs + trip-only users (nullable household).

ALTER TABLE "User" ALTER COLUMN "householdId" DROP NOT NULL;

ALTER TABLE "Trip" ADD COLUMN "shareSlug" TEXT;

UPDATE "Trip"
SET "shareSlug" = 'viaje-' || substr("id", 1, 10)
WHERE "shareSlug" IS NULL;

ALTER TABLE "Trip" ALTER COLUMN "shareSlug" SET NOT NULL;

CREATE UNIQUE INDEX "Trip_shareSlug_key" ON "Trip"("shareSlug");
