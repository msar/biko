import type { DashboardScope } from '../lib/types';

const SCOPES: Array<{ id: DashboardScope; label: string }> = [
  { id: 'household', label: 'Hogar' },
  { id: 'personal', label: 'Personal' },
  { id: 'all', label: 'Todo' },
];

interface ScopeTabsProps {
  value: DashboardScope;
  onChange: (scope: DashboardScope) => void;
  className?: string;
}

export default function ScopeTabs({ value, onChange, className }: ScopeTabsProps) {
  return (
    <div className={`segmented dashboard-scope${className ? ` ${className}` : ''}`} role="tablist" aria-label="Alcance">
      {SCOPES.map((s) => (
        <button
          key={s.id}
          type="button"
          role="tab"
          aria-selected={value === s.id}
          className={value === s.id ? 'active' : ''}
          onClick={() => onChange(s.id)}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}
