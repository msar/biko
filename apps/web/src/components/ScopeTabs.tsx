import type { DashboardScope } from '../lib/types';
import { SegmentedButton } from './ui';

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
    <SegmentedButton
      options={SCOPES}
      value={value}
      onChange={onChange}
      label="Alcance"
      className={`dashboard-scope${className ? ` ${className}` : ''}`}
    />
  );
}
