import type { ButtonHTMLAttributes, ReactNode } from 'react';

interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  selected?: boolean;
  assist?: boolean;
  children: ReactNode;
}

export default function Chip({
  selected,
  assist,
  className = '',
  children,
  type = 'button',
  ...rest
}: ChipProps) {
  const classes = [
    'md-chip',
    'md-state',
    selected ? 'md-chip-selected' : '',
    assist ? 'md-chip-assist' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button type={type} className={classes} aria-pressed={selected} {...rest}>
      {children}
    </button>
  );
}
