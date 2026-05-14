/**
 * Helpers para extraer atributos de rol del SecuritySuite y computar límites de fecha.
 *
 * Los roles del response de login pueden incluir un array `atributos[]` donde cada
 * entrada tiene:
 *   - `atributo`: nombre del atributo (ej. "HistoricoMaxCoords", "Escenario")
 *   - `valor`:    JSON string parseable con el valor
 *
 * Para `HistoricoMaxCoords` / `HistoricoMaxPedidos` el shape del JSON es:
 *   { "CantDiasMaxAntiguedad": "<n>" }
 *
 * Para `Escenario` el shape es:
 *   { "NOMBRE_ESCENARIO": "<escenario_id>", ... }
 *   (las claves son nombres legibles, los valores son los escenario_ids como string)
 *
 * Algoritmo de agregación:
 * - Para un atributo X y un currentEscenarioId, tomar solo los roles cuyo atributo
 *   "Escenario" contiene currentEscenarioId como valor (coincidencia numérica).
 * - De esos roles, extraer el valor numérico de X.
 * - Retornar el MÁXIMO. Si ningún rol aplica, retornar null (sin restricción).
 */

export interface RoleWithAtributos {
  rolId: number;
  rolNombre: string;
  atributos?: Array<{ atributo: string; valor: string }>;
}

/**
 * Devuelve el Set de escenario_ids que cubre un rol (vía su atributo "Escenario"),
 * o null si el rol no tiene atributo "Escenario" o su valor es JSON inválido.
 *
 * @example
 * // valor = '{"MONTEVIDEO":"1000","CANELONES":"2000"}'
 * getRolEscenarioIds(role) // → Set { 1000, 2000 }
 */
export function getRolEscenarioIds(role: RoleWithAtributos): Set<number> | null {
  if (!Array.isArray(role.atributos)) return null;

  const escAtributo = role.atributos.find((a) => a.atributo === 'Escenario');
  if (!escAtributo?.valor) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(escAtributo.valor);
  } catch {
    console.warn(
      `[role-attributes] JSON inválido en atributo Escenario del rol ${role.rolId} ("${role.rolNombre}"):`,
      escAtributo.valor,
    );
    return null;
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    console.warn(
      `[role-attributes] Escenario del rol ${role.rolId} no es un objeto plano:`,
      parsed,
    );
    return null;
  }

  const ids = new Set<number>();
  for (const [, rawId] of Object.entries(parsed as Record<string, unknown>)) {
    const n = Number(rawId);
    if (Number.isFinite(n) && n > 0) {
      ids.add(n);
    }
  }

  return ids.size > 0 ? ids : null;
}

/**
 * Devuelve el valor máximo del atributo `attrName` (ej. "HistoricoMaxCoords")
 * agregado sobre los roles cuyo "Escenario" cubre `currentEscenarioId`.
 *
 * Si ningún rol aplica o el atributo no está, retorna null (sin restricción —
 * el comportamiento es el que tenía la app antes de esta feature).
 *
 * Convención de `valor`:
 *   JSON string con shape `{ "CantDiasMaxAntiguedad": "<n>" }` donde n es un entero.
 *
 * Defensivo ante:
 *  - JSON inválido → skip ese rol + warning
 *  - falta de campo CantDiasMaxAntiguedad → skip ese rol + warning
 *  - rol sin atributo "Escenario" → ignorado (skip defensivo)
 *
 * @param roles           Array de roles del usuario (user.roles del AuthContext).
 * @param attrName        Nombre del atributo a leer ("HistoricoMaxCoords" | "HistoricoMaxPedidos").
 * @param currentEscenarioId  El escenario activo en el mapa (AuthContext.escenarioId).
 */
export function getMaxRoleAttribute(
  roles: RoleWithAtributos[],
  attrName: 'HistoricoMaxCoords' | 'HistoricoMaxPedidos',
  currentEscenarioId: number,
): number | null {
  if (!Array.isArray(roles) || roles.length === 0) return null;

  let max: number | null = null;

  for (const role of roles) {
    // 1. Verificar que el rol cubre el escenario actual
    const escenarioIds = getRolEscenarioIds(role);
    if (!escenarioIds || !escenarioIds.has(currentEscenarioId)) {
      // Rol sin Escenario o con escenario distinto → ignorar (defensivo)
      continue;
    }

    // 2. Buscar el atributo pedido
    if (!Array.isArray(role.atributos)) continue;
    const attr = role.atributos.find((a) => a.atributo === attrName);
    if (!attr?.valor) continue;

    // 3. Parsear el valor
    let parsed: unknown;
    try {
      parsed = JSON.parse(attr.valor);
    } catch {
      console.warn(
        `[role-attributes] JSON inválido en atributo ${attrName} del rol ${role.rolId} ("${role.rolNombre}"):`,
        attr.valor,
      );
      continue;
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      console.warn(
        `[role-attributes] ${attrName} del rol ${role.rolId} no es un objeto:`,
        parsed,
      );
      continue;
    }

    const record = parsed as Record<string, unknown>;
    if (!('CantDiasMaxAntiguedad' in record)) {
      console.warn(
        `[role-attributes] Falta CantDiasMaxAntiguedad en ${attrName} del rol ${role.rolId}:`,
        record,
      );
      continue;
    }

    const n = Number(record['CantDiasMaxAntiguedad']);
    if (!Number.isFinite(n) || n < 0) {
      console.warn(
        `[role-attributes] CantDiasMaxAntiguedad no es un número válido en ${attrName} del rol ${role.rolId}:`,
        record['CantDiasMaxAntiguedad'],
      );
      continue;
    }

    // 4. Actualizar máximo
    if (max === null || n > max) {
      max = n;
    }
  }

  return max;
}
