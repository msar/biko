/** PWA install + iOS capability helpers (pure where possible for tests). */

export type PushBlockedReason = 'ios-browser' | 'ios-version' | 'unsupported';

export function isIosUserAgent(ua: string): boolean {
  return /iPhone|iPad|iPod/i.test(ua);
}

/** iPadOS 13+ may report as Macintosh with touch. */
export function isIosDevice(ua: string = typeof navigator !== 'undefined' ? navigator.userAgent : '', maxTouchPoints = typeof navigator !== 'undefined' ? navigator.maxTouchPoints : 0): boolean {
  if (isIosUserAgent(ua)) return true;
  return /Macintosh/i.test(ua) && maxTouchPoints > 1;
}

/**
 * Parse iOS version from UA (`CPU iPhone OS 16_4 like Mac OS X`).
 * Returns null if not iOS / unparseable.
 */
export function parseIosVersion(ua: string): { major: number; minor: number } | null {
  const match = ua.match(/OS (\d+)[_.](\d+)/i);
  if (!match || !isIosUserAgent(ua)) return null;
  return { major: Number(match[1]), minor: Number(match[2]) };
}

export function iosVersionAtLeast(ua: string, major: number, minor: number): boolean | null {
  const version = parseIosVersion(ua);
  if (!version) return null;
  if (version.major > major) return true;
  if (version.major < major) return false;
  return version.minor >= minor;
}

export function isStandaloneDisplay(opts?: {
  matchMediaStandalone?: boolean;
  navigatorStandalone?: boolean;
}): boolean {
  if (opts) {
    return Boolean(opts.matchMediaStandalone || opts.navigatorStandalone);
  }
  if (typeof window === 'undefined') return false;
  const mediaStandalone =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(display-mode: standalone)').matches;
  const navStandalone = Boolean(
    (window.navigator as Navigator & { standalone?: boolean }).standalone,
  );
  return mediaStandalone || navStandalone;
}

export function pushApisAvailable(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/**
 * Why Web Push cannot be enabled on this client.
 * `null` means APIs are available (permission may still be denied).
 */
export function pushBlockedReason(input?: {
  ios?: boolean;
  standalone?: boolean;
  pushApis?: boolean;
  iosSupportsPush?: boolean | null;
}): PushBlockedReason | null {
  const ios = input?.ios ?? isIosDevice();
  const standalone = input?.standalone ?? isStandaloneDisplay();
  const pushApis = input?.pushApis ?? pushApisAvailable();
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const iosSupportsPush =
    input?.iosSupportsPush ?? (ios ? iosVersionAtLeast(ua, 16, 4) : null);

  if (pushApis) return null;
  if (ios && !standalone) return 'ios-browser';
  if (ios && standalone && iosSupportsPush === false) return 'ios-version';
  if (ios && standalone) return 'ios-version';
  return 'unsupported';
}

export function pushBlockedMessage(reason: PushBlockedReason | null): string | null {
  switch (reason) {
    case 'ios-browser':
      return 'En iPhone, las alertas push solo funcionan si instalás Biko en la pantalla de inicio y la abrís desde ahí (iOS 16.4 o superior).';
    case 'ios-version':
      return 'Este iPhone necesita iOS 16.4 o superior para recibir alertas push. Actualizá el sistema o usá la bandeja de notificaciones dentro de la app.';
    case 'unsupported':
      return 'Las alertas push no están disponibles en este navegador. Podés seguir viendo avisos en la campanita de la app.';
    default:
      return null;
  }
}

const DISMISS_KEY = 'biko:install-banner-dismissed';

export function isInstallBannerDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

export function dismissInstallBanner(): void {
  try {
    localStorage.setItem(DISMISS_KEY, '1');
  } catch {
    // ignore quota / private mode
  }
}

export function shouldShowIosInstallBanner(input?: {
  ios?: boolean;
  standalone?: boolean;
  dismissed?: boolean;
}): boolean {
  const ios = input?.ios ?? isIosDevice();
  const standalone = input?.standalone ?? isStandaloneDisplay();
  const dismissed = input?.dismissed ?? isInstallBannerDismissed();
  return ios && !standalone && !dismissed;
}
