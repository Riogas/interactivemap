/**
 * Atribuye el chofer que estaba en el móvil al momento del cumplimiento,
 * cruzando con el historial de sesión del día (AC10, OQ3).
 *
 * Elige el registro con `inicio` máximo que sea `<= fch_hora_finalizacion`
 * (el chofer que estaba activo en ese instante). Si no hay candidatos
 * (historial vacío/null, o fch_hora_finalizacion anterior a todo `inicio`),
 * devuelve null — no es fatal, el hecho se registra igual con chofer=NULL.
 */

export interface HistorialEntry {
  chofer: string;
  inicio: string | null;
}

export function atribuirChofer(
  historial: HistorialEntry[] | null,
  fchHoraFinalizacion: string,
): string | null {
  if (!historial || historial.length === 0) return null;

  const finTs = new Date(fchHoraFinalizacion).getTime();
  if (Number.isNaN(finTs)) return null;

  let mejorChofer: string | null = null;
  let mejorInicioTs = -Infinity;

  for (const entry of historial) {
    if (entry.inicio == null) continue;
    const inicioTs = new Date(entry.inicio).getTime();
    if (Number.isNaN(inicioTs)) continue;
    if (inicioTs > finTs) continue;
    if (inicioTs > mejorInicioTs) {
      mejorInicioTs = inicioTs;
      mejorChofer = entry.chofer;
    }
  }

  if (mejorChofer == null) return null;
  const trimmed = mejorChofer.trim();
  return trimmed === '' ? null : trimmed;
}
