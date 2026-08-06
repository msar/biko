import { useId } from 'react';

/** Apple Weather–inspired icons mapped from Open-Meteo WMO weather codes. */

export type WeatherIconKind =
  | 'clear'
  | 'partly'
  | 'cloudy'
  | 'fog'
  | 'drizzle'
  | 'rain'
  | 'snow'
  | 'storm';

export function weatherKindFromCode(code: number): WeatherIconKind {
  if (code === 0) return 'clear';
  if (code <= 2) return 'partly';
  if (code <= 3) return 'cloudy';
  if (code <= 48) return 'fog';
  if (code <= 57) return 'drizzle';
  if (code <= 67) return 'rain';
  if (code <= 77) return 'snow';
  if (code <= 82) return 'rain';
  if (code <= 86) return 'snow';
  if (code <= 99) return 'storm';
  return 'cloudy';
}

type Props = {
  code?: number;
  kind?: WeatherIconKind;
  size?: number;
  className?: string;
  title?: string;
};

function Sun({ size, uid }: { size: number; uid: string }) {
  const gid = `${uid}-sun`;
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <defs>
        <radialGradient id={gid} cx="38%" cy="35%" r="60%">
          <stop offset="0%" stopColor="#ffe08a" />
          <stop offset="45%" stopColor="#ffb020" />
          <stop offset="100%" stopColor="#f08a00" />
        </radialGradient>
      </defs>
      <path
        fill={`url(#${gid})`}
        d="M32 6c3.2 0 5.2 2.8 7.8 4.2 2.7 1.5 6.2.6 8.2 2.8 2 2.1 1.2 5.6 2.6 8.3C52.2 24.1 55 26.2 55 29.5c0 3.2-2.8 5.2-4.2 7.8-1.5 2.7-.6 6.2-2.8 8.2-2.1 2-5.6 1.2-8.3 2.6C36.9 50.7 34.8 53.5 31.5 53.5c-3.2 0-5.2-2.8-7.8-4.2-2.7-1.5-6.2-.6-8.2-2.8-2-2.1-1.2-5.6-2.6-8.3C11.3 35.4 8.5 33.3 8.5 30c0-3.2 2.8-5.2 4.2-7.8 1.5-2.7.6-6.2 2.8-8.2 2.1-2 5.6-1.2 8.3-2.6C26.6 9.8 28.7 7 32 7Z"
      />
    </svg>
  );
}

function Cloud({ size, uid, dimmed }: { size: number; uid: string; dimmed?: boolean }) {
  const gid = `${uid}-cloud${dimmed ? '-d' : ''}`;
  const fill = dimmed ? '#aeb6c2' : '#f2f4f7';
  const shade = dimmed ? '#8e97a6' : '#c5ccd6';
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={fill} />
          <stop offset="100%" stopColor={shade} />
        </linearGradient>
      </defs>
      <ellipse cx="28" cy="36" rx="16" ry="12" fill={`url(#${gid})`} />
      <ellipse cx="40" cy="38" rx="14" ry="11" fill={`url(#${gid})`} />
      <ellipse cx="34" cy="30" rx="11" ry="9" fill={fill} />
    </svg>
  );
}

function RainDrops({ size, light }: { size: number; light?: boolean }) {
  const n = light ? 3 : 4;
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      {Array.from({ length: n }, (_, i) => (
        <path
          key={i}
          d={`M${18 + i * 10} 46 q2 6 0 10 q-2-4 0-10z`}
          fill="#5b9fd4"
          opacity={0.85}
        />
      ))}
    </svg>
  );
}

function SnowFlakes({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      {[20, 32, 44].map((x, i) => (
        <circle key={i} cx={x} cy={48 + (i % 2) * 4} r="2.5" fill="#e8f2ff" />
      ))}
    </svg>
  );
}

function Bolt({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <path fill="#ffd54a" d="M34 38 28 54h6l-2 10 14-20h-8l6-16z" />
    </svg>
  );
}

export function WeatherIcon({ code, kind, size = 40, className, title }: Props) {
  const uid = useId().replace(/:/g, '');
  const resolved = kind ?? weatherKindFromCode(code ?? 0);

  return (
    <span
      className={className}
      title={title}
      style={{
        display: 'inline-grid',
        placeItems: 'center',
        width: size,
        height: size,
        position: 'relative',
        flexShrink: 0,
      }}
    >
      {resolved === 'clear' && <Sun size={size} uid={uid} />}
      {resolved === 'partly' && (
        <>
          <span style={{ position: 'absolute', inset: 0, transform: 'translate(-6%, -10%) scale(0.78)' }}>
            <Sun size={size} uid={`${uid}a`} />
          </span>
          <span style={{ position: 'absolute', inset: 0, transform: 'translate(8%, 18%) scale(0.72)' }}>
            <Cloud size={size} uid={`${uid}b`} />
          </span>
        </>
      )}
      {(resolved === 'cloudy' || resolved === 'fog') && (
        <Cloud size={size} uid={uid} dimmed={resolved === 'fog'} />
      )}
      {resolved === 'drizzle' && (
        <>
          <span style={{ position: 'absolute', inset: 0, transform: 'translateY(-8%) scale(0.85)' }}>
            <Cloud size={size} uid={uid} />
          </span>
          <span style={{ position: 'absolute', inset: 0 }}>
            <RainDrops size={size} light />
          </span>
        </>
      )}
      {resolved === 'rain' && (
        <>
          <span style={{ position: 'absolute', inset: 0, transform: 'translateY(-10%) scale(0.85)' }}>
            <Cloud size={size} uid={uid} dimmed />
          </span>
          <span style={{ position: 'absolute', inset: 0 }}>
            <RainDrops size={size} />
          </span>
        </>
      )}
      {resolved === 'snow' && (
        <>
          <span style={{ position: 'absolute', inset: 0, transform: 'translateY(-10%) scale(0.85)' }}>
            <Cloud size={size} uid={uid} />
          </span>
          <span style={{ position: 'absolute', inset: 0 }}>
            <SnowFlakes size={size} />
          </span>
        </>
      )}
      {resolved === 'storm' && (
        <>
          <span style={{ position: 'absolute', inset: 0, transform: 'translateY(-12%) scale(0.82)' }}>
            <Cloud size={size} uid={uid} dimmed />
          </span>
          <span style={{ position: 'absolute', inset: 0 }}>
            <Bolt size={size} />
          </span>
        </>
      )}
    </span>
  );
}
