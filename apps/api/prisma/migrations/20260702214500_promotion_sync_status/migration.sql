CREATE TABLE "PromotionSync" (
    "source" TEXT NOT NULL,
    "lastRunAt" TIMESTAMP(3),
    "lastError" TEXT,
    "imported" INTEGER NOT NULL DEFAULT 0,
    "updated" INTEGER NOT NULL DEFAULT 0,
    "deactivated" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PromotionSync_pkey" PRIMARY KEY ("source")
);
