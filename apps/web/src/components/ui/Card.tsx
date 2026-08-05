import type { HTMLAttributes, ReactNode } from 'react';

type CardVariant = 'outlined' | 'elevated' | 'filled';

interface CardProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  variant?: CardVariant;
  title?: ReactNode;
  as?: 'section' | 'div' | 'article';
  children: ReactNode;
}

export function Card({
  variant = 'outlined',
  title,
  as: Tag = 'section',
  className = '',
  children,
  ...rest
}: CardProps) {
  const variantClass =
    variant === 'elevated' ? 'md-card-elevated' : variant === 'filled' ? '' : 'md-card-outlined';
  return (
    <Tag className={`md-card ${variantClass}${className ? ` ${className}` : ''}`} {...rest}>
      {title != null && <h2 className="md-card-title">{title}</h2>}
      {children}
    </Tag>
  );
}

interface SurfaceProps extends HTMLAttributes<HTMLDivElement> {
  tone?: 'default' | 'tonal' | 'primary' | 'primary-container';
  children: ReactNode;
}

export function Surface({ tone = 'default', className = '', children, ...rest }: SurfaceProps) {
  const toneClass =
    tone === 'tonal'
      ? 'md-surface-tonal'
      : tone === 'primary'
        ? 'md-surface-primary'
        : tone === 'primary-container'
          ? 'md-surface-primary-container'
          : '';
  return (
    <div className={`md-surface ${toneClass}${className ? ` ${className}` : ''}`} {...rest}>
      {children}
    </div>
  );
}

interface HeroCardProps extends HTMLAttributes<HTMLElement> {
  label: ReactNode;
  amount: ReactNode;
  children?: ReactNode;
}

export function HeroCard({ label, amount, className = '', children, ...rest }: HeroCardProps) {
  return (
    <section className={`md-hero hero-card${className ? ` ${className}` : ''}`} {...rest}>
      <span className="md-hero-label hero-label">{label}</span>
      <span className="md-hero-amount hero-amount">{amount}</span>
      {children}
    </section>
  );
}

export default Card;
