import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router-dom';
import Icon from './Icon';

interface CommonProps {
  icon: string;
  label: string;
  tonal?: boolean;
  className?: string;
  children?: ReactNode;
}

type IconButtonAsButton = CommonProps &
  ButtonHTMLAttributes<HTMLButtonElement> & {
    to?: undefined;
  };

type IconButtonAsLink = CommonProps &
  Omit<LinkProps, 'className' | 'children' | 'aria-label'> & {
    to: string;
  };

export type IconButtonProps = IconButtonAsButton | IconButtonAsLink;

export default function IconButton(props: IconButtonProps) {
  const { icon, label, tonal, className = '', children, ...rest } = props;
  const classes = [
    'md-icon-btn',
    'md-state',
    tonal ? 'md-icon-btn-tonal' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const content = (
    <>
      <Icon name={icon} />
      {children}
    </>
  );

  if ('to' in props && props.to) {
    const { to, ...linkRest } = rest as IconButtonAsLink;
    return (
      <Link to={to} className={classes} aria-label={label} {...linkRest}>
        {content}
      </Link>
    );
  }

  const buttonRest = rest as ButtonHTMLAttributes<HTMLButtonElement>;
  return (
    <button type={buttonRest.type ?? 'button'} className={classes} aria-label={label} {...buttonRest}>
      {content}
    </button>
  );
}
