-- AlterTable
ALTER TABLE "Promotion" ADD COLUMN "sponsorBanks" TEXT[] DEFAULT ARRAY[]::TEXT[];
