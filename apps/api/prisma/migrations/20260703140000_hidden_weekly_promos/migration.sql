-- CreateTable
CREATE TABLE "HouseholdHiddenWeeklyPromo" (
    "householdId" TEXT NOT NULL,
    "groupKey" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HouseholdHiddenWeeklyPromo_pkey" PRIMARY KEY ("householdId","groupKey")
);

-- AddForeignKey
ALTER TABLE "HouseholdHiddenWeeklyPromo" ADD CONSTRAINT "HouseholdHiddenWeeklyPromo_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;
