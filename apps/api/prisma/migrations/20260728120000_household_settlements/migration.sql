-- CreateTable
CREATE TABLE "HouseholdSettlement" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "fromUserId" TEXT NOT NULL,
    "toUserId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "note" TEXT,
    "settledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HouseholdSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HouseholdSettlement_householdId_settledAt_idx" ON "HouseholdSettlement"("householdId", "settledAt");

-- AddForeignKey
ALTER TABLE "HouseholdSettlement" ADD CONSTRAINT "HouseholdSettlement_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HouseholdSettlement" ADD CONSTRAINT "HouseholdSettlement_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HouseholdSettlement" ADD CONSTRAINT "HouseholdSettlement_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HouseholdSettlement" ADD CONSTRAINT "HouseholdSettlement_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
