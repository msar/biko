-- CreateTable
CREATE TABLE "HouseholdFavoriteWeeklyPromo" (
    "householdId" TEXT NOT NULL,
    "groupKey" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HouseholdFavoriteWeeklyPromo_pkey" PRIMARY KEY ("householdId","groupKey")
);

-- AddForeignKey
ALTER TABLE "HouseholdFavoriteWeeklyPromo" ADD CONSTRAINT "HouseholdFavoriteWeeklyPromo_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;
