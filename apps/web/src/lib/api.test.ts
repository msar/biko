import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function installMemoryStorage() {
  const store = new Map<string, string>();
  const storage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      store.set(k, String(v));
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
    clear: () => store.clear(),
    get length() {
      return store.size;
    },
    key: (i: number) => [...store.keys()][i] ?? null,
  };
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('sessionStorage', storage);
  return storage;
}

describe('api soft 401 handling', () => {
  beforeEach(() => {
    installMemoryStorage();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    vi.useRealTimers();
  });

  it('does not clear token on login 401', async () => {
    localStorage.setItem('biko:token', 'existing-token');
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ error: 'Email o contraseña incorrectos' }), { status: 401 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { api, getToken, setToken } = await import('./api');
    setToken('existing-token');

    await expect(api('/auth/login', { method: 'POST', body: '{}' })).rejects.toThrow();
    expect(getToken()).toBe('existing-token');
  });

  it('clears token when /auth/me stays 401 across confirm attempts', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: 'No autorizado' }), { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);

    const { api, getToken, setToken, onUnauthorized } = await import('./api');
    setToken('bad-token');
    const cleared = vi.fn();
    onUnauthorized(cleared);

    const pending = expect(api('/auth/me')).rejects.toThrow('No autorizado');
    await vi.runAllTimersAsync();
    await pending;
    expect(getToken()).toBeNull();
    expect(cleared).toHaveBeenCalled();
    // Initial request + confirm attempts (4 with /auth/me extra patience)
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(4);
  });

  it('keeps token and returns data when /auth/me 401 then succeeds on confirm', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const fetchMock = vi.fn(async () => {
      calls += 1;
      if (calls === 1) {
        return new Response(JSON.stringify({ error: 'No autorizado' }), { status: 401 });
      }
      return new Response(JSON.stringify({ id: 'u1' }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { api, getToken, setToken, onUnauthorized } = await import('./api');
    setToken('flaky-ok');
    const cleared = vi.fn();
    onUnauthorized(cleared);

    const pending = api<{ id: string }>('/auth/me');
    await vi.runAllTimersAsync();
    await expect(pending).resolves.toEqual({ id: 'u1' });
    expect(getToken()).toBe('flaky-ok');
    expect(cleared).not.toHaveBeenCalled();
  });

  it('revalidates /auth/me with retries before clearing on other 401s', async () => {
    vi.useFakeTimers();
    let meCalls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo) => {
      const url = String(input);
      if (url.endsWith('/expenses')) {
        return new Response(JSON.stringify({ error: 'No autorizado' }), { status: 401 });
      }
      if (url.endsWith('/auth/me')) {
        meCalls += 1;
        // Fail first confirm probe, succeed on next — must not clear.
        if (meCalls === 1) {
          return new Response(JSON.stringify({ error: 'No autorizado' }), { status: 401 });
        }
        return new Response(JSON.stringify({ id: 'u1' }), { status: 200 });
      }
      return new Response('{}', { status: 500 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { api, getToken, setToken, onUnauthorized } = await import('./api');
    setToken('maybe-ok');
    const cleared = vi.fn();
    onUnauthorized(cleared);

    let rejected: unknown;
    const pending = api('/expenses').then(
      () => {
        throw new Error('expected rejection');
      },
      (err) => {
        rejected = err;
      },
    );
    await vi.runAllTimersAsync();
    await pending;
    // After confirm succeeds, original /expenses is retried — still 401, but session kept.
    expect(rejected).toBeInstanceOf(Error);
    expect(getToken()).toBe('maybe-ok');
    expect(cleared).not.toHaveBeenCalled();
    expect(meCalls).toBeGreaterThanOrEqual(2);
  });

  it('keeps token when session confirm hits a network error', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const fetchMock = vi.fn(async () => {
      calls += 1;
      if (calls === 1) {
        return new Response(JSON.stringify({ error: 'No autorizado' }), { status: 401 });
      }
      throw new TypeError('Failed to fetch');
    });
    vi.stubGlobal('fetch', fetchMock);

    const { api, getToken, setToken, onUnauthorized } = await import('./api');
    setToken('net-blip');
    const cleared = vi.fn();
    onUnauthorized(cleared);

    let rejected: unknown;
    const pending = api('/expenses').then(
      () => {
        throw new Error('expected rejection');
      },
      (err) => {
        rejected = err;
      },
    );
    await vi.runAllTimersAsync();
    await pending;
    expect(rejected).toBeInstanceOf(Error);
    expect(getToken()).toBe('net-blip');
    expect(cleared).not.toHaveBeenCalled();
  });
});
