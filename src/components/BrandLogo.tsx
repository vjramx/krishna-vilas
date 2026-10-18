export function BrandLogo({ size = 40, className = '', decorative = true }: { size?: number; className?: string; decorative?: boolean }) {
  return (
    <img
      src="/icon-192.png"
      width={size}
      height={size}
      alt={decorative ? '' : 'Krishna Vilas'}
      aria-hidden={decorative ? true : undefined}
      className={`shrink-0 rounded-xl object-cover ${className}`}
    />
  );
}
