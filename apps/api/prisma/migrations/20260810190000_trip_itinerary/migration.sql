-- CreateEnum
CREATE TYPE "TripItineraryItemType" AS ENUM ('MEAL', 'RESERVATION', 'ACTIVITY', 'ARRIVAL');

-- CreateEnum
CREATE TYPE "TripMealSlot" AS ENUM ('BREAKFAST', 'LUNCH', 'DINNER');

-- CreateEnum
CREATE TYPE "TripArrivalKind" AS ENUM ('CHECK_IN', 'CHECK_OUT', 'FLIGHT', 'CAR');

-- CreateTable
CREATE TABLE "TripItineraryItem" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "type" "TripItineraryItemType" NOT NULL,
    "dayDate" TIMESTAMP(3) NOT NULL,
    "startTime" TEXT,
    "endTime" TEXT,
    "title" TEXT,
    "notes" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "mealSlot" "TripMealSlot",
    "menu" TEXT,
    "inChargeMemberId" TEXT,
    "placeName" TEXT,
    "address" TEXT,
    "link" TEXT,
    "mealItemId" TEXT,
    "amount" DECIMAL(12,2),
    "expenseId" TEXT,
    "arrivalKind" "TripArrivalKind",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TripItineraryItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TripItineraryItem_expenseId_key" ON "TripItineraryItem"("expenseId");

-- CreateIndex
CREATE INDEX "TripItineraryItem_tripId_dayDate_idx" ON "TripItineraryItem"("tripId", "dayDate");

-- CreateIndex
CREATE INDEX "TripItineraryItem_tripId_type_dayDate_idx" ON "TripItineraryItem"("tripId", "type", "dayDate");

-- CreateIndex
CREATE INDEX "TripItineraryItem_inChargeMemberId_idx" ON "TripItineraryItem"("inChargeMemberId");

-- CreateIndex
CREATE INDEX "TripItineraryItem_mealItemId_idx" ON "TripItineraryItem"("mealItemId");

-- One meal slot per calendar day (MEAL rows only)
CREATE UNIQUE INDEX "TripItineraryItem_trip_day_meal_slot_unique"
  ON "TripItineraryItem"("tripId", "dayDate", "mealSlot")
  WHERE "type" = 'MEAL' AND "mealSlot" IS NOT NULL;

-- AddForeignKey
ALTER TABLE "TripItineraryItem" ADD CONSTRAINT "TripItineraryItem_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripItineraryItem" ADD CONSTRAINT "TripItineraryItem_inChargeMemberId_fkey" FOREIGN KEY ("inChargeMemberId") REFERENCES "TripMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripItineraryItem" ADD CONSTRAINT "TripItineraryItem_mealItemId_fkey" FOREIGN KEY ("mealItemId") REFERENCES "TripItineraryItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripItineraryItem" ADD CONSTRAINT "TripItineraryItem_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "TripExpense"("id") ON DELETE SET NULL ON UPDATE CASCADE;
