interface ChartTooltipProps {
  title: string;
  value: string;
  meta?: string;
  onDismiss?: () => void;
}

export default function ChartTooltip({ title, value, meta, onDismiss }: ChartTooltipProps) {
  return (
    <div className="chart-tooltip" role="status">
      <span className="chart-tooltip-title">{title}</span>
      <strong className="chart-tooltip-value">{value}</strong>
      {meta ? <span className="chart-tooltip-meta">{meta}</span> : null}
      {onDismiss ? (
        <button type="button" className="chart-tooltip-dismiss" onClick={onDismiss}>
          Cerrar
        </button>
      ) : null}
    </div>
  );
}
