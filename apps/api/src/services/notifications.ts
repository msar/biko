import type { NotificationType, Prisma, PrismaClient } from '@prisma/client';
import webpush from 'web-push';

type Db = PrismaClient | Prisma.TransactionClient;

export interface NotifyUserInput {
  userId: string;
  householdId: string;
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, unknown> | null;
}

let vapidConfigured = false;

function configureVapid(): boolean {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT ?? 'mailto:biko@localhost';
  if (!publicKey || !privateKey) return false;
  if (!vapidConfigured) {
    webpush.setVapidDetails(subject, publicKey, privateKey);
    vapidConfigured = true;
  }
  return true;
}

export function getVapidPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY ?? null;
}

/**
 * Persist an in-app notification and push to all of the user's Web Push subscriptions.
 */
export async function notifyUser(db: Db, input: NotifyUserInput) {
  const notification = await db.notification.create({
    data: {
      userId: input.userId,
      householdId: input.householdId,
      type: input.type,
      title: input.title,
      body: input.body,
      data: (input.data ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });

  if (!configureVapid()) {
    return notification;
  }

  const subscriptions = await db.pushSubscription.findMany({
    where: { userId: input.userId },
  });

  const payload = JSON.stringify({
    title: input.title,
    body: input.body,
    data: {
      ...(input.data ?? {}),
      notificationId: notification.id,
      url: (input.data?.url as string | undefined) ?? '/recurrentes',
    },
  });

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          payload,
        );
      } catch (error) {
        const statusCode = (error as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          await db.pushSubscription.delete({ where: { id: sub.id } }).catch(() => undefined);
        }
      }
    }),
  );

  return notification;
}

export async function notifyUsers(
  db: Db,
  userIds: string[],
  input: Omit<NotifyUserInput, 'userId'>,
) {
  for (const userId of userIds) {
    await notifyUser(db, { ...input, userId });
  }
}
