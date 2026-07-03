import { createContext, useContext, useEffect, useState } from 'react';
import { api, getToken, setToken } from './api';
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
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

const USER_KEY = 'biko:user';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(() => {
    const cached = localStorage.getItem(USER_KEY);
    return cached ? (JSON.parse(cached) as SessionUser) : null;
  });
  const [loading, setLoading] = useState(Boolean(getToken() && !user));

  useEffect(() => {
    // Revalida la sesión al abrir (si hay red); offline usa el user cacheado.
    if (!getToken() || !navigator.onLine) {
      setLoading(false);
      return;
    }
    api<{ id: string; name: string; email: string; household: { id: string } }>('/auth/me')
      .then((me) => {
        const session = { id: me.id, name: me.name, email: me.email, householdId: me.household.id };
        setUser(session);
        localStorage.setItem(USER_KEY, JSON.stringify(session));
      })
      .catch(() => {
        setUser(null);
        localStorage.removeItem(USER_KEY);
      })
      .finally(() => setLoading(false));
  }, []);

  const applySession = (token: string, sessionUser: SessionUser) => {
    setToken(token);
    setUser(sessionUser);
    localStorage.setItem(USER_KEY, JSON.stringify(sessionUser));
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
    logout: () => {
      setToken(null);
      setUser(null);
      localStorage.removeItem(USER_KEY);
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth fuera de AuthProvider');
  return ctx;
}
