/**
 * Helpers para gating de UI/features según las funcionalidades asignadas a los
 * roles del usuario (vienen del SecuritySuite en el response de login).
 *
 * Convención: match por NOMBRE de funcionalidad — el id puede variar entre
 * entornos pero el nombre es canónico. Mismo criterio que se usa en el gate
 * `PermiteLogin` de `contexts/AuthContext.tsx` (commit 466d654).
 *
 * Funcionalidades conocidas (referencia, no exhaustivo):
 *   - "PermiteLogin"               → autorización de login (id típico 8)
 *   - "Ver Historico"              → ver fechas pasadas (id típico 6)
 *   - "Estadistica RiogasTracking" → panel de estadísticas (id típico 2)
 *   - "Ranking de moviles"         → ranking (id típico 7)
 *   - "Capa Capacidad de Entrega"  → capa "Cap. Entrega" del mapa (id típico 13)
 *   - "Ped s/asignar x zona"       → capa pedidos sin asignar por zona (id típico 11)
 *   - "Ped s/asignar unitarios"    → capa pedidos sin asignar unitarios (id típico 12)
 *   - "Ped s/asignar acumulados"   → capa pedidos sin asignar acumulados (id típico 9)
 */

export interface RoleWithFuncionalidades {
  funcionalidades?: Array<{ funcionalidadId: number; nombre: string }>;
}

/**
 * Devuelve true si alguno de los roles del usuario tiene una funcionalidad
 * cuyo nombre coincide exactamente con el provisto (trim aplicado).
 *
 * Defensivo:
 *   - `roles` puede ser undefined/null → false.
 *   - Roles sin `funcionalidades` → ignorados.
 *   - Funcionalidades con `nombre` falsy → ignoradas.
 *
 * @param roles  Array de roles (User.roles del AuthContext, o response crudo).
 * @param nombre Nombre canónico de la funcionalidad a chequear.
 */
export function hasFuncionalidad(
  roles: RoleWithFuncionalidades[] | null | undefined,
  nombre: string,
): boolean {
  if (!roles || roles.length === 0) return false;
  const target = nombre.trim();
  return roles.some((r) =>
    (r.funcionalidades ?? []).some(
      (f) => String(f?.nombre ?? '').trim() === target,
    ),
  );
}
