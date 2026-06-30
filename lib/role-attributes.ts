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

import { isRoot } from './auth-scope';
import { hasFuncionalidad } from './role-funcionalidades';

/**
 * Shape mínimo que necesita resolveLandingRoute. Compatible estructuralmente con
 * el `User` del AuthContext (sus roles incluyen RolNombre, atributos y funcionalidades).
 */
export interface LandingUser {
  isRoot?: string;
  roles?: Array<{
    RolNombre?: string;
    atributos?: Array<{ atributo: string; valor: string }>;
    funcionalidades?: Array<{ funcionalidadId: number; nombre: string }>;
  }>;
}

/** Ruta por defecto al iniciar sesión (el mapa) — comportamiento histórico. */
const DEFAULT_LANDING = '/dashboard';

/** Funcionalidad que habilita el acceso a /dashboard/stats (igual gate que stats/layout.tsx). */
const STATS_FUNCIONALIDAD = 'Estadistica Global RiogasTracking';

interface ScreenDef {
  route: string;
  /** Si está presente, el usuario debe pasarlo; si no, cae al default. */
  canAccess?: (user: LandingUser | null | undefined) => boolean;
}

/**
 * Catálogo cerrado de pantallas de aterrizaje. Las claves se comparan en minúsculas.
 * Extensible: agregar una entrada (ej. `ranking: { route: '/dashboard/ranking', canAccess: ... }`).
 */
const LANDING_SCREENS: Record<string, ScreenDef> = {
  mapa: { route: '/dashboard' },
  stats: {
    route: '/dashboard/stats',
    canAccess: (user) =>
      // Reutiliza los helpers existentes; los casts acotan la diferencia de shape
      // entre LandingUser y los tipos ScopedUser / RoleWithFuncionalidades.
      isRoot(user as Parameters<typeof isRoot>[0]) ||
      hasFuncionalidad(
        (user?.roles ?? []) as Parameters<typeof hasFuncionalidad>[0],
        STATS_FUNCIONALIDAD,
      ),
  },
};

/**
 * Extrae la clave de pantalla del `valor` del atributo PantallaLogin, de forma defensiva.
 * Acepta:
 *   - string pelado: `stats`
 *   - JSON string: `"stats"`
 *   - JSON objeto: `{"Pantalla":"stats"}` (clave canónica) o el primer valor string del objeto
 * Devuelve null si no logra extraer una clave.
 */
function parsePantallaValor(valor: string): string | null {
  const raw = String(valor).trim();
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'string') return parsed;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const obj = parsed as Record<string, unknown>;
      if (typeof obj.Pantalla === 'string') return obj.Pantalla;
      const firstStr = Object.values(obj).find((v) => typeof v === 'string');
      return typeof firstStr === 'string' ? firstStr : null;
    }
    return null;
  } catch {
    // No es JSON → el string crudo es la clave (ej. "stats").
    return raw;
  }
}

/**
 * Resuelve a qué ruta debe aterrizar el usuario al iniciar sesión, según el atributo
 * de rol `PantallaLogin`. Siempre devuelve una ruta válida; el default es el mapa
 * (`/dashboard`), preservando el comportamiento previo a esta feature.
 *
 * Reglas:
 *  - Gana el PRIMER rol (en orden) con `PantallaLogin` de valor no vacío.
 *  - Clave normalizada con trim().toLowerCase() contra un catálogo cerrado.
 *  - Si la pantalla tiene gate de acceso y el usuario no lo pasa → default (no se lo
 *    manda a una pantalla de la que el guard lo rebotaría).
 *  - Cualquier ausencia / valor inválido / clave desconocida → default.
 */
export function resolveLandingRoute(user: LandingUser | null | undefined): string {
  const roles = user?.roles ?? [];

  let rawKey: string | null = null;
  for (const role of roles) {
    const attr = (role.atributos ?? []).find((a) => a.atributo === 'PantallaLogin');
    if (attr?.valor != null && String(attr.valor).trim() !== '') {
      rawKey = parsePantallaValor(attr.valor); // primero gana, aunque su valor sea inválido
      break;
    }
  }
  if (!rawKey) return DEFAULT_LANDING;

  const key = rawKey.trim().toLowerCase();
  const screen = LANDING_SCREENS[key];
  if (!screen) return DEFAULT_LANDING; // clave desconocida
  if (screen.canAccess && !screen.canAccess(user)) return DEFAULT_LANDING; // sin acceso
  return screen.route;
}
