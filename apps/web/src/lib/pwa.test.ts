import { describe, expect, it } from 'vitest';
import {
  iosVersionAtLeast,
  isIosUserAgent,
  parseIosVersion,
  pushBlockedMessage,
  pushBlockedReason,
  shouldShowIosInstallBanner,
} from './pwa';

const IPHONE_17 =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const IPHONE_15 =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 15_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6 Mobile/15E148 Safari/604.1';
const CHROME_ANDROID =
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

describe('isIosUserAgent', () => {
  it('detects iPhone and not Android', () => {
    expect(isIosUserAgent(IPHONE_17)).toBe(true);
    expect(isIosUserAgent(CHROME_ANDROID)).toBe(false);
  });
});

describe('parseIosVersion / iosVersionAtLeast', () => {
  it('parses OS token', () => {
    expect(parseIosVersion(IPHONE_17)).toEqual({ major: 17, minor: 4 });
    expect(parseIosVersion(CHROME_ANDROID)).toBeNull();
  });

  it('checks 16.4 threshold', () => {
    expect(iosVersionAtLeast(IPHONE_17, 16, 4)).toBe(true);
    expect(iosVersionAtLeast(IPHONE_15, 16, 4)).toBe(false);
    expect(
      iosVersionAtLeast(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 16_4 like Mac OS X) AppleWebKit/605.1.15',
        16,
        4,
      ),
    ).toBe(true);
  });
});

describe('pushBlockedReason', () => {
  it('is null when push APIs exist', () => {
    expect(
      pushBlockedReason({
        ios: true,
        standalone: false,
        pushApis: true,
        iosSupportsPush: true,
      }),
    ).toBeNull();
  });

  it('asks to install when iOS Safari tab', () => {
    expect(
      pushBlockedReason({
        ios: true,
        standalone: false,
        pushApis: false,
        iosSupportsPush: true,
      }),
    ).toBe('ios-browser');
  });

  it('flags old iOS when installed without push APIs', () => {
    expect(
      pushBlockedReason({
        ios: true,
        standalone: true,
        pushApis: false,
        iosSupportsPush: false,
      }),
    ).toBe('ios-version');
  });

  it('returns unsupported for non-iOS without APIs', () => {
    expect(
      pushBlockedReason({
        ios: false,
        standalone: false,
        pushApis: false,
        iosSupportsPush: null,
      }),
    ).toBe('unsupported');
  });
});

describe('pushBlockedMessage', () => {
  it('explains iOS install requirement', () => {
    expect(pushBlockedMessage('ios-browser')).toMatch(/pantalla de inicio/i);
  });
});

describe('shouldShowIosInstallBanner', () => {
  it('shows only for iOS browser not yet dismissed', () => {
    expect(shouldShowIosInstallBanner({ ios: true, standalone: false, dismissed: false })).toBe(
      true,
    );
    expect(shouldShowIosInstallBanner({ ios: true, standalone: true, dismissed: false })).toBe(
      false,
    );
    expect(shouldShowIosInstallBanner({ ios: true, standalone: false, dismissed: true })).toBe(
      false,
    );
    expect(shouldShowIosInstallBanner({ ios: false, standalone: false, dismissed: false })).toBe(
      false,
    );
  });
});
