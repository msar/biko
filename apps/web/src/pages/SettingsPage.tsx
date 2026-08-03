import { ARGENTINE_PROVINCES, BANK_PROGRAMS, BANK_PROGRAM_LABEL, type BankProgram } from '@biko/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { AddPaymentMethodsWizard, EditPaymentMethodForm } from '../components/PaymentMethodForm';
import InstallAppSection from '../components/InstallAppSection';
import { IosInstallSteps } from '../components/IosInstallSteps';
import { api } from '../lib/api';
import { canUsePlatformPasskey, useAuth } from '../lib/auth';
import {
  getPushPermission,
  getPushBlockedReason,
  hasPushSubscription,
  pushSupported,
  subscribeToPush,
  unsubscribeFromPush,
} from '../lib/push';
import { isStandaloneDisplay, pushBlockedMessage } from '../lib/pwa';
import {
  groupMethodsByEntity,
  methodSubtitle,
  paymentMethodDisplayName,
} from '../lib/payment-method-catalog';
import type { HouseholdMember, PaymentMethod, PaymentMethodDefinition } from '../lib/types';

type PasskeyRow = { id: string; deviceName: string | null; createdAt: string };

function PasskeySettingsSection() {
  const { registerPasskey } = useAuth();
  const [available, setAvailable] = useState(false);
  const [credentials, setCredentials] = useState<PasskeyRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const refresh = async () => {
    const res = await api<{ credentials: PasskeyRow[] }>('/auth/webauthn/credentials');
    setCredentials(res.credentials);
  };

  useEffect(() => {
    void canUsePlatformPasskey().then(setAvailable);
    void refresh().catch(() => setCredentials([]));
  }, []);

  const onRegister = async () => {
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      await registerPasskey('Este dispositivo');
      setInfo('Listo. La próxima vez podés entrar con Face ID / biometría.');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo registrar la passkey');
    } finally {
      setBusy(false);
    }
  };

  const onRemove = async (id: string) => {
    if (!confirm('¿Eliminar esta passkey?')) return;
    setError(null);
    try {
      await api(`/auth/webauthn/credentials/${id}`, { method: 'DELETE' });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo eliminar');
    }
  };

  if (!available && credentials.length === 0) return null;

  return (
    <section className="card">
      <h2>Face ID / biometría</h2>
      <p className="hint">
        Entrá sin contraseña con Face ID (iPhone) o huella/rostro (Android). Funciona en la app instalada y en el
        navegador compatible.
      </p>
      {error && <p className="error">{error}</p>}
      {info && <p className="hint">{info}</p>}
      {credentials.length > 0 && (
        <ul className="method-list" style={{ listStyle: 'none', padding: 0 }}>
          {credentials.map((c) => (
            <li key={c.id} className="list-row" style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <span>{c.deviceName ?? 'Passkey'}</span>
              <button type="button" className="btn-link" onClick={() => void onRemove(c.id)}>
                Eliminar
              </button>
            </li>
          ))}
        </ul>
      )}
      {available && (
        <button type="button" className="btn-secondary" disabled={busy} onClick={() => void onRegister()}>
          {busy ? '…' : credentials.length ? 'Agregar otra passkey' : 'Activar Face ID / biometría'}
        </button>
      )}
    </section>
  );
}

