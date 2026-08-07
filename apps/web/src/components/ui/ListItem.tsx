import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router-dom';

interface CommonProps {
  title: ReactNode;
  support?: ReactNode;
  trailing?: ReactNode;
  leading?: ReactNode;
  className?: string;
}

type ListItemAsButton = CommonProps &
  ButtonHTMLAttributes<HTMLButtonElement> & {
    to?: undefined;
  };

type ListItemAsLink = CommonProps &
  Omit<LinkProps, 'className' | 'children'> & {
    to: string;
  };

type ListItemAsDiv = CommonProps & {
  to?: undefined;
  onClick?: undefined;
};

export type ListItemProps = ListItemAsButton | ListItemAsLink | ListItemAsDiv;

export default function ListItem(props: ListItemProps) {
  const { title, support, trailing, leading, className = '', ...rest } = props;
  const classes = `md-list-item md-state${className ? ` ${className}` : ''}`;

  const body = (
    <>
      {leading}
      <div className="md-list-item-body">
        <span className="md-list-item-title">{title}</span>
        {/* div: support may contain block checklist markup (invalid inside span) */}
        {support != null && <div className="md-list-item-support">{support}</div>}
      </div>
      {trailing != null && <div className="md-list-item-trailing">{trailing}</div>}
    </>
  );

  if ('to' in props && props.to) {
    const { to, ...linkRest } = rest as ListItemAsLink;
    return (
      <Link to={to} className={classes} {...linkRest}>
        {body}
      </Link>
    );
  }

  if ('onClick' in props && props.onClick) {
    const buttonRest = rest as ButtonHTMLAttributes<HTMLButtonElement>;
    return (
      <button type="button" className={classes} {...buttonRest}>
        {body}
      </button>
    );
  }

  return <div className={classes.replace(' md-state', '')}>{body}</div>;
}
