import { FormEvent, useEffect, useState } from 'react';
import BrandMark from '../components/BrandLogo';
import { canUsePlatformPasskey, useAuth } from '../lib/auth';

export default function LoginPage() {
  const { login, register, loginWithPasskey } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [joinMode, setJoinMode] = useState<'new' | 'join'>('new');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [passkeyAvailable, setPasskeyAvailable] = useState(false);

  useEffect(() => {
    void canUsePlatformPasskey().then(setPasskeyAvailable);
  }, []);

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const data = new FormData(e.currentTarget);
    try {
      if (mode === 'login') {
        await login(String(data.get('email')), String(data.get('password')));
      } else {
        await register({
          name: String(data.get('name')),
          email: String(data.get('email')),
          password: String(data.get('password')),
          householdName: joinMode === 'new' ? String(data.get('householdName')) : undefined,
          inviteCode: joinMode === 'join' ? String(data.get('inviteCode')) : undefined,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setBusy(false);
    }
  };

  const onPasskeyLogin = async () => {
    setError(null);
    setBusy(true);
    try {
      await loginWithPasskey();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo usar biometría');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <BrandMark size="lg" showWordmark />
        <p className="brand-sub">Gastos, cuotas y promos del hogar</p>
        {mode === 'login' && passkeyAvailable && (
          <>
            <button type="button" className="btn-primary" disabled={busy} onClick={() => void onPasskeyLogin()}>
              {busy ? '…' : 'Entrar con Face ID / biometría'}
            </button>
            <p className="hint login-divider">o con email y contraseña</p>
          </>
        )}
        <form onSubmit={onSubmit}>
          {mode === 'register' && <input name="name" placeholder="Tu nombre" required autoComplete="name" />}
          <input name="email" type="email" placeholder="Email" required autoComplete="email" />
          <input
            name="password"
            type="password"
            placeholder="Contraseña"
            required
            minLength={8}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          />
          {mode === 'register' && (
            <>
              <div className="segmented">
                <button type="button" className={joinMode === 'new' ? 'active' : ''} onClick={() => setJoinMode('new')}>
                  Crear hogar
                </button>
                <button type="button" className={joinMode === 'join' ? 'active' : ''} onClick={() => setJoinMode('join')}>
                  Unirme a uno
                </button>
              </div>
              {joinMode === 'new' ? (
                <input name="householdName" placeholder="Nombre del hogar (ej: Casa)" required />
              ) : (
                <input name="inviteCode" placeholder="Código de invitación" required />
              )}
            </>
          )}
          {error && <p className="error">{error}</p>}
          <button className="btn-primary" disabled={busy}>
            {busy ? '…' : mode === 'login' ? 'Entrar' : 'Crear cuenta'}
          </button>
        </form>
        <button className="btn-link" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
          {mode === 'login' ? '¿No tenés cuenta? Registrate' : '¿Ya tenés cuenta? Entrá'}
        </button>
      </div>
    </div>
  );
}
