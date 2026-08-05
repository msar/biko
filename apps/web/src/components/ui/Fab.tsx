import type { AnchorHTMLAttributes, ButtonHTMLAttributes } from 'react';
import { Link, type LinkProps } from 'react-router-dom';
import Icon from './Icon';

interface CommonProps {
  icon?: string;
  primary?: boolean;
  className?: string;
  'aria-label': string;
}

type FabAsButton = CommonProps &
  ButtonHTMLAttributes<HTMLButtonElement> & {
    to?: undefined;
  };

type FabAsLink = CommonProps &
  Omit<LinkProps, 'className' | 'aria-label'> & {
    to: string;
  };

type FabAsAnchor = CommonProps &
  AnchorHTMLAttributes<HTMLAnchorElement> & {
    to?: undefined;
    href: string;
  };

export type FabProps = FabAsButton | FabAsLink | FabAsAnchor;

export default function Fab(props: FabProps) {
  const { icon = 'add', primary = true, className = '', ...rest } = props;
  const classes = ['md-fab', 'md-state', primary ? 'md-fab-primary' : '', className]
    .filter(Boolean)
    .join(' ');

  const content = <Icon name={icon} size="lg" />;

  if ('to' in props && props.to) {
    const { to, ...linkRest } = rest as FabAsLink;
    return (
      <Link to={to} className={classes} {...linkRest}>
        {content}
      </Link>
    );
  }

  if ('href' in props && props.href) {
    const anchorRest = rest as FabAsAnchor;
    return (
      <a className={classes} {...anchorRest}>
        {content}
      </a>
    );
  }

  const buttonRest = rest as ButtonHTMLAttributes<HTMLButtonElement>;
  return (
    <button type={buttonRest.type ?? 'button'} className={classes} {...buttonRest}>
      {content}
    </button>
  );
}
