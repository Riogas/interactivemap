/**
 * SVG pattern definitions for zona fills.
 * Each pattern is a semi-transparent white overlay over the base fill color.
 * This way we don't need one pattern per color — a single set works for all zona colors.
 */

export type ZonaPattern = 'liso' | 'rayas-diagonal' | 'rayas-horizontal' | 'puntos' | 'cuadricula';

export const ZONA_PATTERN_OPTIONS: { value: ZonaPattern; label: string }[] = [
  { value: 'liso', label: 'Liso' },
  { value: 'rayas-diagonal', label: 'Rayas diagonales' },
  { value: 'rayas-horizontal', label: 'Rayas horizontales' },
  { value: 'puntos', label: 'Puntos' },
  { value: 'cuadricula', label: 'Cuadrícula' },
];

/**
 * Returns the SVG <defs> string containing all available patterns.
 * Mount this once in the map's SVG overlay (via ZonaPatternDefs component).
 */
export function getPatternDefs(): string {
  return `
    <pattern id="zona-pattern-rayas-diagonal" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <line x1="0" y1="0" x2="0" y2="8" stroke="rgba(255,255,255,0.45)" stroke-width="2.5"/>
    </pattern>
    <pattern id="zona-pattern-rayas-horizontal" width="8" height="8" patternUnits="userSpaceOnUse">
      <line x1="0" y1="4" x2="8" y2="4" stroke="rgba(255,255,255,0.45)" stroke-width="2.5"/>
    </pattern>
    <pattern id="zona-pattern-puntos" width="8" height="8" patternUnits="userSpaceOnUse">
      <circle cx="4" cy="4" r="1.8" fill="rgba(255,255,255,0.55)"/>
    </pattern>
    <pattern id="zona-pattern-cuadricula" width="8" height="8" patternUnits="userSpaceOnUse">
      <path d="M 8 0 L 0 0 0 8" fill="none" stroke="rgba(255,255,255,0.35)" stroke-width="1"/>
    </pattern>
  `;
}

/**
 * Returns the Leaflet pathOptions fillColor to use for the overlay polygon.
 * Returns null for 'liso' (no overlay needed).
 */
export function getPatternFillUrl(pattern: ZonaPattern): string | null {
  if (pattern === 'liso') return null;
  return `url(#zona-pattern-${pattern})`;
}
