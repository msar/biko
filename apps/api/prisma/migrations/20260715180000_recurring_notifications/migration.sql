-- CreateEnum
CREATE TYPE "RecurringAmountType" AS ENUM ('FIXED', 'VARIABLE');
CREATE TYPE "RecurringCadence" AS ENUM ('MONTHLY');
CREATE TYPE "RecurringOccurrenceStatus" AS ENUM ('PENDING', 'COMPLETED', 'SKIPPED');
CREATE TYPE "NotificationType" AS ENUM ('RECURRING_REMINDER', 'RECURRING_DUE', 'RECURRING_AUTO_CREATED');

-- CreateTable
CREATE TABLE "RecurringPayment" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "paymentMethodId" TEXT,
    "scope" "ExpenseScope" NOT NULL DEFAULT 'HOUSEHOLD',
    "cadence" "RecurringCadence" NOT NULL DEFAULT 'MONTHLY',
    "dueDay" INTEGER NOT NULL,
    "amountType" "RecurringAmountType" NOT NULL,
    "amount" DECIMAL(12,2),
    "reminderDaysBefore" INTEGER NOT NULL DEFAULT 3,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "nextDueDate" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecurringPayment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RecurringAmountHistory" (
    "id" TEXT NOT NULL,
    "recurringPaymentId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecurringAmountHistory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RecurringOccurrence" (
    "id" TEXT NOT NULL,
    "recurringPaymentId" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "status" "RecurringOccurrenceStatus" NOT NULL DEFAULT 'PENDING',
    "amount" DECIMAL(12,2),
    "purchaseId" TEXT,
    "reminderSentAt" TIMESTAMP(3),
    "dueNotifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecurringOccurrence_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "data" JSONB,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RecurringPayment_householdId_active_idx" ON "RecurringPayment"("householdId", "active");
CREATE INDEX "RecurringPayment_nextDueDate_idx" ON "RecurringPayment"("nextDueDate");
CREATE INDEX "RecurringAmountHistory_recurringPaymentId_effectiveFrom_idx" ON "RecurringAmountHistory"("recurringPaymentId", "effectiveFrom");
CREATE UNIQUE INDEX "RecurringOccurrence_purchaseId_key" ON "RecurringOccurrence"("purchaseId");
CREATE UNIQUE INDEX "RecurringOccurrence_recurringPaymentId_dueDate_key" ON "RecurringOccurrence"("recurringPaymentId", "dueDate");
CREATE INDEX "RecurringOccurrence_dueDate_status_idx" ON "RecurringOccurrence"("dueDate", "status");
CREATE INDEX "Notification_userId_readAt_createdAt_idx" ON "Notification"("userId", "readAt", "createdAt");
CREATE INDEX "Notification_householdId_createdAt_idx" ON "Notification"("householdId", "createdAt");
CREATE UNIQUE INDEX "PushSubscription_userId_endpoint_key" ON "PushSubscription"("userId", "endpoint");
CREATE INDEX "PushSubscription_userId_idx" ON "PushSubscription"("userId");

-- AddForeignKey
ALTER TABLE "RecurringPayment" ADD CONSTRAINT "RecurringPayment_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RecurringPayment" ADD CONSTRAINT "RecurringPayment_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RecurringPayment" ADD CONSTRAINT "RecurringPayment_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RecurringPayment" ADD CONSTRAINT "RecurringPayment_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES "PaymentMethod"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "RecurringAmountHistory" ADD CONSTRAINT "RecurringAmountHistory_recurringPaymentId_fkey" FOREIGN KEY ("recurringPaymentId") REFERENCES "RecurringPayment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RecurringAmountHistory" ADD CONSTRAINT "RecurringAmountHistory_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "RecurringOccurrence" ADD CONSTRAINT "RecurringOccurrence_recurringPaymentId_fkey" FOREIGN KEY ("recurringPaymentId") REFERENCES "RecurringPayment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RecurringOccurrence" ADD CONSTRAINT "RecurringOccurrence_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
