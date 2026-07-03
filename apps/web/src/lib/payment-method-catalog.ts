import type { CardNetwork } from '@biko/shared';
import type { PaymentMethod, PaymentMethodDefinition } from './types';

export const CREDIT_NETWORKS: CardNetwork[] = ['VISA', 'MASTERCARD', 'AMEX'];

export const NETWORK_LABEL: Record<string, string> = {
  VISA: 'Visa',
  MASTERCARD: 'Mastercard',
  AMEX: 'Amex',
};

export interface EntityGroup<T> {
  entityId: string;
  entityName: string;
  kind: 'BANK' | 'WALLET' | 'OTHER';
  items: T[];
}

export function paymentMethodDisplayName(method: PaymentMethod): string {
  return method.nickname?.trim() || method.definition.name;
}

export function alreadyAddedDefinitionIds(methods: PaymentMethod[]): Set<string> {
  return new Set(methods.map((m) => m.definitionId));
}

export function creditDefinitionFor(
  entityId: string,
  network: CardNetwork,
  definitions: PaymentMethodDefinition[],
): PaymentMethodDefinition | undefined {
  return definitions.find(
    (d) => d.entityId === entityId && d.type === 'CREDIT_CARD' && d.network === network,
  );
}

export function walletDefinitionFor(
  entityId: string,
  definitions: PaymentMethodDefinition[],
): PaymentMethodDefinition | undefined {
  return definitions.find((d) => d.entityId === entityId && d.type === 'WALLET');
}

/** Unique bank/wallet issuers from catalog definitions. */
export function listIssuerEntities(definitions: PaymentMethodDefinition[]): EntityGroup<never>[] {
  const seen = new Map<string, EntityGroup<never>>();
  for (const d of definitions) {
    if (!d.entity) continue;
    if (seen.has(d.entity.id)) continue;
    seen.set(d.entity.id, {
      entityId: d.entity.id,
      entityName: d.entity.name,
      kind: d.entity.kind,
      items: [],
    });
  }
  return [...seen.values()].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'BANK' ? -1 : 1;
    return a.entityName.localeCompare(b.entityName);
  });
}

export function groupMethodsByEntity(methods: PaymentMethod[]): EntityGroup<PaymentMethod>[] {
  const map = new Map<string, EntityGroup<PaymentMethod>>();
  for (const method of methods) {
    const entity = method.definition.entity;
    const entityId = entity?.id ?? 'unknown';
    const existing = map.get(entityId);
    if (existing) {
      existing.items.push(method);
    } else {
      map.set(entityId, {
        entityId,
        entityName: entity?.name ?? method.definition.name,
        kind: entity?.kind ?? 'OTHER',
        items: [method],
      });
    }
  }
  return [...map.values()].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'BANK' ? -1 : 1;
    return a.entityName.localeCompare(b.entityName);
  });
}

export function methodSubtitle(method: PaymentMethod): string {
  const parts: string[] = [];
  if (method.nickname) parts.push(method.definition.name);
  if (method.lastFour) parts.push(`···${method.lastFour}`);
  if (method.closingDay != null) parts.push(`cierre ${method.closingDay}, vto ${method.dueDay}`);
  return parts.join(' · ');
}
