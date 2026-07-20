import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ExpenseValidationError } from '../services/expense-purchase.js';
import {
  commitStatementImport,
  loadMatchablePurchases,
  matchLinesAgainstPurchases,
} from '../services/statement-import.js';

const parsedLineSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  store: z.string().min(1),
  amount: z.number().positive(),
  currency: z.enum(['ARS', 'USD']),
  installment: z
    .object({
      current: z.number().int().min(1).max(36),
      total: z.number().int().min(1).max(36),
    })
    .optional(),
  raw: z.string(),
  fingerprint: z.string().min(8),
  suggestedSkip: z.boolean(),
});

const matchBodySchema = z.object({
  paymentMethodId: z.string().min(1),
  lines: z.array(parsedLineSchema).min(1).max(500),
});

const decisionSchema = z.discriminatedUnion('action', [
  z.object({
    fingerprint: z.string().min(8),
    action: z.literal('SKIP'),
  }),
  z.object({
    fingerprint: z.string().min(8),
    action: z.literal('NEW'),
    categoryId: z.string().min(1),
    scope: z.enum(['HOUSEHOLD', 'PERSONAL']),
    splitMode: z.enum(['EQUAL', 'ASSIGN', 'AMOUNT', 'SHARES', 'PERCENTAGE']).optional(),
    assignToUserId: z.string().optional(),
  }),
  z.object({
    fingerprint: z.string().min(8),
    action: z.literal('MERGE'),
    matchedPurchaseId: z.string().min(1),
    amountResolution: z.enum(['KEEP_EXISTING', 'USE_STATEMENT']),
  }),
]);

const commitBodySchema = z.object({
  paymentMethodId: z.string().min(1),
  fileName: z.string().min(1).max(260),
  bankSource: z.string().min(1).max(80),
  lines: z.array(parsedLineSchema).min(1).max(500),
  decisions: z.array(decisionSchema).min(1).max(500),
});

export default async function statementImportRoutes(app: FastifyInstance) {
  app.post('/statement-imports/match', { preHandler: [app.authenticate] }, async (request, reply) => {
    const body = matchBodySchema.parse(request.body);
    const { householdId } = request.user;

    const pm = await app.prisma.paymentMethod.findFirst({
      where: { id: body.paymentMethodId, householdId },
    });
    if (!pm) return reply.code(400).send({ error: 'Medio de pago inválido' });

    const existingLines = await app.prisma.statementImportLine.findMany({
      where: {
        householdId,
        fingerprint: { in: body.lines.map((l) => l.fingerprint) },
        status: { in: ['NEW', 'MERGED'] },
      },
      select: { fingerprint: true, matchedPurchaseId: true, createdPurchaseId: true },
    });
    const importedFp = new Map(
      existingLines.map((e) => [e.fingerprint, e.createdPurchaseId ?? e.matchedPurchaseId]),
    );

    const purchases = await loadMatchablePurchases(app.prisma, householdId, body.paymentMethodId);
    const matched = matchLinesAgainstPurchases(body.lines, purchases, body.paymentMethodId);

    return {
      paymentMethodId: body.paymentMethodId,
      results: matched.map((m) => ({
        line: m.line,
        alreadyImported: m.alreadyImported || importedFp.has(m.line.fingerprint),
        alreadyImportedPurchaseId:
          m.alreadyImportedPurchaseId ?? importedFp.get(m.line.fingerprint) ?? null,
        candidates: m.candidates,
        topMatch: m.topMatch,
      })),
    };
  });

  app.post('/statement-imports/commit', { preHandler: [app.authenticate] }, async (request, reply) => {
    const body = commitBodySchema.parse(request.body);
    const { householdId, userId } = request.user;

    const decisionFps = new Set(body.decisions.map((d) => d.fingerprint));
    for (const line of body.lines) {
      if (!decisionFps.has(line.fingerprint) && !line.suggestedSkip) {
        return reply.code(400).send({
          error: `Falta decisión para ${line.store} (${line.date})`,
        });
      }
    }

    // Auto-skip for suggestedSkip lines without an explicit decision
    const decisions = [...body.decisions];
    for (const line of body.lines) {
      if (line.suggestedSkip && !decisionFps.has(line.fingerprint)) {
        decisions.push({ fingerprint: line.fingerprint, action: 'SKIP' });
      }
    }

    try {
      const result = await app.prisma.$transaction((tx) =>
        commitStatementImport(tx, {
          householdId,
          userId,
          paymentMethodId: body.paymentMethodId,
          fileName: body.fileName,
          bankSource: body.bankSource,
          lines: body.lines,
          decisions,
        }),
      );

      return {
        importId: result.import.id,
        processedCount: result.import.processedCount,
        results: result.results,
      };
    } catch (error) {
      if (error instanceof ExpenseValidationError) {
        return reply.code(400).send({ error: error.message });
      }
      throw error;
    }
  });
}
