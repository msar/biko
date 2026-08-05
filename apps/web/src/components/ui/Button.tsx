import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router-dom';

type Variant = 'filled' | 'tonal' | 'outlined' | 'text' | 'danger' | 'danger-text';

interface CommonProps {
  variant?: Variant;
  block?: boolean;
  size?: 'sm' | 'md';
  children: ReactNode;
  className?: string;
}

type ButtonAsButton = CommonProps &
  ButtonHTMLAttributes<HTMLButtonElement> & {
    to?: undefined;
  };

type ButtonAsLink = CommonProps &
  Omit<LinkProps, 'className' | 'children'> & {
    to: string;
    disabled?: boolean;
  };

export type ButtonProps = ButtonAsButton | ButtonAsLink;

function variantClass(variant: Variant): string {
  switch (variant) {
    case 'tonal':
      return 'md-btn-tonal';
    case 'outlined':
      return 'md-btn-outlined';
    case 'text':
      return 'md-btn-text';
    case 'danger':
      return 'md-btn-danger';
    case 'danger-text':
      return 'md-btn-danger-text';
    default:
      return 'md-btn-filled';
  }
}

export default function Button(props: ButtonProps) {
  const {
    variant = 'filled',
    block,
    size = 'md',
    children,
    className = '',
    ...rest
  } = props;

  const classes = [
    'md-btn',
    'md-state',
    variantClass(variant),
    block ? 'md-btn-block' : '',
    size === 'sm' ? 'md-btn-sm' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  if ('to' in props && props.to) {
    const { to, disabled, ...linkRest } = rest as ButtonAsLink;
    if (disabled) {
      return (
        <button type="button" className={classes} disabled>
          {children}
        </button>
      );
    }
    return (
      <Link to={to} className={classes} {...linkRest}>
        {children}
      </Link>
    );
  }

  const buttonRest = rest as ButtonHTMLAttributes<HTMLButtonElement>;
  return (
    <button type={buttonRest.type ?? 'button'} className={classes} {...buttonRest}>
      {children}
    </button>
  );
}
