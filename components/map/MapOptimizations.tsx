import React from 'react';
import { Marker, Polyline } from 'react-leaflet';
import L from 'leaflet';

/**
 * 🚀 OPTIMIZACIONES DE RENDIMIENTO PARA MAPAS CON MUCHOS MARCADORES
 * 
 * Estos componentes están optimizados con React.memo para evitar
 * re-renders innecesarios cuando hay cientos de marcadores en pantalla.
 */

// Componente de marcador optimizado con React.memo
export const OptimizedMarker = React.memo(({ 
  position, 
  icon, 
  children, 
  eventHandlers,
  zIndexOffset 
}: any) => {
  return (
    <Marker
      position={position}
      icon={icon}
      eventHandlers={eventHandlers}
      zIndexOffset={zIndexOffset}
    >
      {children}
    </Marker>
  );
}, (prevProps, nextProps) => {
  // Solo re-renderizar si cambió la posición o el icono
  return (
    prevProps.position[0] === nextProps.position[0] &&
    prevProps.position[1] === nextProps.position[1] &&
    prevProps.icon === nextProps.icon &&
    prevProps.zIndexOffset === nextProps.zIndexOffset
  );
});

OptimizedMarker.displayName = 'OptimizedMarker';

// Componente de polyline optimizado con React.memo
export const OptimizedPolyline = React.memo(({ 
  positions, 
  pathOptions 
}: any) => {
  return (
    <Polyline
      positions={positions}
      pathOptions={pathOptions}
    />
  );
}, (prevProps, nextProps) => {
  // Solo re-renderizar si cambió significativamente
  if (prevProps.positions.length !== nextProps.positions.length) {
    return false;
  }
  
  // Comparar opciones de estilo
  const prevStyle = JSON.stringify(prevProps.pathOptions);
  const nextStyle = JSON.stringify(nextProps.pathOptions);
  
  return prevStyle === nextStyle;
});

OptimizedPolyline.displayName = 'OptimizedPolyline';

/**
 * Simplifica un array de coordenadas usando el algoritmo Douglas-Peucker
 * Reduce drásticamente el número de puntos manteniendo la forma visual
 * 
 * @param points - Array de [lat, lng]
 * @param tolerance - Tolerancia (más alto = menos puntos, 0.0001 es buen balance)
 */
export function simplifyPath(
  points: [number, number][], 
  tolerance: number = 0.0001
): [number, number][] {
  if (points.length <= 2) return points;

  const sqTolerance = tolerance * tolerance;

  // Encuentra el punto más alejado de la línea
  function getSqSegDist(p: [number, number], p1: [number, number], p2: [number, number]) {
    let x = p1[0];
    let y = p1[1];
    let dx = p2[0] - x;
    let dy = p2[1] - y;

    if (dx !== 0 || dy !== 0) {
      const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
      if (t > 1) {
        x = p2[0];
        y = p2[1];
      } else if (t > 0) {
        x += dx * t;
        y += dy * t;
      }
    }

    dx = p[0] - x;
    dy = p[1] - y;

    return dx * dx + dy * dy;
  }

  function simplifyDPStep(
    points: [number, number][],
    first: number,
    last: number,
    sqTolerance: number,
    simplified: [number, number][]
  ) {
    let maxSqDist = sqTolerance;
    let index = 0;

    for (let i = first + 1; i < last; i++) {
      const sqDist = getSqSegDist(points[i], points[first], points[last]);
      if (sqDist > maxSqDist) {
        index = i;
        maxSqDist = sqDist;
      }
    }

    if (maxSqDist > sqTolerance) {
      if (index - first > 1) simplifyDPStep(points, first, index, sqTolerance, simplified);
      simplified.push(points[index]);
      if (last - index > 1) simplifyDPStep(points, index, last, sqTolerance, simplified);
    }
  }

  const last = points.length - 1;
  const simplified: [number, number][] = [points[0]];
  simplifyDPStep(points, 0, last, sqTolerance, simplified);
  simplified.push(points[last]);

  return simplified;
}

/**
 * Filtra puntos por distancia mínima entre ellos
 * Útil para reducir puntos muy cercanos que no aportan visualmente
 * 
 * @param points - Array de [lat, lng]
 * @param minDistance - Distancia mínima en grados (0.0001 ≈ 11 metros)
 */
export function filterByDistance(
  points: [number, number][],
  minDistance: number = 0.0001
): [number, number][] {
  if (points.length <= 2) return points;

  const filtered: [number, number][] = [points[0]];
  let lastPoint = points[0];

  for (let i = 1; i < points.length; i++) {
    const point = points[i];
    const dx = point[0] - lastPoint[0];
    const dy = point[1] - lastPoint[1];
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance >= minDistance) {
      filtered.push(point);
      lastPoint = point;
    }
  }

  // Siempre incluir el último punto
  if (filtered[filtered.length - 1] !== points[points.length - 1]) {
    filtered.push(points[points.length - 1]);
  }

  return filtered;
}

/**
 * Reduce el número de puntos de un path manteniendo calidad visual
 * Combina filtrado por distancia y simplificación Douglas-Peucker
 * 
 * @param points - Array de [lat, lng]
 * @param maxPoints - Número máximo de puntos deseado
 */
export function optimizePath(
  points: [number, number][],
  maxPoints: number = 200
): [number, number][] {
  if (points.length <= maxPoints) return points;

  // Paso 1: Filtrar puntos muy cercanos
  let optimized = filterByDistance(points, 0.00005);

  // Paso 2: Si todavía hay muchos puntos, aplicar Douglas-Peucker
  if (optimized.length > maxPoints) {
    // Calcular tolerancia adaptativa
    const tolerance = 0.0001 * (optimized.length / maxPoints);
    optimized = simplifyPath(optimized, tolerance);
  }

  console.log(`🎯 Path optimizado: ${points.length} → ${optimized.length} puntos (${Math.round((1 - optimized.length / points.length) * 100)}% reducción)`);

  return optimized;
}

/**
 * Crea un icono con cache para evitar recreación en cada render
 */
const iconCache = new Map<string, L.DivIcon>();

export function getCachedIcon(
  key: string,
  factory: () => L.DivIcon
): L.DivIcon {
  if (!iconCache.has(key)) {
    iconCache.set(key, factory());
  }
  return iconCache.get(key)!;
}

export function clearIconCache() {
  iconCache.clear();
}
