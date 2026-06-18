/**
 * Helper de scope por zona para pedidos/services SIN ASIGNAR (SA).
 *
 * Regla (spec 2026-06-17): un SA (estado=1, sin móvil) es visible para el usuario
 * según las zonas que trabajan las EFL seleccionadas en el período actual.
 *
 *   - saScopeZonaIds === null  → sin filtro de zona (despacho con atributo EFL
 *     TODAS (*) y todas las EFL seleccionadas): TODOS los SA pasan.
 *   - saScopeZonaIds: Set       → solo pasa si zona_nro ∈ Set. SA sin zona o en
 *     zona fuera del set NO pasa. Set vacío = ningún SA.
 *
 * NO incluye el gate de funcionalidad (Ped s/asignar unitarios) ni la ventana
 * temporal SA — esos los aplican los call-sites. Este helper resuelve SOLO el eje
 * de zona, para que las 4 superficies (sidebar, tabla extendida, mapa, navbar)
 * usen exactamente la misma regla.
 */
export function isSaInZonaScope(
  zonaNro: number | string | null | undefined,
  saScopeZonaIds: Set<number> | null,
): boolean {
  if (saScopeZonaIds === null) return true; // sin filtro de zona
  const zona = zonaNro != null ? Number(zonaNro) : null;
  if (zona === null || zona === 0 || Number.isNaN(zona)) return false; // SA sin zona no es scopeable
  return saScopeZonaIds.has(zona);
}
