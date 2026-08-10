-- CreateEnum
CREATE TYPE "TripListItemActivityType" AS ENUM ('CREATED', 'UPDATED', 'MARKED_DONE', 'MARKED_PENDING', 'CHECKLIST_DONE', 'CHECKLIST_PENDING', 'CHECKLIST_ADDED');

-- CreateTable
CREATE TABLE "TripListItemActivity" (
    "id" TEXT NOT NULL,
    "listItemId" TEXT NOT NULL,
    "memberId" TEXT,
    "type" "TripListItemActivityType" NOT NULL,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TripListItemActivity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TripListItemActivity_listItemId_createdAt_idx" ON "TripListItemActivity"("listItemId", "createdAt");

-- CreateIndex
CREATE INDEX "TripListItemActivity_memberId_idx" ON "TripListItemActivity"("memberId");

-- AddForeignKey
ALTER TABLE "TripListItemActivity" ADD CONSTRAINT "TripListItemActivity_listItemId_fkey" FOREIGN KEY ("listItemId") REFERENCES "TripListItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripListItemActivity" ADD CONSTRAINT "TripListItemActivity_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "TripMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;
