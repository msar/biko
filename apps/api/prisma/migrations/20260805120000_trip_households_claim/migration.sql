-- CreateTable
CREATE TABLE "TripHousehold" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TripHousehold_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "TripMember" ADD COLUMN "tripHouseholdId" TEXT;

-- CreateIndex
CREATE INDEX "TripHousehold_tripId_idx" ON "TripHousehold"("tripId");

-- CreateIndex
CREATE INDEX "TripMember_tripHouseholdId_idx" ON "TripMember"("tripHouseholdId");

-- AddForeignKey
ALTER TABLE "TripHousehold" ADD CONSTRAINT "TripHousehold_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripMember" ADD CONSTRAINT "TripMember_tripHouseholdId_fkey" FOREIGN KEY ("tripHouseholdId") REFERENCES "TripHousehold"("id") ON DELETE SET NULL ON UPDATE CASCADE;
