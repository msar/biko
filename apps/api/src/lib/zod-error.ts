import { ZodError, type ZodIssue } from 'zod';

const FIELD_LABELS: Record<string, string> = {
  amount: 'monto',
  category: 'categoría',
  date: 'fecha',
  note: 'nota',
  payments: 'pagadores',
  paidByMemberId: 'pagador',
  splitMode: 'reparto',
  splitValues: 'valores de reparto',
  assignToMemberId: 'asignación',
  paymentMethodId: 'medio de pago',
  categoryId: 'categoría',
  store: 'comercio',
  purchaseDate: 'fecha',
  grossAmount: 'monto',
  installmentsCount: 'cuotas',
  promotionMode: 'promoción',
  promotionId: 'promoción',
  manualDiscount: 'descuento',
  discountPercentage: '% de descuento',
  discountCap: 'tope de descuento',
  myShareAmount: 'tu parte',
  assignToUserId: 'asignación',
  paidByUserId: 'quién pagó',
  title: 'título',
  quantity: 'cantidad',
  dayDate: 'día',
  startTime: 'hora',
  endTime: 'hora de fin',
  mealSlot: 'tipo de comida',
  placeName: 'lugar',
  link: 'link',
  checkIn: 'check-in',
  checkOut: 'check-out',
  checkInTime: 'hora de check-in',
  checkOutTime: 'hora de check-out',
  label: 'nombre',
  address: 'dirección',
  name: 'nombre',
  email: 'email',
  password: 'contraseña',
  closingDay: 'día de cierre',
  dueDay: 'día de vencimiento',
  lastFour: 'últimos 4',
};

function fieldLabel(path: (string | number)[]): string | null {
  for (let i = path.length - 1; i >= 0; i--) {
    const key = path[i];
    if (typeof key === 'string' && FIELD_LABELS[key]) return FIELD_LABELS[key];
  }
  return null;
}

function translateIssue(issue: ZodIssue): string {
  if (issue.message && !isGenericZodMessage(issue.message)) {
    return issue.message;
  }

  const label = fieldLabel(issue.path);
  const where = label ? `en ${label}` : issue.path.length > 0 ? `en ${issue.path.join('.')}` : '';

  switch (issue.code) {
    case 'invalid_type': {
      if (issue.received === 'undefined' || issue.received === 'null') {
        return label ? `Falta ${label}` : 'Falta un dato obligatorio';
      }
      if (issue.expected === 'number') {
        return label ? `${capitalize(label)} debe ser un número` : 'Se esperaba un número';
      }
      return where ? `Dato inválido ${where}` : 'Dato con formato inválido';
    }
    case 'too_small': {
      if (issue.type === 'number') {
        if (issue.minimum === 0) {
          return label ? `${capitalize(label)} no puede ser negativo` : 'El valor no puede ser negativo';
        }
        if (issue.minimum === 1) {
          return label ? `${capitalize(label)} debe ser mayor a 0` : 'El valor debe ser mayor a 0';
        }
        return label
          ? `${capitalize(label)} debe ser al menos ${issue.minimum}`
          : `El valor debe ser al menos ${issue.minimum}`;
      }
      if (issue.type === 'string') {
        return label ? `${capitalize(label)} es obligatorio` : 'Completá el campo';
      }
      if (issue.type === 'array') {
        return label ? `Agregá al menos un ítem en ${label}` : 'Faltan ítems';
      }
      break;
    }
    case 'too_big': {
      if (issue.type === 'number') {
        return label
          ? `${capitalize(label)} no puede ser mayor a ${issue.maximum}`
          : `El valor no puede ser mayor a ${issue.maximum}`;
      }
      break;
    }
    case 'invalid_enum_value':
      return label ? `Valor no válido en ${label}` : 'Valor no válido';
    case 'invalid_string':
      return label ? `${capitalize(label)} tiene un formato inválido` : 'Formato inválido';
    default:
      break;
  }

  return where ? `Dato inválido ${where}` : issue.message || 'Datos inválidos';
}

function isGenericZodMessage(message: string): boolean {
  return (
    /^(Required|Invalid|Expected |Number must |String must |Array must |Invalid enum|Invalid date)/i.test(
      message,
    ) || message === 'Required'
  );
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}

/** Human-readable Spanish summary of a Zod validation failure. */
export function formatZodError(error: ZodError): string {
  const messages = error.issues.map(translateIssue).filter(Boolean);
  const unique = [...new Set(messages)];
  if (unique.length === 0) return 'Datos inválidos';
  return unique.slice(0, 3).join(' · ');
}
