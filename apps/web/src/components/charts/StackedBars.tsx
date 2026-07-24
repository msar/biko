interface Series {
  id: string;
  name: string;
  color: string;
  values: number[];
}

interface StackedBarsProps {
  months: string[];
  series: Series[];
  formatValue?: (n: number) => string;
  /** Shorter labels above bars (e.g. "$689k"). Falls back to formatValue. */
  formatCompact?: (n: number) => string;
  height?: number;
  selectedMonth?: string | null;
  onMonthSelect?: (month: string) => void;
  showValues?: boolean;
}

const MONTH_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

export function shortMonth(month: string): string {
  const [, m] = month.split('-').map(Number);
  return MONTH_SHORT[(m ?? 1) - 1] ?? month;
}

export default function StackedBars({
  months,
  series,
  formatValue,
  formatCompact,
  height = 150,
  selectedMonth = null,
  onMonthSelect,
  showValues = false,
}: StackedBarsProps) {
  const totals = months.map((_, i) => series.reduce((sum, s) => sum + (s.values[i] ?? 0), 0));
  const max = Math.max(1, ...totals);
  const interactive = typeof onMonthSelect === 'function';
  const labelFn = formatCompact ?? formatValue;

  return (
    <div className={`chart${interactive ? ' chart-interactive' : ''}`}>
      <div className="chart-cols" style={{ height }}>
        {months.map((month, i) => {
          const total = totals[i] ?? 0;
          const selected = selectedMonth === month;
          const dimmed = selectedMonth != null && !selected;
          const className = `chart-col${selected ? ' selected' : ''}${dimmed ? ' dimmed' : ''}`;
          const title = formatValue ? formatValue(total) : undefined;

          const inner = (
            <>
              {showValues && total > 0 && labelFn && <span className="chart-value">{labelFn(total)}</span>}
              <div className="chart-bar" style={{ height: `${(total / max) * 100}%` }}>
                {series.map((s) => {
                  const value = s.values[i] ?? 0;
                  if (value <= 0) return null;
                  return (
                    <div
                      key={s.id}
                      className="chart-seg"
                      style={{ flexGrow: value, background: s.color }}
                      title={`${s.name}: ${formatValue ? formatValue(value) : value}`}
                    />
                  );
                })}
              </div>
              <span className="chart-x">{shortMonth(month)}</span>
            </>
          );

          if (interactive) {
            return (
              <button
                key={month}
                type="button"
                className={className}
                onClick={() => onMonthSelect(month)}
                aria-pressed={selected}
                title={title}
              >
                {inner}
              </button>
            );
          }

          return (
            <div key={month} className={className} title={title}>
              {inner}
            </div>
          );
        })}
      </div>
    </div>
  );
}
