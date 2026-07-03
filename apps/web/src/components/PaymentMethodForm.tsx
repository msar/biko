import type { CardNetwork } from '@biko/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { api } from '../lib/api';
import {
  CREDIT_NETWORKS,
  NETWORK_LABEL,
  alreadyAddedDefinitionIds,
  creditDefinitionFor,
  listIssuerEntities,
  walletDefinitionFor,
} from '../lib/payment-method-catalog';
import type { PaymentMethod, PaymentMethodDefinition } from '../lib/types';

interface AddPaymentMethodsWizardProps {
  definitions: PaymentMethodDefinition[];
  existingMethods: PaymentMethod[];
  onDone: () => void;
  onCancel: () => void;
}

export function AddPaymentMethodsWizard({
  definitions,
  existingMethods,
  onDone,
  onCancel,
}: AddPaymentMethodsWizardProps) {
  const queryClient = useQueryClient();
  const issuers = listIssuerEntities(definitions);
  const banks = issuers.filter((i) => i.kind === 'BANK');
  const wallets = issuers.filter((i) => i.kind === 'WALLET');
  const addedIds = alreadyAddedDefinitionIds(existingMethods);

  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [networks, setNetworks] = useState<CardNetwork[]>([]);
  const [closingDay, setClosingDay] = useState('');
  const [dueDay, setDueDay] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savingWalletId, setSavingWalletId] = useState<string | null>(null);

  const selectedIssuer = issuers.find((i) => i.entityId === selectedEntityId);
  const isBank = selectedIssuer?.kind === 'BANK';

  const toggleNetwork = (network: CardNetwork) => {
    setNetworks((prev) => (prev.includes(network) ? prev.filter((n) => n !== network) : [...prev, network]));
  };

  const addWallet = async (entityId: string) => {
    const def = walletDefinitionFor(entityId, definitions);
    if (!def) {
      setError('No se encontró la billetera en el catálogo');
      return;
    }
    if (addedIds.has(def.id)) {
      setError('Ya tenés este medio de pago cargado');
      return;
    }
    setSavingWalletId(entityId);
    setError(null);
    try {
      await api('/payment-methods', {
        method: 'POST',
        body: JSON.stringify({ definitionId: def.id }),
      });
      void queryClient.invalidateQueries({ queryKey: ['payment-methods'] });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al agregar');
    } finally {
      setSavingWalletId(null);
    }
  };

  const onSubmitBank = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedEntityId || networks.length === 0) return;
    if (!closingDay || !dueDay) {
      setError('Ingresá día de cierre y vencimiento');
      return;
    }
    setSaving(true);
    setError(null);
    const failures: string[] = [];
    let added = 0;
    for (const network of networks) {
      const def = creditDefinitionFor(selectedEntityId, network, definitions);
      if (!def || addedIds.has(def.id)) continue;
      try {
        await api('/payment-methods', {
          method: 'POST',
          body: JSON.stringify({
            definitionId: def.id,
            closingDay: Number(closingDay),
            dueDay: Number(dueDay),
          }),
        });
        added++;
      } catch (err) {
        failures.push(`${NETWORK_LABEL[network]}: ${err instanceof Error ? err.message : 'Error'}`);
      }
    }
    void queryClient.invalidateQueries({ queryKey: ['payment-methods'] });
    setSaving(false);
    if (added > 0) {
      onDone();
    } else if (failures.length > 0) {
      setError(failures.join(' · '));
    } else {
      setError('No se pudo agregar ninguna tarjeta');
    }
  };

  if (!selectedEntityId || !isBank) {
    return (
      <div className="card promo-form payment-method-wizard">
        <div className="row-between">
          <h2>Agregar medio de pago</h2>
          <button type="button" className="icon-btn" onClick={onCancel} aria-label="Cancelar">
            ✕
          </button>
        </div>
        {banks.length > 0 && (
          <>
            <span className="field-label">Bancos</span>
            <div className="issuer-grid">
              {banks.map((bank) => (
                <button
                  key={bank.entityId}
                  type="button"
                  className="method-chip"
                  onClick={() => setSelectedEntityId(bank.entityId)}
                >
                  {bank.entityName}
                </button>
              ))}
            </div>
          </>
        )}
        {wallets.length > 0 && (
          <>
            <span className="field-label">Billeteras</span>
            <div className="issuer-grid">
              {wallets.map((wallet) => {
                const def = walletDefinitionFor(wallet.entityId, definitions);
                const already = def ? addedIds.has(def.id) : false;
                return (
                  <button
                    key={wallet.entityId}
                    type="button"
                    className="method-chip"
                    disabled={already || savingWalletId === wallet.entityId}
                    onClick={() => void addWallet(wallet.entityId)}
                  >
                    {wallet.entityName}
                    {already ? ' ✓' : savingWalletId === wallet.entityId ? ' …' : ''}
                  </button>
                );
              })}
            </div>
          </>
        )}
        {error && <p className="error">{error}</p>}
      </div>
    );
  }

  return (
    <form className="card promo-form payment-method-wizard" onSubmit={onSubmitBank}>
      <div className="row-between">
        <h2>{selectedIssuer?.entityName}</h2>
        <button type="button" className="icon-btn" onClick={() => setSelectedEntityId(null)} aria-label="Volver">
          ←
        </button>
      </div>
      <span className="field-label">Tarjetas de crédito que tenés</span>
      <div className="network-checkboxes">
        {CREDIT_NETWORKS.map((network) => {
          const def = creditDefinitionFor(selectedEntityId, network, definitions);
          const already = def ? addedIds.has(def.id) : true;
          return (
            <label key={network} className={`network-check ${already ? 'disabled' : ''}`}>
              <input
                type="checkbox"
                checked={networks.includes(network)}
                disabled={already}
                onChange={() => toggleNetwork(network)}
              />
              {NETWORK_LABEL[network]}
              {already ? ' (ya cargada)' : ''}
            </label>
          );
        })}
      </div>
      {networks.length > 0 && (
        <div className="field-row">
          <label>
            Día de cierre
            <input
              type="number"
              min="1"
              max="31"
              required
              value={closingDay}
              onChange={(e) => setClosingDay(e.target.value)}
              placeholder="15"
            />
          </label>
          <label>
            Día de vencimiento
            <input
              type="number"
              min="1"
              max="31"
              required
              value={dueDay}
              onChange={(e) => setDueDay(e.target.value)}
              placeholder="10"
            />
          </label>
        </div>
      )}
      <p className="hint">Podés editar el nombre y últimos 4 dígitos de cada tarjeta después de agregarla.</p>
      {error && <p className="error">{error}</p>}
      <div className="confirm-actions">
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={saving}>
          Cancelar
        </button>
        <button type="submit" className="btn-primary" disabled={saving || networks.length === 0}>
          {saving ? 'Agregando…' : 'Agregar tarjetas'}
        </button>
      </div>
    </form>
  );
}

