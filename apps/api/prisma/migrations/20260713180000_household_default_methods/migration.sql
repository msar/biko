-- Track one-time provisioning of default payment methods (Efectivo, Transferencia).
ALTER TABLE "Household" ADD COLUMN "defaultMethodsAddedAt" TIMESTAMP(3);
