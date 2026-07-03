type BrandLogoProps = {
  className?: string;
  size?: 'sm' | 'md' | 'lg';
};

const sizeClass = {
  sm: 'brand-logo-sm',
  md: 'brand-logo-md',
  lg: 'brand-logo-lg',
} as const;

export default function BrandLogo({ className, size = 'md' }: BrandLogoProps) {
  return (
    <img
      src="/logo.png"
      alt="Biko"
      className={['brand-logo', sizeClass[size], className].filter(Boolean).join(' ')}
    />
  );
}
