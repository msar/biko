-- CreateEnum
CREATE TYPE "PaymentMethodType" AS ENUM ('DEBIT_CARD', 'CREDIT_CARD', 'WALLET', 'CASH', 'BANK_TRANSFER');

-- CreateEnum
CREATE TYPE "DayOfWeek" AS ENUM ('MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY');

-- CreateEnum
CREATE TYPE "CardNetwork" AS ENUM ('VISA', 'MASTERCARD', 'AMEX', 'CABAL', 'NONE');

-- CreateEnum
CREATE TYPE "EntityKind" AS ENUM ('BANK', 'WALLET', 'OTHER');

-- CreateEnum
CREATE TYPE "PromotionSource" AS ENUM ('MANUAL', 'SCRAPED');

-- CreateEnum
CREATE TYPE "StatementImportStatus" AS ENUM ('PENDING', 'PROCESSED', 'FAILED');

-- CreateTable
CREATE TABLE "Entity" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "EntityKind" NOT NULL,

    CONSTRAINT "Entity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentMethodDefinition" (
    "id" TEXT NOT NULL,
    "entityId" TEXT,
    "name" TEXT NOT NULL,
    "type" "PaymentMethodType" NOT NULL,
    "network" "CardNetwork" NOT NULL DEFAULT 'NONE',
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "PaymentMethodDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Household" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "inviteCode" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Household_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "authProvider" TEXT NOT NULL DEFAULT 'password',
    "externalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "householdId" TEXT,
    "name" TEXT NOT NULL,
    "icon" TEXT,
    "color" TEXT,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentMethod" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "definitionId" TEXT NOT NULL,
    "ownerUserId" TEXT,
    "nickname" TEXT,
    "lastFour" TEXT,
    "closingDay" INTEGER,
    "dueDay" INTEGER,

    CONSTRAINT "PaymentMethod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Promotion" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "store" TEXT,
    "paymentMethodType" "PaymentMethodType",
    "cardNetwork" "CardNetwork",
    "dayOfWeek" "DayOfWeek",
    "discountPercentage" DECIMAL(5,2) NOT NULL,
    "discountCap" DECIMAL(12,2),
    "minPurchaseAmount" DECIMAL(12,2),
    "validFrom" TIMESTAMP(3),
    "validTo" TIMESTAMP(3),
    "source" "PromotionSource" NOT NULL DEFAULT 'MANUAL',
    "sourceUrl" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Promotion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Purchase" (
    "id" TEXT NOT NULL,
    "clientId" TEXT,
    "householdId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "paymentMethodId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "store" TEXT NOT NULL,
    "description" TEXT,
    "purchaseDate" TIMESTAMP(3) NOT NULL,
    "grossAmount" DECIMAL(12,2) NOT NULL,
    "promotionId" TEXT,
    "discountPercentageApplied" DECIMAL(5,2),
    "discountCapApplied" DECIMAL(12,2),
    "discountAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "netAmount" DECIMAL(12,2) NOT NULL,
    "installmentsCount" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Purchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Installment" (
    "id" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "paid" BOOLEAN NOT NULL DEFAULT false,
    "paidDate" TIMESTAMP(3),

    CONSTRAINT "Installment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonthlyCapUsage" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "yearMonth" TEXT NOT NULL,
    "usedAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,

    CONSTRAINT "MonthlyCapUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StatementImport" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "bankSource" TEXT NOT NULL,
    "status" "StatementImportStatus" NOT NULL DEFAULT 'PENDING',
    "processedCount" INTEGER NOT NULL DEFAULT 0,
    "errorLog" TEXT,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StatementImport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Entity_name_key" ON "Entity"("name");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentMethodDefinition_entityId_type_network_key" ON "PaymentMethodDefinition"("entityId", "type", "network");

-- CreateIndex
CREATE UNIQUE INDEX "Household_inviteCode_key" ON "Household"("inviteCode");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_externalId_key" ON "User"("externalId");

-- CreateIndex
CREATE UNIQUE INDEX "Category_householdId_name_key" ON "Category"("householdId", "name");

-- CreateIndex
CREATE INDEX "PaymentMethod_householdId_idx" ON "PaymentMethod"("householdId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentMethod_householdId_definitionId_lastFour_key" ON "PaymentMethod"("householdId", "definitionId", "lastFour");

-- CreateIndex
CREATE INDEX "Promotion_entityId_dayOfWeek_active_idx" ON "Promotion"("entityId", "dayOfWeek", "active");

-- CreateIndex
CREATE UNIQUE INDEX "Purchase_clientId_key" ON "Purchase"("clientId");

-- CreateIndex
CREATE INDEX "Purchase_householdId_purchaseDate_idx" ON "Purchase"("householdId", "purchaseDate");

-- CreateIndex
CREATE INDEX "Purchase_categoryId_idx" ON "Purchase"("categoryId");

-- CreateIndex
CREATE INDEX "Installment_householdId_dueDate_idx" ON "Installment"("householdId", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "Installment_purchaseId_number_key" ON "Installment"("purchaseId", "number");

-- CreateIndex
CREATE INDEX "MonthlyCapUsage_householdId_yearMonth_idx" ON "MonthlyCapUsage"("householdId", "yearMonth");

-- CreateIndex
CREATE UNIQUE INDEX "MonthlyCapUsage_householdId_entityId_yearMonth_key" ON "MonthlyCapUsage"("householdId", "entityId", "yearMonth");

-- CreateIndex
CREATE INDEX "StatementImport_householdId_idx" ON "StatementImport"("householdId");

-- AddForeignKey
ALTER TABLE "PaymentMethodDefinition" ADD CONSTRAINT "PaymentMethodDefinition_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentMethod" ADD CONSTRAINT "PaymentMethod_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentMethod" ADD CONSTRAINT "PaymentMethod_definitionId_fkey" FOREIGN KEY ("definitionId") REFERENCES "PaymentMethodDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentMethod" ADD CONSTRAINT "PaymentMethod_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Promotion" ADD CONSTRAINT "Promotion_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES "PaymentMethod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "Promotion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Installment" ADD CONSTRAINT "Installment_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonthlyCapUsage" ADD CONSTRAINT "MonthlyCapUsage_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonthlyCapUsage" ADD CONSTRAINT "MonthlyCapUsage_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatementImport" ADD CONSTRAINT "StatementImport_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
