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
  return storage;
}

describe('api soft 401 handling', () => {
  beforeEach(() => {
    installMemoryStorage();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
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

  it('clears token when /auth/me returns 401 twice (after retry)', async () => {
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
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('keeps token when /auth/me 401 then succeeds on retry', async () => {
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
    vi.useRealTimers();
  });

  it('revalidates /auth/me before clearing on other 401s', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo) => {
      const url = String(input);
      if (url.endsWith('/expenses')) {
        return new Response(JSON.stringify({ error: 'No autorizado' }), { status: 401 });
      }
      if (url.endsWith('/auth/me')) {
        return new Response(JSON.stringify({ id: 'u1' }), { status: 200 });
      }
      return new Response('{}', { status: 500 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { api, getToken, setToken, onUnauthorized } = await import('./api');
    setToken('maybe-ok');
    const cleared = vi.fn();
    onUnauthorized(cleared);

    await expect(api('/expenses')).rejects.toThrow();
    expect(getToken()).toBe('maybe-ok');
    expect(cleared).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith('/auth/me'))).toBe(true);
  });
});
