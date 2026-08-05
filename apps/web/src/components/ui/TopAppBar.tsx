import type { ReactNode } from 'react';

interface TopAppBarProps {
  leading?: ReactNode;
  title?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

export default function TopAppBar({ leading, title, actions, className = '' }: TopAppBarProps) {
  return (
    <header className={`md-top-app-bar app-header${className ? ` ${className}` : ''}`}>
      <div className="md-top-app-bar-leading" style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        {leading}
        {title}
      </div>
      {actions && <div className="md-top-app-bar-actions app-header-actions">{actions}</div>}
    </header>
  );
}
