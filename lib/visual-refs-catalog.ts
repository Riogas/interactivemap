/**
 * Catalogo canonico de referencias visuales (Ref#1..Ref#26) para las 5 capas del mapa.
 * Los colores default fueron extraidos del codigo fuente (no inventados):
 *   - DemorasZonasLayer.tsx -> getDemoraColor()
 *   - MovilesZonasLayer.tsx -> getColorByPrioridad()
 *   - ZonasActivasLayer.tsx -> fillColor inline
 *   - PedidosZonasLayer.tsx -> getPedidosColor()
 *   - cap-entrega-color.ts  -> getCapEntregaColor()
 */

export interface VisualRefEntry {
  id: string;          // "Ref#1", "Ref#2", ...
  layer: string;       // nombre de la capa
  label: string;       // etiqueta de la leyenda
  defaultColor: string; // "#RRGGBB"
}

export const VISUAL_REFS_CATALOG: VisualRefEntry[] = [
  // ── Capa 1: Demoras (min) ────────────────────────────────────────────────
  { id: 'Ref#1',  layer: 'Demoras (min)',      label: '0',              defaultColor: '#9ca3af' },
  { id: 'Ref#2',  layer: 'Demoras (min)',      label: '1 – 30',   defaultColor: '#86efac' },
  { id: 'Ref#3',  layer: 'Demoras (min)',      label: '31 – 45',  defaultColor: '#16a34a' },
  { id: 'Ref#4',  layer: 'Demoras (min)',      label: '46 – 60',  defaultColor: '#fde047' },
  { id: 'Ref#5',  layer: 'Demoras (min)',      label: '61 – 90',  defaultColor: '#eab308' },
  { id: 'Ref#6',  layer: 'Demoras (min)',      label: '91 – 150', defaultColor: '#f97316' },
  { id: 'Ref#7',  layer: 'Demoras (min)',      label: '151+',           defaultColor: '#ef4444' },

  // ── Capa 2: Moviles prioridad ────────────────────────────────────────────
  { id: 'Ref#8',  layer: 'Móviles / Zona', label: '0 móviles',  defaultColor: '#ef4444' },
  { id: 'Ref#9',  layer: 'Móviles / Zona', label: '1 móvil',    defaultColor: '#86efac' },
  { id: 'Ref#10', layer: 'Móviles / Zona', label: '2 móviles',  defaultColor: '#22c55e' },
  { id: 'Ref#11', layer: 'Móviles / Zona', label: '3 móviles',  defaultColor: '#06b6d4' },
  { id: 'Ref#12', layer: 'Móviles / Zona', label: '4+ móviles', defaultColor: '#8b5cf6' },

  // ── Capa 3: Zonas Activas ────────────────────────────────────────────────
  { id: 'Ref#13', layer: 'Zonas Activas', label: 'Activa',   defaultColor: '#22c55e' },
  { id: 'Ref#14', layer: 'Zonas Activas', label: 'No Activa', defaultColor: '#ef4444' },
  { id: 'Ref#15', layer: 'Zonas Activas', label: 'Sin dato', defaultColor: '#9ca3af' },

  // ── Capa 4: Pendientes / zona ────────────────────────────────────────────
  { id: 'Ref#16', layer: 'Pendientes / zona', label: '0',      defaultColor: '#bbf7d0' },
  { id: 'Ref#17', layer: 'Pendientes / zona', label: '1 – 3',  defaultColor: '#16a34a' },
  { id: 'Ref#18', layer: 'Pendientes / zona', label: '4 – 7',  defaultColor: '#eab308' },
  { id: 'Ref#19', layer: 'Pendientes / zona', label: '8 – 11', defaultColor: '#f97316' },
  { id: 'Ref#20', layer: 'Pendientes / zona', label: '12+',   defaultColor: '#ef4444' },

  // ── Capa 5: Cap. Entrega ─────────────────────────────────────────────────
  { id: 'Ref#21', layer: 'Cap. Entrega', label: 'Sin Cap. (< 0)',       defaultColor: '#92400e' },
  { id: 'Ref#22', layer: 'Cap. Entrega', label: '0 (capacidad máx.)', defaultColor: '#ef4444' },
  { id: 'Ref#23', layer: 'Cap. Entrega', label: '1',                    defaultColor: '#f97316' },
  { id: 'Ref#24', layer: 'Cap. Entrega', label: '2 – 3',           defaultColor: '#eab308' },
  { id: 'Ref#25', layer: 'Cap. Entrega', label: '> 3 (sobrante)',       defaultColor: '#86efac' },
  { id: 'Ref#26', layer: 'Cap. Entrega', label: 'Sin datos',            defaultColor: '#d1d5db' },
];

/** Mapa indexado por refId para lookup O(1) */
export const VISUAL_REFS_BY_ID: Record<string, VisualRefEntry> = Object.fromEntries(
  VISUAL_REFS_CATALOG.map((ref) => [ref.id, ref])
);

/**
 * Devuelve el color para una ref: usa el override del usuario si existe,
 * sino devuelve el defaultColor del catalog.
 *
 * @param refId  - "Ref#1" .. "Ref#26"
 * @param visualRefs - Record de overrides del usuario (puede ser undefined/null)
 */
export function getRefColor(
  refId: string,
  visualRefs?: Record<string, string> | null
): string {
  if (visualRefs && visualRefs[refId]) return visualRefs[refId];
  return VISUAL_REFS_BY_ID[refId]?.defaultColor ?? '#9ca3af';
}
