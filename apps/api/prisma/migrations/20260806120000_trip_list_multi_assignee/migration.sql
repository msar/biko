-- Multi-assignee list items + "Todos" (assignToAll)
ALTER TABLE "TripListItem" ADD COLUMN "assignToAll" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "TripListItemAssignee" (
    "id" TEXT NOT NULL,
    "listItemId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,

    CONSTRAINT "TripListItemAssignee_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TripListItemAssignee_listItemId_memberId_key" ON "TripListItemAssignee"("listItemId", "memberId");
CREATE INDEX "TripListItemAssignee_memberId_idx" ON "TripListItemAssignee"("memberId");

ALTER TABLE "TripListItemAssignee" ADD CONSTRAINT "TripListItemAssignee_listItemId_fkey" FOREIGN KEY ("listItemId") REFERENCES "TripListItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TripListItemAssignee" ADD CONSTRAINT "TripListItemAssignee_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "TripMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Migrate existing single assignees into the join table
INSERT INTO "TripListItemAssignee" ("id", "listItemId", "memberId")
SELECT concat('migr_', "id"), "id", "assigneeMemberId"
FROM "TripListItem"
WHERE "assigneeMemberId" IS NOT NULL;

ALTER TABLE "TripListItem" DROP CONSTRAINT "TripListItem_assigneeMemberId_fkey";
ALTER TABLE "TripListItem" DROP COLUMN "assigneeMemberId";
