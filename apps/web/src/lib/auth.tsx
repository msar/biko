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
import { ApiError, api, getToken, onUnauthorized, setToken } from './api';
import {
  clearAuthStorage,
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

  useEffect(() => {
    const token = getToken();
    if (!token) {
      writeCachedAuthUser(null);
      setUser(null);
      setLoading(false);
      return;
    }

    // Offline: usar usuario cacheado sin revalidar (PWA).
    if (!navigator.onLine) {
      setUser(readCachedUser());
      setLoading(false);
      return;
    }

    api<{ id: string; name: string; email: string; isSuperUser: boolean; household: { id: string } }>('/auth/me')
      .then((me) => {
        const session = {
          id: me.id,
          name: me.name,
          email: me.email,
          householdId: me.household.id,
          isSuperUser: me.isSuperUser ?? isSuperUser(me.email),
        };
        setUser(session);
        writeCachedAuthUser(session);
      })
      .catch((err) => {
        // Solo cerrar sesión si el token es inválido/expiró (401). Ante errores
        // transitorios (offline, timeout, 5xx) mantener la sesión cacheada.
        // api() already retries /auth/me once before clearing on 401.
        if (err instanceof ApiError && err.status === 401) {
          clearSession(setUser);
        } else {
          setUser(readCachedUser());
        }
      })
      .finally(() => setLoading(false));
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
