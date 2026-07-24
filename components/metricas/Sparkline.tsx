'use client';

/**
 * Mini-sparkline SVG (reusa la lógica sparkPath() del mockup). Puramente
 * decorativo/complementario a la card — el valor exacto vive en el número
 * grande + el badge de delta, así que no necesita alternativa textual propia.
 */
export function Sparkline({
  values,
  color,
  className = '',
}: {
  values: number[];
  color: string;
  className?: string;
}) {
  if (values.length < 2) return null;

  const w = 100;
  const h = 36;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const path = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * w;
      const y = h - ((v - min) / range) * h;
      return `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      className={className}
      aria-hidden="true"
    >
      <path d={path} fill="none" stroke={color} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
