import { createContext, useContext, useEffect, useState } from 'react';
import { isSuperUser } from '@biko/shared';
import {
  browserSupportsWebAuthn,
  platformAuthenticatorIsAvailable,
  startAuthentication,
  startRegistration,
} from '@simplewebauthn/browser';
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/browser';
import { api, getToken, onUnauthorized, setToken } from './api';
import {
  AUTH_TOKEN_KEY,
  clearAuthStorage,
  readAuthToken,
  readCachedAuthUser,
  writeCachedAuthUser,
} from './auth-storage';
import type { SessionUser } from './types';

interface AuthState {
  user: SessionUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (params: {
    name: string;
    email: string;
    password: string;
    householdName?: string;
    inviteCode?: string;
  }) => Promise<void>;
  loginWithPasskey: () => Promise<void>;
  registerPasskey: (deviceName?: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

function readCachedUser(): SessionUser | null {
  return readCachedAuthUser<SessionUser>();
}

function clearSession(setUser: (u: SessionUser | null) => void) {
  setToken(null);
  setUser(null);
  clearAuthStorage();
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    onUnauthorized(() => clearSession(setUser));
  }, []);

  // Cross-tab: another tab logged out (or in) — mirror without a full reload.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== AUTH_TOKEN_KEY) return;
      if (!e.newValue) {
        setUser(null);
        writeCachedAuthUser(null);
        return;
      }
      // Token replaced in another tab — adopt cached user or wait for next /auth/me.
      const cached = readCachedUser();
      if (cached) setUser(cached);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      const token = getToken() ?? readAuthToken();
      if (!token) {
        writeCachedAuthUser(null);
        if (!cancelled) {
          setUser(null);
          setLoading(false);
        }
        return;
      }

      // Offline: usar usuario cacheado sin revalidar (PWA).
      if (!navigator.onLine) {
        if (!cancelled) {
          setUser(readCachedUser());
          setLoading(false);
        }
        return;
      }

      try {
        const me = await api<{
          id: string;
          name: string;
          email: string;
          isSuperUser: boolean;
          household: { id: string };
        }>('/auth/me');
        if (cancelled) return;
        const session = {
          id: me.id,
          name: me.name,
          email: me.email,
          householdId: me.household.id,
          isSuperUser: me.isSuperUser ?? isSuperUser(me.email),
        };
        setUser(session);
        writeCachedAuthUser(session);
      } catch {
        if (cancelled) return;
        // api() only clears the token after confirmed /auth/me 401s.
        if (!readAuthToken()) {
          setUser(null);
        } else {
          setUser(readCachedUser());
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  const applySession = (token: string, sessionUser: SessionUser) => {
    setToken(token);
    setUser(sessionUser);
    writeCachedAuthUser(sessionUser);
  };

  const value: AuthState = {
    user,
    loading,
    login: async (email, password) => {
      const res = await api<{ token: string; user: SessionUser }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      applySession(res.token, res.user);
    },
    register: async (params) => {
      const res = await api<{ token: string; user: SessionUser }>('/auth/register', {
        method: 'POST',
        body: JSON.stringify(params),
      });
      applySession(res.token, res.user);
    },
    loginWithPasskey: async () => {
      const options = await api<PublicKeyCredentialRequestOptionsJSON>('/auth/webauthn/login/options', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      const assertion = await startAuthentication({ optionsJSON: options });
      const res = await api<{ token: string; user: SessionUser }>('/auth/webauthn/login/verify', {
        method: 'POST',
        body: JSON.stringify({ response: assertion }),
      });
      applySession(res.token, res.user);
    },
    registerPasskey: async (deviceName) => {
      const options = await api<PublicKeyCredentialCreationOptionsJSON>('/auth/webauthn/register/options', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      const attestation = await startRegistration({ optionsJSON: options });
      await api('/auth/webauthn/register/verify', {
        method: 'POST',
        body: JSON.stringify({
          response: attestation as RegistrationResponseJSON,
          deviceName,
        }),
      });
    },
    logout: () => clearSession(setUser),
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth fuera de AuthProvider');
  return ctx;
}

export async function canUsePlatformPasskey(): Promise<boolean> {
  if (!browserSupportsWebAuthn()) return false;
  try {
    return await platformAuthenticatorIsAvailable();
  } catch {
    return false;
  }
}
