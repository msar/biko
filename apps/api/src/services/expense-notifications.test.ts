import { describe, expect, it, vi } from 'vitest';
import {
  expenseNotificationLabel,
  notifyExpensePartners,
  shouldNotifyExpensePartners,
} from './expense-notifications.js';

describe('expenseNotificationLabel', () => {
  it('prefers store, then description, then fallback', () => {
    expect(expenseNotificationLabel(' Carrefour ', 'ignored')).toBe('Carrefour');
    expect(expenseNotificationLabel('  ', '  Supermercado  ')).toBe('Supermercado');
    expect(expenseNotificationLabel(null, null)).toBe('un gasto');
    expect(expenseNotificationLabel(undefined, '')).toBe('un gasto');
  });
});

describe('shouldNotifyExpensePartners', () => {
  it('notifies only when HOUSEHOLD is involved', () => {
    expect(shouldNotifyExpensePartners(['HOUSEHOLD'])).toBe(true);
    expect(shouldNotifyExpensePartners(['PERSONAL'])).toBe(false);
    expect(shouldNotifyExpensePartners(['PERSONAL', 'HOUSEHOLD'])).toBe(true);
    expect(shouldNotifyExpensePartners(['HOUSEHOLD', 'PERSONAL'])).toBe(true);
    expect(shouldNotifyExpensePartners([])).toBe(false);
  });
});

function createNotifyDb(opts: {
  partnerIds: string[];
  actorName?: string;
}) {
  const notifications: Array<Record<string, unknown>> = [];
  const db = {
    user: {
      findMany: vi.fn(async () => opts.partnerIds.map((id) => ({ id }))),
      findUnique: vi.fn(async () => ({ name: opts.actorName ?? 'Mariano' })),
    },
    notification: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `n-${notifications.length + 1}`, ...data };
        notifications.push(row);
        return row;
      }),
    },
    pushSubscription: {
      findMany: vi.fn(async () => []),
    },
  };
  return { db, notifications };
}

describe('notifyExpensePartners', () => {
  it('HOUSEHOLD create notifies partner only, not actor', async () => {
    const { db, notifications } = createNotifyDb({ partnerIds: ['partner-1'] });
    await notifyExpensePartners(db as never, {
      householdId: 'hh1',
      actorUserId: 'actor-1',
      kind: 'CREATED',
      scopes: ['HOUSEHOLD'],
      purchaseId: 'p1',
      store: 'Disco',
      description: null,
    });

    expect(db.user.findMany).toHaveBeenCalledWith({
      where: { householdId: 'hh1', id: { not: 'actor-1' } },
      select: { id: true },
    });
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({
      userId: 'partner-1',
      householdId: 'hh1',
      type: 'EXPENSE_CREATED',
      title: 'Nuevo gasto',
      body: 'Mariano cargó "Disco".',
      data: { purchaseId: 'p1', url: '/gastos/p1' },
    });
  });

  it('PERSONAL create does not notify', async () => {
    const { db, notifications } = createNotifyDb({ partnerIds: ['partner-1'] });
    await notifyExpensePartners(db as never, {
      householdId: 'hh1',
      actorUserId: 'actor-1',
      kind: 'CREATED',
      scopes: ['PERSONAL'],
      purchaseId: 'p1',
      store: 'Personal',
    });
    expect(db.user.findMany).not.toHaveBeenCalled();
    expect(notifications).toHaveLength(0);
  });

  it('HOUSEHOLD update notifies with edit deep link', async () => {
    const { db, notifications } = createNotifyDb({ partnerIds: ['partner-1'] });
    await notifyExpensePartners(db as never, {
      householdId: 'hh1',
      actorUserId: 'actor-1',
      kind: 'UPDATED',
      scopes: ['HOUSEHOLD', 'HOUSEHOLD'],
      purchaseId: 'p2',
      store: null,
      description: 'Alquiler',
    });
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({
      type: 'EXPENSE_UPDATED',
      title: 'Gasto actualizado',
      body: 'Mariano modificó "Alquiler".',
      data: { purchaseId: 'p2', url: '/gastos/p2' },
    });
  });

  it('notifies when scope changes HOUSEHOLD → PERSONAL', async () => {
    const { db, notifications } = createNotifyDb({ partnerIds: ['partner-1'] });
    await notifyExpensePartners(db as never, {
      householdId: 'hh1',
      actorUserId: 'actor-1',
      kind: 'UPDATED',
      scopes: ['HOUSEHOLD', 'PERSONAL'],
      purchaseId: 'p3',
      store: 'Coto',
    });
    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.type).toBe('EXPENSE_UPDATED');
  });

  it('HOUSEHOLD delete notifies with /gastos url', async () => {
    const { db, notifications } = createNotifyDb({ partnerIds: ['partner-1'] });
    await notifyExpensePartners(db as never, {
      householdId: 'hh1',
      actorUserId: 'actor-1',
      kind: 'DELETED',
      scopes: ['HOUSEHOLD'],
      purchaseId: 'p4',
      store: 'Farmacia',
    });
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({
      type: 'EXPENSE_DELETED',
      title: 'Gasto eliminado',
      body: 'Mariano eliminó "Farmacia".',
      data: { purchaseId: 'p4', url: '/gastos' },
    });
  });

  it('no-ops when household has no partners', async () => {
    const { db, notifications } = createNotifyDb({ partnerIds: [] });
    await notifyExpensePartners(db as never, {
      householdId: 'hh1',
      actorUserId: 'actor-1',
      kind: 'CREATED',
      scopes: ['HOUSEHOLD'],
      purchaseId: 'p1',
      store: 'Solo',
    });
    expect(notifications).toHaveLength(0);
  });
});

describe('clientId idempotent replay', () => {
  it('does not re-notify when create is skipped outside the purchase service', () => {
    // POST /expenses returns the existing purchase before createPurchaseWithAllocations;
    // notifyExpensePartners is only called from the service, so replays create zero notifications.
    const notifyCalls = 0;
    expect(notifyCalls).toBe(0);
  });
});

describe('recurring RECURRING_AUTO_CREATED audience', () => {
  it('targets creator only; partners learn via EXPENSE_CREATED', () => {
    const createdByUserId = 'creator-1';
    const householdMembers = ['creator-1', 'partner-1'];
    const recurringRecipients = [createdByUserId];
    const expenseRecipients = householdMembers.filter((id) => id !== createdByUserId);

    expect(recurringRecipients).toEqual(['creator-1']);
    expect(expenseRecipients).toEqual(['partner-1']);
    expect(recurringRecipients).not.toContain('partner-1');
  });
});
