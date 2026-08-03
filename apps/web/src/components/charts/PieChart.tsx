interface Slice {
  id: string;
  name: string;
  color: string;
  value: number;
}

interface PieChartProps {
  slices: Slice[];
  formatValue?: (n: number) => string;
  size?: number;
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
}

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

/** Donut slice between outerR and innerR. */
function describeDonutSlice(
  cx: number,
  cy: number,
  outerR: number,
  innerR: number,
  startAngle: number,
  endAngle: number,
) {
  const outerStart = polarToCartesian(cx, cy, outerR, endAngle);
  const outerEnd = polarToCartesian(cx, cy, outerR, startAngle);
  const innerStart = polarToCartesian(cx, cy, innerR, endAngle);
  const innerEnd = polarToCartesian(cx, cy, innerR, startAngle);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  return [
    `M ${outerEnd.x} ${outerEnd.y}`,
    `A ${outerR} ${outerR} 0 ${largeArc} 1 ${outerStart.x} ${outerStart.y}`,
    `L ${innerStart.x} ${innerStart.y}`,
    `A ${innerR} ${innerR} 0 ${largeArc} 0 ${innerEnd.x} ${innerEnd.y}`,
    'Z',
  ].join(' ');
}

export default function PieChart({
  slices,
  formatValue,
  size = 180,
  selectedId = null,
  onSelect,
}: PieChartProps) {
  const total = slices.reduce((sum, s) => sum + s.value, 0);
  if (total <= 0) {
    return <p className="empty-state">Sin datos para este período</p>;
  }

  const cx = size / 2;
  const cy = size / 2;
  const outerR = size / 2 - 2;
  const innerR = outerR * 0.58;
  let angle = 0;

  const paths = slices
    .filter((s) => s.value > 0)
    .map((s) => {
      const sweep = (s.value / total) * 360;
      const start = angle;
      const end = Math.min(angle + sweep, 359.999);
      angle += sweep;
      const path =
        sweep >= 359.99
          ? describeDonutSlice(cx, cy, outerR, innerR, 0, 359.999)
          : describeDonutSlice(cx, cy, outerR, innerR, start, end);
      return { ...s, path, pct: (s.value / total) * 100 };
    });

  const selected = selectedId ? paths.find((p) => p.id === selectedId) : null;
  const centerLabel = selected ? selected.name : 'Total';
  const centerValue = selected ? selected.value : total;
  const centerPct = selected ? `${selected.pct.toFixed(0)}%` : null;
  const interactive = typeof onSelect === 'function';

  const ariaSummary = paths
    .map((p) => `${p.name}: ${formatValue ? formatValue(p.value) : p.value} (${p.pct.toFixed(0)}%)`)
    .join(', ');

  return (
    <div
      className="pie-chart"
      style={{ width: size, height: size }}
      role="img"
      aria-label={`Distribución por grupo. ${ariaSummary}`}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="pie-chart-svg">
        {paths.map((p) => {
          const isSelected = selectedId === p.id;
          const dimmed = selectedId != null && !isSelected;
          return (
            <path
              key={p.id}
              d={p.path}
              fill={p.color}
              stroke="#fff"
              strokeWidth={1.5}
              className={`pie-chart-slice${isSelected ? ' selected' : ''}${dimmed ? ' dimmed' : ''}`}
              tabIndex={interactive ? 0 : undefined}
              role={interactive ? 'button' : undefined}
              aria-pressed={interactive ? isSelected : undefined}
              aria-label={`${p.name}: ${formatValue ? formatValue(p.value) : p.value} (${p.pct.toFixed(0)}%)`}
              onClick={() => {
                if (!onSelect) return;
                onSelect(isSelected ? null : p.id);
              }}
              onKeyDown={(e) => {
                if (!onSelect) return;
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelect(isSelected ? null : p.id);
                }
              }}
            />
          );
        })}
      </svg>
      <div className="pie-chart-center">
        <span className="pie-chart-total-label">{centerLabel}</span>
        <strong className="pie-chart-total">{formatValue ? formatValue(centerValue) : centerValue}</strong>
        {centerPct ? <span className="pie-chart-pct">{centerPct}</span> : null}
      </div>
    </div>
  );
}
