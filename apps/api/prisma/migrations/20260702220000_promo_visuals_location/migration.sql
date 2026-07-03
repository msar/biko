-- CreateEnum
CREATE TYPE "DiscountKind" AS ENUM ('PERCENTAGE_REFUND', 'INSTALLMENTS', 'FIXED_AMOUNT', 'OTHER');

-- AlterTable
ALTER TABLE "Household" ADD COLUMN "province" TEXT;

-- AlterTable
ALTER TABLE "Promotion" ADD COLUMN "discountKind" "DiscountKind" NOT NULL DEFAULT 'PERCENTAGE_REFUND';
ALTER TABLE "Promotion" ADD COLUMN "discountLabel" TEXT;
ALTER TABLE "Promotion" ADD COLUMN "imageUrl" TEXT;
ALTER TABLE "Promotion" ADD COLUMN "details" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Promotion" ADD COLUMN "provinces" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Promotion" ADD COLUMN "storesAdherents" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Promotion" ADD COLUMN "paymentFlow" TEXT;