interface EditPaymentMethodFormProps {
  method: PaymentMethod;
  onDone: () => void;
  onCancel: () => void;
}

export function EditPaymentMethodForm({ method, onDone, onCancel }: EditPaymentMethodFormProps) {
  const queryClient = useQueryClient();
  const isCredit = method.definition.type === 'CREDIT_CARD';
  const isCard = isCredit || method.definition.type === 'DEBIT_CARD';
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api(`/payment-methods/${method.id}`, { method: 'PUT', body: JSON.stringify(body) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['payment-methods'] });
      onDone();
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Error'),
  });

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    mutation.mutate({
      nickname: String(data.get('nickname')) || null,
      lastFour: String(data.get('lastFour')) || null,
      closingDay: data.get('closingDay') ? Number(data.get('closingDay')) : null,
      dueDay: data.get('dueDay') ? Number(data.get('dueDay')) : null,
    });
  };

  return (
    <form className="card promo-form" onSubmit={onSubmit}>
      <div className="row-between">
        <h2>Editar medio de pago</h2>
        <button type="button" className="icon-btn" onClick={onCancel} aria-label="Cancelar">
          ✕
        </button>
      </div>
      <p className="hint">{method.definition.name}</p>
      <label>
        Nombre
        <input name="nickname" defaultValue={method.nickname ?? ''} placeholder={method.definition.name} />
      </label>
      {isCard && (
        <label>
          Últimos 4 dígitos
          <input
            name="lastFour"
            pattern="\d{4}"
            maxLength={4}
            defaultValue={method.lastFour ?? ''}
            placeholder="1234"
          />
        </label>
      )}
      {isCredit && (
        <div className="field-row">
          <label>
            Día de cierre
            <input
              name="closingDay"
              type="number"
              min="1"
              max="31"
              required
              defaultValue={method.closingDay ?? ''}
              placeholder="15"
            />
          </label>
          <label>
            Día de vencimiento
            <input
              name="dueDay"
              type="number"
              min="1"
              max="31"
              required
              defaultValue={method.dueDay ?? ''}
              placeholder="10"
            />
          </label>
        </div>
      )}
      {error && <p className="error">{error}</p>}
      <div className="confirm-actions">
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={mutation.isPending}>
          Cancelar
        </button>
        <button type="submit" className="btn-primary" disabled={mutation.isPending}>
          {mutation.isPending ? 'Guardando…' : 'Guardar'}
        </button>
      </div>
    </form>
  );
}
