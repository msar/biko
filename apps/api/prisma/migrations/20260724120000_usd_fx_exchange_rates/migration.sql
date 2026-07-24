-- AlterTable
ALTER TABLE "Purchase" ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'ARS';
ALTER TABLE "Purchase" ADD COLUMN "exchangeRateToArs" DECIMAL(12,6) NOT NULL DEFAULT 1;
ALTER TABLE "Purchase" ADD COLUMN "exchangeRateSource" TEXT;
ALTER TABLE "Purchase" ADD COLUMN "exchangeRateDate" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "RecurringPayment" ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'ARS';
ALTER TABLE "RecurringPayment" ADD COLUMN "exchangeRateToArs" DECIMAL(12,6);

-- CreateTable
CREATE TABLE "ExchangeRate" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "fromCurrency" TEXT NOT NULL,
    "toCurrency" TEXT NOT NULL,
    "rate" DECIMAL(12,6) NOT NULL,
    "source" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExchangeRate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExchangeRate_fromCurrency_toCurrency_date_idx" ON "ExchangeRate"("fromCurrency", "toCurrency", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ExchangeRate_date_fromCurrency_toCurrency_source_key" ON "ExchangeRate"("date", "fromCurrency", "toCurrency", "source");
