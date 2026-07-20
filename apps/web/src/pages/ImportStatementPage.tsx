import type { ParsedStatementLine, StatementBankSource } from '@biko/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, fmtARSExact, fmtDate } from '../lib/api';
import { groupMethodsByEntity, paymentMethodDisplayName } from '../lib/payment-method-catalog';
import { guessPaymentMethodId, parseStatementPdf } from '../lib/statement-pdf';
import type { Category, ExpenseScope, PaymentMethod } from '../lib/types';

type MatchCandidate = {
  purchaseId: string;
  store: string;
  purchaseDate: string;
  netAmount: number;
  installmentNumber: number | null;
  installmentAmount: number | null;
  installmentsCount: number;
  score: number;
  amountDelta: number;
};

type MatchResult = {
  line: ParsedStatementLine;
  alreadyImported: boolean;
  alreadyImportedPurchaseId: string | null;
  candidates: MatchCandidate[];
  topMatch: MatchCandidate | null;
};

type LineDecision =
  | { action: 'SKIP' }
  | { action: 'NEW'; categoryId: string; scope: ExpenseScope }
  | {
      action: 'MERGE';
      matchedPurchaseId: string;
      amountResolution: 'KEEP_EXISTING' | 'USE_STATEMENT';
    };

type Step = 'upload' | 'review' | 'done';

