import type { PrismaClient } from '@prisma/client';
import { generateDueOccurrences, sendRecurringReminders } from '../services/recurring.js';

export async function runRecurringDailyJob(prisma: PrismaClient, asOf = new Date()) {
  const generated = await generateDueOccurrences(prisma, asOf, 14);
  const notified = await sendRecurringReminders(prisma, asOf);
  return { ...generated, ...notified, ranAt: asOf.toISOString() };
}
