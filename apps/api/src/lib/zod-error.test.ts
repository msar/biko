import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { formatZodError } from './zod-error.js';

describe('formatZodError', () => {
  it('prefers custom Spanish messages', () => {
    const schema = z.object({
      amount: z.number().positive('El monto debe ser mayor a 0'),
    });
    const result = schema.safeParse({ amount: -1 });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(formatZodError(result.error)).toBe('El monto debe ser mayor a 0');
  });

  it('explains missing required fields', () => {
    const schema = z.object({
      store: z.string().min(1),
    });
    const result = schema.safeParse({});
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(formatZodError(result.error)).toMatch(/comercio|Falta/i);
  });

  it('explains invalid split values instead of generic Datos inválidos', () => {
    const schema = z.object({
      splitValues: z.array(
        z.object({
          memberId: z.string().min(1),
          value: z.number().nonnegative('Los valores de reparto no pueden ser negativos'),
        }),
      ),
    });
    const result = schema.safeParse({
      splitValues: [{ memberId: 'm1', value: -2 }],
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(formatZodError(result.error)).toBe('Los valores de reparto no pueden ser negativos');
  });

  it('falls back when path has no label', () => {
    const schema = z.object({
      weirdField: z.number(),
    });
    const result = schema.safeParse({ weirdField: 'x' });
    expect(result.success).toBe(false);
    if (result.success) return;
    const msg = formatZodError(result.error);
    expect(msg).not.toBe('Datos inválidos');
    expect(msg.length).toBeGreaterThan(0);
  });
});