export default function ImportStatementPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [paymentMethodId, setPaymentMethodId] = useState('');
  const [bank, setBank] = useState<StatementBankSource>('Unknown');
  const [lines, setLines] = useState<ParsedStatementLine[]>([]);
  const [matchResults, setMatchResults] = useState<MatchResult[]>([]);
  const [decisions, setDecisions] = useState<Record<string, LineDecision>>({});
  const [error, setError] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [showSkipped, setShowSkipped] = useState(false);
  const [doneSummary, setDoneSummary] = useState<{ processed: number; skipped: number } | null>(null);

  const { data: methods } = useQuery({
    queryKey: ['payment-methods'],
    queryFn: () => api<PaymentMethod[]>('/payment-methods'),
  });
  const { data: categories } = useQuery({
    queryKey: ['categories'],
    queryFn: () => api<Category[]>('/categories'),
  });

  const creditCards = useMemo(
    () => (methods ?? []).filter((m) => m.definition.type === 'CREDIT_CARD'),
    [methods],
  );
  const grouped = groupMethodsByEntity(creditCards);
  const defaultCategoryId = categories?.find((c) => c.name === 'Otros')?.id ?? categories?.[0]?.id ?? '';

  const actionable = useMemo(
    () => matchResults.filter((r) => !r.line.suggestedSkip && !r.alreadyImported),
    [matchResults],
  );
  const skippedNoise = useMemo(
    () => matchResults.filter((r) => r.line.suggestedSkip || r.alreadyImported),
    [matchResults],
  );

  const allDecided = actionable.every((r) => decisions[r.line.fingerprint]);

  const parseAndMatch = async () => {
    if (!file || !paymentMethodId) return;
    setError(null);
    setParsing(true);
    try {
      const parsed = await parseStatementPdf(file);
      setBank(parsed.bank);
      setLines(parsed.lines);
      if (parsed.lines.length === 0) {
        setError('No encontramos consumos en el PDF. Probá con otro archivo o banco.');
        return;
      }
      const match = await api<{ results: MatchResult[] }>('/statement-imports/match', {
        method: 'POST',
        body: JSON.stringify({ paymentMethodId, lines: parsed.lines }),
      });
      setMatchResults(match.results);

      const initial: Record<string, LineDecision> = {};
      for (const r of match.results) {
        if (r.line.suggestedSkip || r.alreadyImported) {
          initial[r.line.fingerprint] = { action: 'SKIP' };
        } else if (r.topMatch && r.topMatch.score >= 60) {
          initial[r.line.fingerprint] = {
            action: 'MERGE',
            matchedPurchaseId: r.topMatch.purchaseId,
            amountResolution:
              r.topMatch.amountDelta > 0.009 ? 'USE_STATEMENT' : 'KEEP_EXISTING',
          };
        } else {
          initial[r.line.fingerprint] = {
            action: 'NEW',
            categoryId: defaultCategoryId,
            scope: 'HOUSEHOLD',
          };
        }
      }
      setDecisions(initial);
      setStep('review');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo leer el resumen');
    } finally {
      setParsing(false);
    }
  };

  const commitMutation = useMutation({
    mutationFn: () => {
      const decisionList = lines.map((line) => {
        const d = decisions[line.fingerprint] ?? { action: 'SKIP' as const };
        if (d.action === 'SKIP') return { fingerprint: line.fingerprint, action: 'SKIP' as const };
        if (d.action === 'NEW') {
          return {
            fingerprint: line.fingerprint,
            action: 'NEW' as const,
            categoryId: d.categoryId,
            scope: d.scope,
            splitMode: 'EQUAL' as const,
          };
        }
        return {
          fingerprint: line.fingerprint,
          action: 'MERGE' as const,
          matchedPurchaseId: d.matchedPurchaseId,
          amountResolution: d.amountResolution,
        };
      });
      return api<{ processedCount: number; results: Array<{ status: string }> }>(
        '/statement-imports/commit',
        {
          method: 'POST',
          body: JSON.stringify({
            paymentMethodId,
            fileName: file?.name ?? 'resumen.pdf',
            bankSource: bank === 'Unknown' ? 'Unknown' : bank,
            lines,
            decisions: decisionList,
          }),
        },
      );
    },
    onSuccess: (res) => {
      const skipped = res.results.filter((r) => r.status.startsWith('SKIPPED')).length;
      setDoneSummary({ processed: res.processedCount, skipped });
      setStep('done');
      void queryClient.invalidateQueries({ queryKey: ['expenses'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : 'No se pudo guardar la importación');
    },
  });

  const setDecision = (fingerprint: string, decision: LineDecision) => {
    setDecisions((prev) => ({ ...prev, [fingerprint]: decision }));
  };

  const markAllPersonal = () => {
    setDecisions((prev) => {
      const next = { ...prev };
      for (const r of actionable) {
        const cur = next[r.line.fingerprint];
        if (cur?.action === 'NEW') {
          next[r.line.fingerprint] = { ...cur, scope: 'PERSONAL' };
        } else if (!cur) {
          next[r.line.fingerprint] = {
            action: 'NEW',
            categoryId: defaultCategoryId,
            scope: 'PERSONAL',
          };
        }
      }
      return next;
    });
  };

  return (
    <div className="page">
      <header className="page-header">
        <Link to="/ajustes" className="btn-link">
          ← Ajustes
        </Link>
        <h1>Importar resumen</h1>
      </header>

      {error && <p className="error">{error}</p>}

      {step === 'upload' && (
        <section className="card">
          <h2>1. PDF del resumen</h2>
          <p className="hint">Santander o BBVA (Visa). El archivo se lee en tu dispositivo.</p>
          <label className="file-picker">
            <input
              type="file"
              accept="application/pdf,.pdf"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                setFile(f);
                setError(null);
                if (f && methods) {
                  void f.arrayBuffer().then(async () => {
                    try {
                      const parsed = await parseStatementPdf(f);
                      const guess = guessPaymentMethodId(parsed.text, creditCards);
                      if (guess) setPaymentMethodId(guess);
                      setBank(parsed.bank);
                    } catch {
                      // ignore preview errors until explicit parse
                    }
                  });
                }
              }}
            />
            {file ? file.name : 'Elegí el PDF…'}
          </label>

          <h2>2. Tarjeta</h2>
          {creditCards.length === 0 ? (
            <p className="hint">
              Agregá una tarjeta de crédito en <Link to="/ajustes">Ajustes</Link> primero.
            </p>
          ) : (
            <select value={paymentMethodId} onChange={(e) => setPaymentMethodId(e.target.value)}>
              <option value="">Seleccioná la tarjeta…</option>
              {grouped.map((g) => (
                <optgroup key={g.entityId} label={g.entityName}>
                  {g.items.map((m) => (
                    <option key={m.id} value={m.id}>
                      {paymentMethodDisplayName(m)}
                      {m.lastFour ? ` ···${m.lastFour}` : ''}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          )}

          {bank !== 'Unknown' && <p className="hint">Banco detectado: {bank}</p>}

          <button
            type="button"
            className="btn-primary"
            disabled={!file || !paymentMethodId || parsing}
            onClick={() => void parseAndMatch()}
          >
            {parsing ? 'Leyendo…' : 'Continuar'}
          </button>
        </section>
      )}

      {step === 'review' && (
        <>
          <section className="card">
            <h2>Revisá los consumos</h2>
            <p className="hint">
              {bank} · {actionable.length} para cargar · {skippedNoise.length} omitidos
            </p>
            <div className="confirm-actions">
              <button type="button" className="btn-secondary" onClick={markAllPersonal}>
                Nuevos → personales
              </button>
              <button type="button" className="btn-link" onClick={() => setShowSkipped((v) => !v)}>
                {showSkipped ? 'Ocultar omitidos' : 'Ver omitidos'}
              </button>
            </div>
          </section>

          {actionable.map((r) => {
            const d = decisions[r.line.fingerprint];
            return (
              <StatementLineCard
                key={r.line.fingerprint}
                result={r}
                decision={d}
                categories={categories ?? []}
                onChange={(next) => setDecision(r.line.fingerprint, next)}
              />
            );
          })}

          {showSkipped &&
            skippedNoise.map((r) => (
              <div key={r.line.fingerprint} className="card statement-line muted">
                <div className="row-between">
                  <strong>{r.line.store}</strong>
                  <span>{fmtARSExact.format(r.line.amount)}</span>
                </div>
                <small>
                  {fmtDate(r.line.date)}
                  {r.alreadyImported ? ' · ya importado' : ' · omitido'}
                </small>
              </div>
            ))}

          <div className="confirm-actions sticky-actions">
            <button type="button" className="btn-secondary" onClick={() => setStep('upload')}>
              Atrás
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={!allDecided || commitMutation.isPending || !defaultCategoryId}
              onClick={() => commitMutation.mutate()}
            >
              {commitMutation.isPending ? 'Guardando…' : 'Confirmar importación'}
            </button>
          </div>
        </>
      )}

      {step === 'done' && doneSummary && (
        <section className="card">
          <h2>Listo</h2>
          <p>
            Se procesaron <strong>{doneSummary.processed}</strong> consumos
            {doneSummary.skipped ? ` (${doneSummary.skipped} omitidos)` : ''}.
          </p>
          <div className="confirm-actions">
            <button type="button" className="btn-primary" onClick={() => navigate('/gastos')}>
              Ver gastos
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setStep('upload');
                setFile(null);
                setLines([]);
                setMatchResults([]);
                setDecisions({});
                setDoneSummary(null);
              }}
            >
              Importar otro
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

function StatementLineCard({
  result,
  decision,
  categories,
  onChange,
}: {
  result: MatchResult;
  decision: LineDecision | undefined;
  categories: Category[];
  onChange: (d: LineDecision) => void;
}) {
  const { line, topMatch, candidates } = result;
  const mode = decision?.action ?? 'NEW';
  const existingAmount =
    topMatch?.installmentAmount ?? topMatch?.netAmount ?? candidates[0]?.installmentAmount ?? candidates[0]?.netAmount;
  const amountDiffers =
    decision?.action === 'MERGE' &&
    existingAmount != null &&
    Math.abs(existingAmount - line.amount) > 0.009;

  return (
    <section className="card statement-line">
      <div className="row-between">
        <div>
          <strong>{line.store}</strong>
          <div className="hint">
            {fmtDate(line.date)}
            {line.installment ? ` · Cuota ${line.installment.current} de ${line.installment.total}` : ''}
          </div>
        </div>
        <strong>{fmtARSExact.format(line.amount)}</strong>
      </div>

      <div className="segmented">
        <button
          type="button"
          className={mode === 'NEW' ? 'active' : ''}
          onClick={() =>
            onChange({
              action: 'NEW',
              categoryId:
                decision?.action === 'NEW' ? decision.categoryId : (categories.find((c) => c.name === 'Otros')?.id ?? categories[0]?.id ?? ''),
              scope: decision?.action === 'NEW' ? decision.scope : 'HOUSEHOLD',
            })
          }
        >
          Nuevo
        </button>
        <button
          type="button"
          className={mode === 'MERGE' ? 'active' : ''}
          disabled={!topMatch && candidates.length === 0}
          onClick={() => {
            const match = topMatch ?? candidates[0];
            if (!match) return;
            onChange({
              action: 'MERGE',
              matchedPurchaseId: match.purchaseId,
              amountResolution:
                decision?.action === 'MERGE' ? decision.amountResolution : 'USE_STATEMENT',
            });
          }}
        >
          Fusionar
        </button>
        <button type="button" className={mode === 'SKIP' ? 'active' : ''} onClick={() => onChange({ action: 'SKIP' })}>
          Omitir
        </button>
      </div>

      {decision?.action === 'NEW' && (
        <>
          <div className="segmented">
            <button
              type="button"
              className={decision.scope === 'HOUSEHOLD' ? 'active' : ''}
              onClick={() => onChange({ ...decision, scope: 'HOUSEHOLD' })}
            >
              Hogar
            </button>
            <button
              type="button"
              className={decision.scope === 'PERSONAL' ? 'active' : ''}
              onClick={() => onChange({ ...decision, scope: 'PERSONAL' })}
            >
              Personal
            </button>
          </div>
          <div className="category-grid">
            {categories.map((cat) => (
              <button
                key={cat.id}
                type="button"
                className={`category-chip ${decision.categoryId === cat.id ? 'selected' : ''}`}
                onClick={() => onChange({ ...decision, categoryId: cat.id })}
              >
                {cat.icon && <span className="chip-icon">{cat.icon}</span>}
                {cat.name}
              </button>
            ))}
          </div>
        </>
      )}

      {decision?.action === 'MERGE' && (topMatch || candidates[0]) && (
        <div className="merge-box">
          <p className="hint">
            Coincide con <strong>{(topMatch ?? candidates[0])!.store}</strong> (
            {fmtDate((topMatch ?? candidates[0])!.purchaseDate)})
            {existingAmount != null && <> · cargado {fmtARSExact.format(existingAmount)}</>}
          </p>
          {amountDiffers && (
            <div className="segmented">
              <button
                type="button"
                className={decision.amountResolution === 'USE_STATEMENT' ? 'active' : ''}
                onClick={() => onChange({ ...decision, amountResolution: 'USE_STATEMENT' })}
              >
                Monto del resumen
              </button>
              <button
                type="button"
                className={decision.amountResolution === 'KEEP_EXISTING' ? 'active' : ''}
                onClick={() => onChange({ ...decision, amountResolution: 'KEEP_EXISTING' })}
              >
                Monto cargado
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
