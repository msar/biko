-- AlterTable
ALTER TABLE "Household" ADD COLUMN "bankPrograms" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "Promotion" ADD COLUMN "audienceSegments" TEXT[] DEFAULT ARRAY[]::TEXT[];
