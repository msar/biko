import { computePartyEqualSplit, computeSettleTransfers } from '@biko/shared';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { fmtARS } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { ExpenseFormInitial } from '../components/ExpenseForm';

type Participant = {
  id: string;
  name: string;
  paid: string;
};

function newId(): string {
  return crypto.randomUUID();
}

function parsePaid(value: string): number {
  const n = Number(value.replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export type PartyExpensePrefill = Pick<ExpenseFormInitial, 'amount' | 'store' | 'scope' | 'chargeTo'>;

export default function PartySettlePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [meId, setMeId] = useState(() => newId());
  const [participants, setParticipants] = useState<Participant[]>(() => [
    { id: meId, name: user?.name ?? '', paid: '' },
    { id: newId(), name: '', paid: '' },
  ]);

  const named = useMemo(
    () =>
      participants
        .map((p) => ({ ...p, name: p.name.trim(), paidNum: parsePaid(p.paid) }))
        .filter((p) => p.name.length > 0),
    [participants],
  );

  const nameById = useMemo(() => new Map(named.map((p) => [p.id, p.name])), [named]);

  const split = useMemo(() => {
    if (named.length < 2) return null;
    return computePartyEqualSplit(named.map((p) => ({ id: p.id, paid: p.paidNum })));
  }, [named]);

  const transfers = useMemo(() => {
    if (!split || split.total <= 0) return [];
    return computeSettleTransfers(split.balances);
  }, [split]);

  const updateParticipant = (id: string, patch: Partial<Pick<Participant, 'name' | 'paid'>>) => {
    setParticipants((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  };

  const addParticipant = () => {
    setParticipants((prev) => [...prev, { id: newId(), name: '', paid: '' }]);
  };

  const removeParticipant = (id: string) => {
    if (participants.length <= 2) return;
    const next = participants.filter((p) => p.id !== id);
    setParticipants(next);
    if (id === meId) setMeId(next[0]!.id);
  };

  const registerMyShare = () => {
    if (!split || split.share <= 0) return;
    const prefill: PartyExpensePrefill = {
      amount: String(split.share),
      store: 'Juntada',
      scope: 'PERSONAL',
      chargeTo: 'me',
    };
    navigate('/nuevo', { state: prefill });
  };

  const canCompute = named.length >= 2 && (split?.total ?? 0) > 0;
  const meIsNamed = named.some((p) => p.id === meId);

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Liquidar juntada</h1>
          <p className="hint">Cargá lo que pagó cada uno y te decimos quién le paga a quién.</p>
        </div>
      </header>

      <section className="card">
        <h2>Participantes</h2>
        <p className="hint">Marcá quién sos vos para registrar tu parte como gasto.</p>
        <div className="party-participants">
          {participants.map((p) => (
            <div key={p.id} className="party-participant-row">
              <label className="party-me-toggle">
                <input
                  type="radio"
                  name="party-me"
                  checked={p.id === meId}
                  onChange={() => setMeId(p.id)}
                  aria-label="Soy yo"
                />
                <span>Vos</span>
              </label>
              <input
                className="party-name-input"
                value={p.name}
                onChange={(e) => updateParticipant(p.id, { name: e.target.value })}
                placeholder="Nombre"
                aria-label="Nombre"
              />
              <input
                className="party-paid-input"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={p.paid}
                onChange={(e) => updateParticipant(p.id, { paid: e.target.value })}
                placeholder="Pagó"
                aria-label="Monto pagado"
              />
              <button
                type="button"
                className="icon-btn"
                onClick={() => removeParticipant(p.id)}
                disabled={participants.length <= 2}
                aria-label="Quitar"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
        <button type="button" className="btn-secondary" onClick={addParticipant}>
          ＋ Agregar persona
        </button>
      </section>

      {canCompute && split && (
        <>
          <section className="card">
            <h2>Resumen</h2>
            <div className="list-row">
              <span>Total</span>
              <strong>{fmtARS.format(split.total)}</strong>
            </div>
            <div className="list-row">
              <span>Por persona</span>
              <strong>{fmtARS.format(split.share)}</strong>
            </div>
            {split.balances.map((b) => {
              const name = nameById.get(b.userId) ?? b.userId;
              const label =
                b.balance > 0.005 ? 'a favor' : b.balance < -0.005 ? 'debe' : 'a mano';
              return (
                <div key={b.userId} className="list-row">
                  <span>
                    <strong>{name}</strong>
                    {b.userId === meId ? ' (vos)' : ''}
                  </span>
                  <strong className={b.balance >= 0 ? 'balance-pos' : 'balance-neg'}>
                    {fmtARS.format(Math.abs(b.balance))} {label}
                  </strong>
                </div>
              );
            })}
            {meIsNamed && split.share > 0 && (
              <div className="settle-cta">
                <p className="hint">
                  Tu parte es {fmtARS.format(split.share)}. Podés cargarla como gasto personal.
                </p>
                <button type="button" className="btn-primary" onClick={registerMyShare}>
                  Registrar mi parte como gasto
                </button>
              </div>
            )}
          </section>

          <section className="card">
            <h2>Quién le paga a quién</h2>
            {transfers.length > 0 ? (
              <div className="settle-transfers">
                {transfers.map((t) => {
                  const fromName = nameById.get(t.fromUserId) ?? t.fromUserId;
                  const toName = nameById.get(t.toUserId) ?? t.toUserId;
                  return (
                    <p key={`${t.fromUserId}-${t.toUserId}`} className="settle-transfer">
                      <strong>{fromName}</strong> le paga a <strong>{toName}</strong>{' '}
                      {fmtARS.format(t.amount)}
                    </p>
                  );
                })}
              </div>
            ) : (
              <p className="settle-even">Están a mano</p>
            )}
          </section>
        </>
      )}

      {!canCompute && (
        <p className="hint">Agregá al menos dos nombres y lo que pagó cada uno para ver la liquidación.</p>
      )}

      <p className="hint">
        <Link to="/ajustes">← Volver a Más</Link>
      </p>
    </div>
  );
}
