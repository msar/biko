import type { ReactNode } from 'react';

export interface SegmentedOption<T extends string> {
  id: T;
  label: ReactNode;
  disabled?: boolean;
}

interface SegmentedButtonProps<T extends string> {
  options: Array<SegmentedOption<T>>;
  value: T;
  onChange: (value: T) => void;
  label?: string;
  className?: string;
  wrap?: boolean;
}

export default function SegmentedButton<T extends string>({
  options,
  value,
  onChange,
  label,
  className = '',
  wrap,
}: SegmentedButtonProps<T>) {
  return (
    <div
      className={`md-segmented${wrap ? ' md-segmented-wrap' : ''}${className ? ` ${className}` : ''}`}
      role="tablist"
      aria-label={label}
    >
      {options.map((opt) => (
        <button
          key={opt.id}
          type="button"
          role="tab"
          aria-selected={value === opt.id}
          disabled={opt.disabled}
          className={`md-segmented-btn md-state${value === opt.id ? ' md-segmented-btn-active' : ''}`}
          onClick={() => onChange(opt.id)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
