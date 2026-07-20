-- CreateEnum
CREATE TYPE "StatementImportLineStatus" AS ENUM ('PENDING', 'NEW', 'MERGED', 'SKIPPED');
CREATE TYPE "StatementAmountResolution" AS ENUM ('KEEP_EXISTING', 'USE_STATEMENT');

-- AlterTable StatementImport
ALTER TABLE "StatementImport" ADD COLUMN IF NOT EXISTS "userId" TEXT;
ALTER TABLE "StatementImport" ADD COLUMN IF NOT EXISTS "paymentMethodId" TEXT;
ALTER TABLE "StatementImport" ADD COLUMN IF NOT EXISTS "committedAt" TIMESTAMP(3);

-- Backfill required userId for any existing rows (should be none in practice)
UPDATE "StatementImport" si
SET "userId" = u.id
FROM "User" u
WHERE si."userId" IS NULL AND u."householdId" = si."householdId";

DELETE FROM "StatementImport" WHERE "userId" IS NULL;

ALTER TABLE "StatementImport" ALTER COLUMN "userId" SET NOT NULL;

-- AlterTable Purchase
ALTER TABLE "Purchase" ADD COLUMN IF NOT EXISTS "statementFingerprint" TEXT;

CREATE INDEX IF NOT EXISTS "Purchase_householdId_statementFingerprint_idx"
  ON "Purchase"("householdId", "statementFingerprint");

-- CreateTable
CREATE TABLE "StatementImportLine" (
    "id" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "lineDate" TIMESTAMP(3) NOT NULL,
    "store" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'ARS',
    "installmentCurrent" INTEGER,
    "installmentTotal" INTEGER,
    "rawText" TEXT NOT NULL,
    "suggestedSkip" BOOLEAN NOT NULL DEFAULT false,
    "status" "StatementImportLineStatus" NOT NULL DEFAULT 'PENDING',
    "matchedPurchaseId" TEXT,
    "amountResolution" "StatementAmountResolution",
    "categoryId" TEXT,
    "scope" "ExpenseScope",
    "splitMode" "SplitMode",
    "createdPurchaseId" TEXT,

    CONSTRAINT "StatementImportLine_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StatementImportLine_householdId_fingerprint_key"
  ON "StatementImportLine"("householdId", "fingerprint");
CREATE INDEX "StatementImportLine_importId_idx" ON "StatementImportLine"("importId");
CREATE INDEX "StatementImportLine_householdId_status_idx"
  ON "StatementImportLine"("householdId", "status");

ALTER TABLE "StatementImport" ADD CONSTRAINT "StatementImport_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StatementImport" ADD CONSTRAINT "StatementImport_paymentMethodId_fkey"
  FOREIGN KEY ("paymentMethodId") REFERENCES "PaymentMethod"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "StatementImportLine" ADD CONSTRAINT "StatementImportLine_importId_fkey"
  FOREIGN KEY ("importId") REFERENCES "StatementImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StatementImportLine" ADD CONSTRAINT "StatementImportLine_matchedPurchaseId_fkey"
  FOREIGN KEY ("matchedPurchaseId") REFERENCES "Purchase"("id") ON DELETE SET NULL ON UPDATE CASCADE;
