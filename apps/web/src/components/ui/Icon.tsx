import type { HTMLAttributes } from 'react';

export type IconName =
  | 'monitoring'
  | 'receipt_long'
  | 'local_offer'
  | 'more_horiz'
  | 'add'
  | 'notifications'
  | 'notifications_none'
  | 'close'
  | 'arrow_back'
  | 'chevron_right'
  | 'chevron_left'
  | 'check'
  | 'delete'
  | 'edit'
  | 'flight'
  | 'home'
  | 'person'
  | 'settings'
  | 'inbox'
  | 'info'
  | 'warning'
  | 'savings'
  | 'calendar_month'
  | 'account_balance_wallet'
  | 'group'
  | 'luggage'
  | 'list_alt'
  | 'hotel'
  | 'payments';

interface IconProps extends HTMLAttributes<HTMLSpanElement> {
  name: IconName | string;
  size?: 'sm' | 'md' | 'lg';
  filled?: boolean;
}

export default function Icon({ name, size = 'md', filled, className = '', ...rest }: IconProps) {
  const sizeClass = size === 'sm' ? 'ms-icon-sm' : size === 'lg' ? 'ms-icon-lg' : 'ms-icon-md';
  return (
    <span
      className={`material-symbols-outlined ${sizeClass}${filled ? ' filled' : ''}${className ? ` ${className}` : ''}`}
      aria-hidden={rest['aria-label'] ? undefined : true}
      {...rest}
    >
      {name}
    </span>
  );
}
