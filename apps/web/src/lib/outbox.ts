// Outbox offline: los gastos creados sin conexión se guardan en IndexedDB y se
// sincronizan al volver la conexión. El clientId (UUID generado acá) hace la
// operación idempotente del lado del server: reintentar nunca duplica.
import { get, set } from 'idb-keyval';
import { api } from './api';
import { rememberStoreFromExpense } from './store-suggestions';
import type { ExpenseScope, ManualDiscount, PromotionApplyMode, SplitMode } from './types';

export interface OutboxExpense {
  clientId: string;
  paymentMethodId: string;
  categoryId: string;
  store: string;
  description: string | null;
  purchaseDate: string;
  grossAmount: number;
  installmentsCount: number;
  /** @deprecated use promotionMode */
  applyPromotion?: boolean;
  promotionMode?: PromotionApplyMode;
  promotionId?: string;
  manualDiscount?: ManualDiscount;
  scope?: ExpenseScope;
  /** @deprecated Prefer splitMode + splitValues / assignToUserId */
  myShareAmount?: number;
  splitMode?: SplitMode;
  assignToUserId?: string;
  splitValues?: { userId: string; value: number }[];
  createdAt: string;
}

const KEY = 'biko:outbox';
const listeners = new Set<() => void>();

export function onOutboxChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify() {
  listeners.forEach((fn) => fn());
}

export async function getOutbox(): Promise<OutboxExpense[]> {
  return (await get<OutboxExpense[]>(KEY)) ?? [];
}

export async function enqueueExpense(expense: OutboxExpense): Promise<void> {
  const items = await getOutbox();
  await set(KEY, [...items, expense]);
  rememberStoreFromExpense(expense.store);
  notify();
}

let syncing = false;

/** Drena el outbox contra el server. Devuelve cuántos gastos sincronizó. */
export async function syncOutbox(): Promise<number> {
  if (syncing || !navigator.onLine) return 0;
  syncing = true;
  let synced = 0;
  try {
    let items = await getOutbox();
    for (const item of items) {
      try {
        await api('/expenses', { method: 'POST', body: JSON.stringify(item) });
        rememberStoreFromExpense(item.store);
        items = items.filter((i) => i.clientId !== item.clientId);
        await set(KEY, items);
        synced++;
        notify();
      } catch (err) {
        // Sin red o server caído: paramos y reintentamos en el próximo evento.
        // Errores 4xx (datos inválidos) descartan el item para no trabar la cola.
        if (err instanceof Error && 'status' in err && (err as { status: number }).status < 500 && (err as { status: number }).status !== 401) {
          items = items.filter((i) => i.clientId !== item.clientId);
          await set(KEY, items);
          notify();
          continue;
        }
        break;
      }
    }
  } finally {
    syncing = false;
  }
  return synced;
}

export function startOutboxSync(onSynced: (count: number) => void): () => void {
  const trigger = async () => {
    const count = await syncOutbox();
    if (count > 0) onSynced(count);
  };
  window.addEventListener('online', trigger);
  const interval = setInterval(trigger, 60_000);
  void trigger();
  return () => {
    window.removeEventListener('online', trigger);
    clearInterval(interval);
  };
}
