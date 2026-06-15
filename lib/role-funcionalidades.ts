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
 *   - "Estadist.GlobalxMovil"      → card "Top móviles por entregas" de Stats
 *   - "Estadist.GlobalxZona"       → card "Pedidos por zona" de Stats
 *   - "Estadist.GlobalxEF"         → card "Pedidos por empresa" de Stats (EF = empresa fletera)
 *   - "Buscador de Calles"         → FAB buscar calle en el mapa
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

/**
 * Jerarquía de las funcionalidades "Pedidos Sin Asignar" (SA).
 *
 *   unitarios (mayor)  ⊃  x zona (medio)  ⊃  acumulados (menor)
 *
 * Si un rol posee una funcionalidad de mayor jerarquía, a efectos del
 * comportamiento del sistema posee implícitamente las de menor jerarquía:
 *   - "Ped s/asignar unitarios"  ⇒ también x zona y acumulados
 *   - "Ped s/asignar x zona"     ⇒ también acumulados
 *
 * Estos helpers son la única fuente de verdad para el gating SA. No deben
 * usarse hardcodeos por rol (Despacho/Dashboard/Supervisor): solo funcionalidades.
 */

/** True si el usuario puede ver SA unitarios (filtro sin_movil + marcadores individuales). */
export function hasSaUnitarios(
  roles: RoleWithFuncionalidades[] | null | undefined,
): boolean {
  return hasFuncionalidad(roles, 'Ped s/asignar unitarios');
}

/** True si el usuario puede ver SA por zona (capa por zona + columna modal + resta en capacidad). Incluye unitarios. */
export function hasSaPorZona(
  roles: RoleWithFuncionalidades[] | null | undefined,
): boolean {
  return hasSaUnitarios(roles) || hasFuncionalidad(roles, 'Ped s/asignar x zona');
}

/** True si el usuario puede ver SA acumulados (chip del navbar + total en stats). Incluye x zona y unitarios. */
export function hasSaAcumulados(
  roles: RoleWithFuncionalidades[] | null | undefined,
): boolean {
  return hasSaPorZona(roles) || hasFuncionalidad(roles, 'Ped s/asignar acumulados');
}