export default function SettingsPage() {
  const { user, logout } = useAuth();
  const queryClient = useQueryClient();
  const [panel, setPanel] = useState<'none' | 'add' | 'edit'>('none');
  const [editId, setEditId] = useState<string | null>(null);
  const [pushStatus, setPushStatus] = useState<string>('…');
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);
  const pushBlockReason = getPushBlockedReason();
  const pushBlockHint = pushBlockedMessage(pushBlockReason);
  const standalone = isStandaloneDisplay();

  useEffect(() => {
    void (async () => {
      const permission = await getPushPermission();
      if (permission === 'unsupported') {
        setPushEnabled(false);
        setPushStatus(pushBlockHint ?? 'No disponible en este dispositivo');
        return;
      }
      if (permission === 'denied') {
        setPushEnabled(false);
        setPushStatus('Bloqueadas por el navegador');
        return;
      }
      const subscribed = await hasPushSubscription();
      setPushEnabled(subscribed);
      setPushStatus(subscribed ? 'Activadas' : 'Desactivadas');
    })();
  }, [pushBlockHint]);

  const { data: methods } = useQuery({
    queryKey: ['payment-methods'],
    queryFn: () => api<PaymentMethod[]>('/payment-methods'),
  });
  const { data: definitions } = useQuery({
    queryKey: ['catalog', 'definitions'],
    queryFn: () => api<PaymentMethodDefinition[]>('/catalog/payment-method-definitions'),
  });
  const { data: me } = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: () =>
      api<{
        household: {
          name: string;
          inviteCode: string;
          province: string | null;
          bankPrograms: string[];
          members: HouseholdMember[];
        };
      }>('/auth/me'),
  });

  const members = me?.household.members ?? [];

  const provinceMutation = useMutation({
    mutationFn: (province: string | null) =>
      api('/household', { method: 'PATCH', body: JSON.stringify({ province }) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['auth', 'me'] });
      void queryClient.invalidateQueries({ queryKey: ['promotions'] });
      void queryClient.invalidateQueries({ queryKey: ['me'] });
    },
  });

  const bankProgramsMutation = useMutation({
    mutationFn: (bankPrograms: BankProgram[]) =>
      api('/household', { method: 'PATCH', body: JSON.stringify({ bankPrograms }) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['auth', 'me'] });
      void queryClient.invalidateQueries({ queryKey: ['promotions'] });
      void queryClient.invalidateQueries({ queryKey: ['me'] });
    },
  });

  const toggleBankProgram = (program: BankProgram) => {
    const current = new Set(me?.household.bankPrograms ?? []);
    if (current.has(program)) current.delete(program);
    else current.add(program);
    bankProgramsMutation.mutate([...current] as BankProgram[]);
  };

  const closePanel = () => {
    setPanel('none');
    setEditId(null);
  };

  const assignOwner = async (methodId: string, ownerUserId: string | null) => {
    try {
      await api(`/payment-methods/${methodId}`, {
        method: 'PUT',
        body: JSON.stringify({ ownerUserId }),
      });
      void queryClient.invalidateQueries({ queryKey: ['payment-methods'] });
    } catch (err) {
      alert(err instanceof Error ? err.message : 'No se pudo asignar el dueño');
    }
  };

  const removeMethod = async (id: string) => {
    if (!confirm('¿Eliminar este medio de pago?')) return;
    try {
      await api(`/payment-methods/${id}`, { method: 'DELETE' });
      void queryClient.invalidateQueries({ queryKey: ['payment-methods'] });
      if (editId === id) closePanel();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'No se pudo eliminar');
    }
  };

  const editMethod = methods?.find((m) => m.id === editId);
  const grouped = methods ? groupMethodsByEntity(methods) : [];

  return (
    <div className="page">
      <header className="page-header">
        <h1>Ajustes</h1>
      </header>

      <section className="card">
        <h2>Hogar</h2>
        <p>
          <strong>{me?.household.name}</strong>
        </p>
        {me && (
          <p className="hint">
            Código de invitación para tu pareja: <code>{me.household.inviteCode}</code>
          </p>
        )}
        <label>
          Provincia (para filtrar promos)
          <select
            value={me?.household.province ?? ''}
            onChange={(e) => provinceMutation.mutate(e.target.value || null)}
            disabled={provinceMutation.isPending}
          >
            <option value="">Sin provincia (se muestran promos nacionales y sin zona)</option>
            {ARGENTINE_PROVINCES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="filter-block" style={{ marginTop: '1rem', border: 0, padding: 0 }}>
          <legend className="field-label">Programas / suscripciones</legend>
          <p className="hint">Activá los que tengas para ver promos exclusivas (Select, Sorpresa, Eminent).</p>
          <div className="method-list">
            {BANK_PROGRAMS.map((program) => {
              const selected = (me?.household.bankPrograms ?? []).includes(program);
              return (
                <button
                  key={program}
                  type="button"
                  className={`method-chip ${selected ? 'selected' : ''}`}
                  onClick={() => toggleBankProgram(program)}
                  disabled={bankProgramsMutation.isPending}
                >
                  {BANK_PROGRAM_LABEL[program]}
                </button>
              );
            })}
          </div>
        </fieldset>
        <p className="hint">Sesión: {user?.email}</p>
        <button className="btn-link" onClick={logout}>
          Cerrar sesión
        </button>
      </section>

      <PasskeySettingsSection />

      <InstallAppSection />

      {user?.isSuperUser && (
        <section className="card">
          <h2>Administración</h2>
          <p className="hint">Herramientas de mantenimiento del catálogo de promociones.</p>
          <Link to="/admin" className="btn-link">
            Sincronización de promos →
          </Link>
        </section>
      )}

      <section className="card">
        <h2>Notificaciones push</h2>
        <p className="hint">Estado: {pushStatus}</p>
        {pushError && <p className="error">{pushError}</p>}
        {!pushSupported() && pushBlockHint && (
          <div className="push-help">
            <p className="hint">{pushBlockHint}</p>
            {pushBlockReason === 'ios-browser' && <IosInstallSteps />}
            {standalone && pushBlockReason === 'ios-version' && (
              <p className="hint">
                Mientras tanto, los avisos siguen apareciendo en la campanita de la barra superior.
              </p>
            )}
          </div>
        )}
        {pushSupported() && (
          <button
            type="button"
            className={pushEnabled ? 'btn-secondary' : 'btn-primary'}
            disabled={pushBusy || pushStatus === 'Bloqueadas por el navegador'}
            onClick={() => {
              setPushError(null);
              setPushBusy(true);
              if (pushEnabled) {
                void unsubscribeFromPush((body) =>
                  api('/notifications/push-subscriptions', {
                    method: 'DELETE',
                    body: JSON.stringify(body),
                  }),
                )
                  .then(() => {
                    setPushEnabled(false);
                    setPushStatus('Desactivadas');
                  })
                  .catch((err) =>
                    setPushError(err instanceof Error ? err.message : 'No se pudo desactivar'),
                  )
                  .finally(() => setPushBusy(false));
                return;
              }
              void subscribeToPush(
                async () => {
                  const res = await api<{ publicKey: string }>('/notifications/vapid-public-key');
                  return res.publicKey;
                },
                (body) =>
                  api('/notifications/push-subscriptions', {
                    method: 'POST',
                    body: JSON.stringify(body),
                  }),
              )
                .then((r) => {
                  const enabled = r === 'granted';
                  setPushEnabled(enabled);
                  setPushStatus(enabled ? 'Activadas' : 'No concedidas');
                })
                .catch((err) =>
                  setPushError(err instanceof Error ? err.message : 'No se pudo activar'),
                )
                .finally(() => setPushBusy(false));
            }}
          >
            {pushBusy ? '…' : pushEnabled ? 'Desactivar alertas' : 'Activar alertas'}
          </button>
        )}
        <p className="hint">
          También podés gestionar <Link to="/recurrentes">pagos recurrentes</Link> (luz, gas,
          gym…), <Link to="/deudas">deudas con contactos</Link> o{' '}
          <Link to="/importar-resumen">importar un resumen</Link> de tarjeta.
        </p>
      </section>

      <section className="card">
        <h2>Deudas</h2>
        <p className="hint">Registrá lo que te deben o debés a amigos y familiares, con cuotas si aplica.</p>
        <Link to="/deudas" className="btn-link">
          Ir a deudas →
        </Link>
      </section>

      <section className="card">
        <h2>Liquidar juntada</h2>
        <p className="hint">
          Cuando varios pagaron en una juntada, calculá quién le paga a quién y registrá tu parte como
          gasto.
        </p>
        <Link to="/juntada" className="btn-link">
          Ir a liquidar →
        </Link>
      </section>

      <section className="card">
        <h2>Importar resumen</h2>
        <p className="hint">Cargá el PDF de Santander o BBVA y categorizá los consumos nuevos.</p>
        <Link to="/importar-resumen" className="btn-link">
          Importar resumen de tarjeta →
        </Link>
      </section>

      <section className="card">
        <div className="row-between">
          <h2>Medios de pago</h2>
          <button
            className="icon-btn"
            onClick={() => {
              if (panel === 'add') closePanel();
              else {
                setPanel('add');
                setEditId(null);
              }
            }}
          >
            {panel === 'add' ? '✕' : '＋'}
          </button>
        </div>
        <p className="hint">
          Asigná un dueño a cada tarjeta o cuenta. Efectivo y transferencia pueden quedar sin dueño y
          elegir quién pagó al cargar el gasto.
        </p>

        {panel === 'add' && definitions && methods && (
          <AddPaymentMethodsWizard
            definitions={definitions}
            existingMethods={methods}
            defaultOwnerUserId={user?.id ?? null}
            onDone={closePanel}
            onCancel={closePanel}
          />
        )}

        {panel === 'edit' && editMethod && (
          <EditPaymentMethodForm
            method={editMethod}
            members={members}
            onDone={closePanel}
            onCancel={closePanel}
          />
        )}

        {grouped.map((group) => (
          <div key={group.entityId} className="payment-method-group">
            <h3 className="payment-method-group-title">{group.entityName}</h3>
            {group.items.map((m) => (
              <div key={m.id} className="list-row payment-method-row">
                <div>
                  <strong>{paymentMethodDisplayName(m)}</strong>
                  {methodSubtitle(m) && <small> {methodSubtitle(m)}</small>}
                  <div className="payment-method-owner">
                    <label className="owner-assign">
                      <span className="visually-hidden">Dueño</span>
                      <select
                        value={m.owner?.id ?? ''}
                        onChange={(e) => assignOwner(m.id, e.target.value || null)}
                        aria-label={`Dueño de ${paymentMethodDisplayName(m)}`}
                      >
                        <option value="">Sin dueño</option>
                        {members.map((member) => (
                          <option key={member.id} value={member.id}>
                            {member.id === user?.id ? 'Vos' : member.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    {!m.owner && user?.id && (
                      <button
                        type="button"
                        className="btn-link"
                        onClick={() => void assignOwner(m.id, user.id)}
                      >
                        Reclamar
                      </button>
                    )}
                  </div>
                </div>
                <div className="list-row-actions">
                  <button
                    className="btn-link"
                    onClick={() => {
                      setEditId(m.id);
                      setPanel('edit');
                    }}
                  >
                    Editar
                  </button>
                  <button className="btn-link" onClick={() => removeMethod(m.id)}>
                    Eliminar
                  </button>
                </div>
              </div>
            ))}
          </div>
        ))}

        {methods && methods.length === 0 && panel === 'none' && (
          <p className="hint">Agregá tus tarjetas y billeteras del catálogo.</p>
        )}
      </section>
    </div>
  );
}
