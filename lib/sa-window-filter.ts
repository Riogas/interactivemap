/**
 * Helper de filtrado para pedidos/services "sin asignar" (SA).
 *
 * Regla de visibilidad temporal:
 *   now() <= fchHoraPara <= now() + minutosAntes
 *
 * Backwards-compatible: si minutosAntes es null o 0, no se aplica filtro.
 */

/**
 * Determina si un pedido/service sin asignar es visible segun la ventana
 * temporal configurada para el escenario.
 *
 * @param fchHoraPara - Fecha/hora limite del trabajo. null si no tiene hora.
 * @param serverNow   - Hora actual del SERVIDOR (no del cliente).
 * @param minutosAntes - Minutos de anticipacion configurados. null o 0 = sin filtro.
 * @returns true si el trabajo debe ser visible, false si debe ocultarse.
 */
export function isWithinSaWindow(
  fchHoraPara: Date | string | null,
  serverNow: Date,
  minutosAntes: number | null,
): boolean {
  // Sin configuracion o configuracion deshabilitada: sin filtro (backwards compat)
  if (minutosAntes === null || minutosAntes === 0) return true;

  // Sin hora registrada: no filtrar por falta de dato
  if (fchHoraPara === null) return true;

  const horaPara: Date =
    fchHoraPara instanceof Date ? fchHoraPara : new Date(fchHoraPara);

  // Si la fecha es invalida: no filtrar (safe fallback)
  if (isNaN(horaPara.getTime())) return true;

  const windowEnd = new Date(serverNow.getTime() + minutosAntes * 60_000);

  // now <= fchHoraPara <= now + minutosAntes
  return serverNow <= horaPara && horaPara <= windowEnd;
}
