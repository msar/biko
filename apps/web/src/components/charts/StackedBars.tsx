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
  height?: number;
}

const MONTH_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function shortMonth(month: string): string {
  const [, m] = month.split('-').map(Number);
  return MONTH_SHORT[(m ?? 1) - 1] ?? month;
}

export default function StackedBars({ months, series, formatValue, height = 150 }: StackedBarsProps) {
  const totals = months.map((_, i) => series.reduce((sum, s) => sum + (s.values[i] ?? 0), 0));
  const max = Math.max(1, ...totals);

  return (
    <div className="chart">
      <div className="chart-cols" style={{ height }}>
        {months.map((month, i) => {
          const total = totals[i] ?? 0;
          return (
            <div key={month} className="chart-col">
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
            </div>
          );
        })}
      </div>
    </div>
  );
}
