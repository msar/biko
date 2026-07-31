import { useLocation } from 'react-router-dom';
import ExpenseForm, { type ExpenseFormInitial } from '../components/ExpenseForm';
import type { PartyExpensePrefill } from './PartySettlePage';

function isPartyPrefill(value: unknown): value is PartyExpensePrefill {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.amount === 'string' &&
    typeof v.store === 'string' &&
    v.scope === 'PERSONAL' &&
    v.chargeTo === 'me'
  );
}

export default function NewExpensePage() {
  const location = useLocation();
  const prefill = isPartyPrefill(location.state) ? location.state : null;
  const initial: Partial<ExpenseFormInitial> | undefined = prefill
    ? {
        amount: prefill.amount,
        store: prefill.store,
        scope: prefill.scope,
        chargeTo: prefill.chargeTo,
      }
    : undefined;

  return <ExpenseForm mode="create" title="Nuevo gasto" initial={initial} />;
}
