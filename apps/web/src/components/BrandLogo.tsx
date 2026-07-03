type BrandMarkProps = {
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  showWordmark?: boolean;
};

const sizeClass = {
  sm: 'brand-logo-sm',
  md: 'brand-logo-md',
  lg: 'brand-logo-lg',
} as const;

export default function BrandMark({ className, size = 'md', showWordmark = false }: BrandMarkProps) {
  return (
    <div
      className={['brand-mark', size === 'lg' && 'brand-mark-lg', className].filter(Boolean).join(' ')}
    >
      <img
        src="/logo.png"
        alt=""
        aria-hidden
        className={['brand-logo', sizeClass[size]].join(' ')}
      />
      {showWordmark && <span className="brand-wordmark">Biko</span>}
    </div>
  );
}

/** @deprecated Use BrandMark */
export function BrandLogo(props: Omit<BrandMarkProps, 'showWordmark'>) {
  return <BrandMark {...props} />;
}
