import type { KeyboardEvent, MouseEvent } from 'react';

interface Series {
  id: string;
  name: string;
  color: string;
  values: number[];
}

export interface SegmentSelectPayload {
  month: string;
  seriesId: string;
  seriesName: string;
  value: number;
  monthTotal: number;
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
  selectedSeriesId?: string | null;
  onSegmentSelect?: (payload: SegmentSelectPayload) => void;
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
  selectedSeriesId = null,
  onSegmentSelect,
  showValues = false,
}: StackedBarsProps) {
  const totals = months.map((_, i) => series.reduce((sum, s) => sum + (s.values[i] ?? 0), 0));
  const max = Math.max(1, ...totals);
  const interactive = typeof onMonthSelect === 'function';
  const multiSeries = series.length > 1;
  const segmentInteractive = typeof onSegmentSelect === 'function' && multiSeries;
  const labelFn = formatCompact ?? formatValue;
  const selectedIdx = selectedMonth ? months.indexOf(selectedMonth) : -1;
  const selectedTotal = selectedIdx >= 0 ? (totals[selectedIdx] ?? 0) : 0;
  const callout =
    selectedMonth && selectedTotal > 0 && labelFn
      ? `${shortMonth(selectedMonth)} · ${labelFn(selectedTotal)}`
      : null;
  const calloutLeft =
    selectedIdx >= 0 && months.length > 0 ? `${((selectedIdx + 0.5) / months.length) * 100}%` : '50%';

  const handleSegmentClick = (e: MouseEvent, month: string, s: Series, value: number, monthTotal: number) => {
    if (!onSegmentSelect || !multiSeries) return;
    e.stopPropagation();
    onSegmentSelect({
      month,
      seriesId: s.id,
      seriesName: s.name,
      value,
      monthTotal,
    });
  };

  return (
    <div className={`chart${interactive ? ' chart-interactive' : ''}`}>
      {callout && (
        <div className="chart-callout" style={{ left: calloutLeft }}>
          {callout}
        </div>
      )}
      <div className="chart-cols" style={{ height }}>
        {months.map((month, i) => {
          const total = totals[i] ?? 0;
          const selected = selectedMonth === month;
          const dimmed = selectedMonth != null && !selected;
          const seriesDimmed = selectedSeriesId != null;
          const className = `chart-col${selected ? ' selected' : ''}${dimmed ? ' dimmed' : ''}${
            seriesDimmed ? ' series-dimmed' : ''
          }`;
          const ariaLabel = formatValue
            ? `${shortMonth(month)}: ${formatValue(total)}`
            : shortMonth(month);

          const segments = (
            <div className="chart-bar" style={{ height: `${(total / max) * 100}%` }}>
              {series.map((s) => {
                const value = s.values[i] ?? 0;
                if (value <= 0) return null;
                const segActive = selectedSeriesId === s.id;
                if (segmentInteractive) {
                  return (
                    <div
                      key={s.id}
                      className={`chart-seg${segActive ? ' active' : ''}`}
                      style={{ flexGrow: value, background: s.color }}
                      role="button"
                      tabIndex={0}
                      aria-label={formatValue ? `${s.name}: ${formatValue(value)}` : s.name}
                      onClick={(e) => handleSegmentClick(e, month, s, value, total)}
                      onKeyDown={(e: KeyboardEvent) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          e.stopPropagation();
                          onSegmentSelect?.({
                            month,
                            seriesId: s.id,
                            seriesName: s.name,
                            value,
                            monthTotal: total,
                          });
                        }
                      }}
                    />
                  );
                }
                return (
                  <div
                    key={s.id}
                    className={`chart-seg${segActive ? ' active' : ''}`}
                    style={{ flexGrow: value, background: s.color }}
                  />
                );
              })}
            </div>
          );

          const valueLabel =
            showValues && total > 0 && labelFn ? (
              <span className={`chart-value${selectedMonth ? ' is-callout' : ''}`}>{labelFn(total)}</span>
            ) : null;

          if (interactive && segmentInteractive) {
            return (
              <div
                key={month}
                className={className}
                role="button"
                tabIndex={0}
                aria-pressed={selected}
                aria-label={ariaLabel}
                onClick={() => onMonthSelect(month)}
                onKeyDown={(e: KeyboardEvent) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onMonthSelect(month);
                  }
                }}
              >
                {valueLabel}
                {segments}
                <span className="chart-x">{shortMonth(month)}</span>
              </div>
            );
          }

          if (interactive) {
            return (
              <button
                key={month}
                type="button"
                className={className}
                onClick={() => onMonthSelect(month)}
                aria-pressed={selected}
                aria-label={ariaLabel}
              >
                {valueLabel}
                {segments}
                <span className="chart-x">{shortMonth(month)}</span>
              </button>
            );
          }

          return (
            <div key={month} className={className} aria-label={ariaLabel}>
              {valueLabel}
              {segments}
              <span className="chart-x">{shortMonth(month)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
