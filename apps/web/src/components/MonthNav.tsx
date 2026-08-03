interface MonthNavProps {
  label: string;
  onPrev: () => void;
  onNext: () => void;
}

export default function MonthNav({ label, onPrev, onNext }: MonthNavProps) {
  return (
    <div className="month-nav" aria-label="Mes">
      <button type="button" onClick={onPrev} aria-label="Mes anterior">
        ‹
      </button>
      <span>{label}</span>
      <button type="button" onClick={onNext} aria-label="Mes siguiente">
        ›
      </button>
    </div>
  );
}
