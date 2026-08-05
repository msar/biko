-- CreateTable
CREATE TABLE "TripExpensePayment" (
    "id" TEXT NOT NULL,
    "tripExpenseId" TEXT NOT NULL,
    "tripMemberId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "TripExpensePayment_pkey" PRIMARY KEY ("id")
);

-- Backfill one payment row per existing expense (primary payer paid the full amount)
INSERT INTO "TripExpensePayment" ("id", "tripExpenseId", "tripMemberId", "amount")
SELECT
  replace(gen_random_uuid()::text, '-', ''),
  e."id",
  e."paidByMemberId",
  e."amount"
FROM "TripExpense" e;

-- CreateIndex
CREATE UNIQUE INDEX "TripExpensePayment_tripExpenseId_tripMemberId_key" ON "TripExpensePayment"("tripExpenseId", "tripMemberId");

-- CreateIndex
CREATE INDEX "TripExpensePayment_tripMemberId_idx" ON "TripExpensePayment"("tripMemberId");

-- AddForeignKey
ALTER TABLE "TripExpensePayment" ADD CONSTRAINT "TripExpensePayment_tripExpenseId_fkey" FOREIGN KEY ("tripExpenseId") REFERENCES "TripExpense"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripExpensePayment" ADD CONSTRAINT "TripExpensePayment_tripMemberId_fkey" FOREIGN KEY ("tripMemberId") REFERENCES "TripMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable: link accommodation stay cost to a real TripExpense
ALTER TABLE "TripAccommodation" ADD COLUMN "expenseId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "TripAccommodation_expenseId_key" ON "TripAccommodation"("expenseId");

-- AddForeignKey
ALTER TABLE "TripAccommodation" ADD CONSTRAINT "TripAccommodation_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "TripExpense"("id") ON DELETE SET NULL ON UPDATE CASCADE;
