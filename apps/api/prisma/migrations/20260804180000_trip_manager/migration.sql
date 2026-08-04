-- CreateEnum
CREATE TYPE "TripStatus" AS ENUM ('PLANNING', 'ACTIVE', 'CLOSED');

-- CreateEnum
CREATE TYPE "TripMemberRole" AS ENUM ('ORGANIZER', 'MEMBER');

-- CreateEnum
CREATE TYPE "TripMemberInviteStatus" AS ENUM ('PENDING', 'JOINED', 'DECLINED');

-- CreateEnum
CREATE TYPE "TripListItemType" AS ENUM ('TODO', 'PACK', 'BUY');

-- CreateEnum
CREATE TYPE "TripListItemStatus" AS ENUM ('PENDING', 'DONE');

-- CreateEnum
CREATE TYPE "TripExpenseCategory" AS ENUM ('ALOJAMIENTO', 'VUELOS', 'TRANSPORTE', 'COMIDA', 'RESTAURANTES', 'ACTIVIDADES', 'OTROS');

-- CreateTable
CREATE TABLE "Trip" (
    "id" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "destination" TEXT,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "status" "TripStatus" NOT NULL DEFAULT 'PLANNING',
    "baseCurrency" TEXT NOT NULL DEFAULT 'ARS',
    "exportHouseholdId" TEXT,
    "exportBatchId" TEXT,
    "exportedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Trip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TripMember" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "userId" TEXT,
    "displayName" TEXT NOT NULL,
    "role" "TripMemberRole" NOT NULL DEFAULT 'MEMBER',
    "inviteStatus" "TripMemberInviteStatus" NOT NULL DEFAULT 'JOINED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TripMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TripInvite" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TripInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TripExpense" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "paidByMemberId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "category" "TripExpenseCategory" NOT NULL,
    "note" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'ARS',
    "splitMode" "SplitMode" NOT NULL DEFAULT 'EQUAL',
    "exportedPurchaseId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TripExpense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TripExpenseAllocation" (
    "id" TEXT NOT NULL,
    "tripExpenseId" TEXT NOT NULL,
    "tripMemberId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "TripExpenseAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TripSettlement" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "fromMemberId" TEXT NOT NULL,
    "toMemberId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "note" TEXT,
    "settledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TripSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TripListItem" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "type" "TripListItemType" NOT NULL,
    "title" TEXT NOT NULL,
    "notes" TEXT,
    "quantity" INTEGER,
    "assigneeMemberId" TEXT,
    "status" "TripListItemStatus" NOT NULL DEFAULT 'PENDING',
    "dayDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TripListItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TripAccommodation" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "label" TEXT,
    "address" TEXT,
    "checkIn" TIMESTAMP(3),
    "checkOut" TIMESTAMP(3),
    "link" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TripAccommodation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TripExportBatch" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "exportedByUserId" TEXT NOT NULL,
    "purchaseIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TripExportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Trip_createdByUserId_status_idx" ON "Trip"("createdByUserId", "status");

-- CreateIndex
CREATE INDEX "Trip_status_updatedAt_idx" ON "Trip"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "TripMember_tripId_inviteStatus_idx" ON "TripMember"("tripId", "inviteStatus");

-- CreateIndex
CREATE INDEX "TripMember_userId_idx" ON "TripMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "TripMember_tripId_userId_key" ON "TripMember"("tripId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "TripInvite_code_key" ON "TripInvite"("code");

-- CreateIndex
CREATE INDEX "TripInvite_tripId_idx" ON "TripInvite"("tripId");

-- CreateIndex
CREATE INDEX "TripExpense_tripId_date_idx" ON "TripExpense"("tripId", "date");

-- CreateIndex
CREATE INDEX "TripExpense_paidByMemberId_idx" ON "TripExpense"("paidByMemberId");

-- CreateIndex
CREATE INDEX "TripExpenseAllocation_tripMemberId_idx" ON "TripExpenseAllocation"("tripMemberId");

-- CreateIndex
CREATE UNIQUE INDEX "TripExpenseAllocation_tripExpenseId_tripMemberId_key" ON "TripExpenseAllocation"("tripExpenseId", "tripMemberId");

-- CreateIndex
CREATE INDEX "TripSettlement_tripId_settledAt_idx" ON "TripSettlement"("tripId", "settledAt");

-- CreateIndex
CREATE INDEX "TripListItem_tripId_type_status_idx" ON "TripListItem"("tripId", "type", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TripAccommodation_tripId_key" ON "TripAccommodation"("tripId");

-- CreateIndex
CREATE INDEX "TripExportBatch_householdId_idx" ON "TripExportBatch"("householdId");

-- CreateIndex
CREATE UNIQUE INDEX "TripExportBatch_tripId_householdId_key" ON "TripExportBatch"("tripId", "householdId");

-- AddForeignKey
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripMember" ADD CONSTRAINT "TripMember_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripMember" ADD CONSTRAINT "TripMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripInvite" ADD CONSTRAINT "TripInvite_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripInvite" ADD CONSTRAINT "TripInvite_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripExpense" ADD CONSTRAINT "TripExpense_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripExpense" ADD CONSTRAINT "TripExpense_paidByMemberId_fkey" FOREIGN KEY ("paidByMemberId") REFERENCES "TripMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripExpenseAllocation" ADD CONSTRAINT "TripExpenseAllocation_tripExpenseId_fkey" FOREIGN KEY ("tripExpenseId") REFERENCES "TripExpense"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripExpenseAllocation" ADD CONSTRAINT "TripExpenseAllocation_tripMemberId_fkey" FOREIGN KEY ("tripMemberId") REFERENCES "TripMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripSettlement" ADD CONSTRAINT "TripSettlement_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripSettlement" ADD CONSTRAINT "TripSettlement_fromMemberId_fkey" FOREIGN KEY ("fromMemberId") REFERENCES "TripMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripSettlement" ADD CONSTRAINT "TripSettlement_toMemberId_fkey" FOREIGN KEY ("toMemberId") REFERENCES "TripMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripListItem" ADD CONSTRAINT "TripListItem_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripListItem" ADD CONSTRAINT "TripListItem_assigneeMemberId_fkey" FOREIGN KEY ("assigneeMemberId") REFERENCES "TripMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripAccommodation" ADD CONSTRAINT "TripAccommodation_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripExportBatch" ADD CONSTRAINT "TripExportBatch_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripExportBatch" ADD CONSTRAINT "TripExportBatch_exportedByUserId_fkey" FOREIGN KEY ("exportedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
