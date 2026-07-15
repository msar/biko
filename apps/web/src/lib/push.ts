/** Web Push helpers for the Biko PWA. */

function urlBase64ToUint8Array(base64String: string): BufferSource {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

export async function getPushPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (!pushSupported()) return 'unsupported';
  return Notification.permission;
}

export async function subscribeToPush(
  getPublicKey: () => Promise<string>,
  saveSubscription: (body: {
    endpoint: string;
    keys: { p256dh: string; auth: string };
    userAgent?: string;
  }) => Promise<unknown>,
): Promise<'granted' | 'denied' | 'unsupported'> {
  if (!pushSupported()) return 'unsupported';
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return 'denied';

  const reg = await navigator.serviceWorker.ready;
  const publicKey = await getPublicKey();
  const existing = await reg.pushManager.getSubscription();
  const subscription =
    existing ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    }));

  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    throw new Error('Suscripción push inválida');
  }
  await saveSubscription({
    endpoint: json.endpoint,
    keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
    userAgent: navigator.userAgent.slice(0, 300),
  });
  return 'granted';
}

export async function unsubscribeFromPush(
  removeSubscription: (body: { endpoint: string }) => Promise<unknown>,
): Promise<void> {
  if (!pushSupported()) return;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  await removeSubscription({ endpoint: sub.endpoint });
  await sub.unsubscribe();
}
