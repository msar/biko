/**
 * Fecha con la que una cuota impacta un mes de reporte.
 *
 * - Compras en 1 cuota (contado, débito, o crédito en 1 pago): se cuentan en
 *   el mes de la compra (`purchaseDate`).
 * - Compras en 2+ cuotas: cada cuota se cuenta en el mes de su vencimiento
 *   (`dueDate`), repartiéndose entre meses.
 */
export function attributionDate(installmentsCount: number, purchaseDate: Date, dueDate: Date): Date {
  return installmentsCount === 1 ? purchaseDate : dueDate;
}

/** Mes de atribución en formato `YYYY-MM`. */
export function attributionMonth(installmentsCount: number, purchaseDate: Date, dueDate: Date): string {
  const date = attributionDate(installmentsCount, purchaseDate, dueDate);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}
