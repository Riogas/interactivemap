/**
 * Helper de filtrado para pedidos/services "sin asignar" (SA).
 *
 * Regla de visibilidad temporal:
 *   fchHoraPara <= now() + minutosAntes
 *
 * Es decir: se muestran los SA cuya "fecha desde" (fch_hora_para) cae dentro
 * de la ventana [pasado, now + minutosAntes]. Esto incluye:
 *   - atrasados (fch_hora_para < now)
 *   - en hora (fch_hora_para ≈ now)
 *   - los que arrancan dentro de los proximos `minutosAntes` minutos
 * Y excluye los que arrancan mas alla de esa ventana hacia el futuro.
 *
 * Backwards-compatible: si minutosAntes es null o 0, no se aplica filtro.
 */

/**
 * Parsea un timestamp de la DB respetando la convencion del repo:
 * "la DB almacena hora local Uruguay con sufijo +00 incorrecto".
 *
 * Ej: "2026-05-13 13:00:00+00" realmente significa 13:00 hora local Uruguay,
 * NO 13:00 UTC. Stripeamos el offset para que JS lo interprete como hora local
 * del navegador (igual que utils/pedidoDelay.ts:42 y
 * components/map/{Pedido,Service}InfoPopup.tsx:14-15).
 *
 * Strings con sufijo Z (ISO UTC explicito) NO se ven afectados — el regex
 * solo quita offsets numericos (+HH, +HH:MM, -HH, -HH:MM).
 */
function parseDbDate(value: Date | string): Date {
  if (value instanceof Date) return value;
  // Stripear offset numerico (+00, +00:00, -03, -03:00, etc.) al final del string.
  // NO afecta sufijo Z (timestamps ISO con Z siguen interpretandose como UTC).
  // NO afecta strings sin offset (devuelve el mismo string → comportamiento identico).
  const localStr = value.replace(/[+-]\d{2}(:\d{2})?$/, '').trim();
  return new Date(localStr);
}

/**
 * Determina si un pedido/service sin asignar es visible segun la ventana
 * temporal configurada para el escenario.
 *
 * @param fchHoraPara - Fecha/hora "desde" del trabajo. null si no tiene hora.
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

  const horaPara: Date = parseDbDate(fchHoraPara);

  // Si la fecha es invalida: no filtrar (safe fallback)
  if (isNaN(horaPara.getTime())) return true;

  const windowEnd = new Date(serverNow.getTime() + minutosAntes * 60_000);

  // fchHoraPara <= now + minutosAntes (incluye atrasados, en hora y futuros dentro de la ventana)
  return horaPara <= windowEnd;
}
