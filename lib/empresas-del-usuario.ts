/**
 * Helper para obtener los parámetros de empresas fleteras del usuario
 * destinados al endpoint upstream del SecuritySuite.
 *
 * Decisión de formato documentada:
 * - PRIMER INTENTO: nombres/slugs de las empresas (campo `nombre` de EmpFletera preferencia).
 *   El upstream `secapi.glp.riogas.com.uy/api/db/usuarios/por-empresa-fletera` espera el
 *   parámetro `empresas=NOMBRE_1,NOMBRE_2` (strings, no IDs numéricos).
 * - FALLBACK: si los nombres no están disponibles (usuario sin preferencia EmpFletera
 *   parseada), se usan los IDs numéricos de `allowedEmpresas`.
 * - Si ninguno está disponible, devuelve string vacío (el endpoint upstream recibirá
 *   `empresas=` y debería responder con lista vacía o error gestionado por el llamador).
 *
 * Esta decisión se toma a partir del shape del response de login del SecuritySuite:
 * la preferencia "EmpFletera" viene como `[{ nombre: "FLETERA_1", valor: 70 }, ...]`
 * donde `nombre` es el slug/nombre y `valor` es el ID numérico.
 */

export interface EmpresaEntry {
  nombre: string; // slug/nombre de la empresa (ej: "FLETERA_1", "MONTEVIDEO")
  valor: number;  // ID numérico de la empresa fletera
}

/**
 * Construye el query param `empresas=` como espera el endpoint upstream.
 *
 * @param empresas  Array de { nombre, valor } — vienen de las preferencias parseadas
 *                  de EmpFletera (login response del SecuritySuite).
 *                  Pasan vacío o null si el usuario no tiene preferencias.
 * @param allowedEmpresaIds  Fallback: IDs numéricos de allowedEmpresas del usuario.
 *
 * @returns string listo para query param, ej: "FLETERA_1,FLETERA_2"
 *          o ""   si no hay empresas disponibles.
 *
 * @example
 * // Con nombres disponibles (primer intento):
 * getEmpresasParamForUpstream(
 *   [{ nombre: "FLETERA_NORTE", valor: 70 }, { nombre: "FLETERA_SUR", valor: 71 }],
 *   [70, 71]
 * )
 * // → "FLETERA_NORTE,FLETERA_SUR"
 *
 * @example
 * // Sin nombres, fallback a IDs:
 * getEmpresasParamForUpstream([], [70, 71])
 * // → "70,71"
 */
export function getEmpresasParamForUpstream(
  empresas: EmpresaEntry[] | null | undefined,
  allowedEmpresaIds: number[] | null | undefined,
): string {
  // Primer intento: nombres
  if (Array.isArray(empresas) && empresas.length > 0) {
    const nombres = empresas
      .map((e) => String(e.nombre).trim())
      .filter(Boolean);
    if (nombres.length > 0) {
      return nombres.join(',');
    }
  }

  // Fallback: IDs numéricos
  if (Array.isArray(allowedEmpresaIds) && allowedEmpresaIds.length > 0) {
    return allowedEmpresaIds.map(String).join(',');
  }

  return '';
}

/**
 * Versión simplificada para cuando solo tenemos IDs (server-side, sin nombres).
 * Se usa cuando el cliente no puede pasar los nombres via query param.
 *
 * @deprecated  Preferir getEmpresasParamForUpstream cuando los nombres están disponibles.
 */
export function getEmpresasParamFromIds(ids: number[] | null | undefined): string {
  if (!Array.isArray(ids) || ids.length === 0) return '';
  return ids.map(String).join(',');
}
