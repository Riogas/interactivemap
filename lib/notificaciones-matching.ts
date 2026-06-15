/**
 * Helpers puros para matching de notificaciones de novedades.
 *
 * Estas funciones no tienen dependencias de Next.js ni Supabase — son
 * completamente testeables con vitest sin mocks de infraestructura.
 */

export interface NotifForMatch {
  id: number;
  activa: boolean;
  fecha_inicio: string; // ISO timestamptz
  fecha_fin: string;    // ISO timestamptz
  roles_target: string[];
}

export interface UserRoleForMatch {
  RolNombre: string;
}

/**
 * True si la notificacion esta activa y NOW esta dentro del rango [fecha_inicio, fecha_fin].
 *
 * @param notif - Notificacion a evaluar
 * @param now   - Fecha de referencia (inyectable para tests). Default: new Date()
 */
export function isNotifActive(notif: NotifForMatch, now: Date = new Date()): boolean {
  if (!notif.activa) return false;
  const start = new Date(notif.fecha_inicio);
  const end = new Date(notif.fecha_fin);
  return now >= start && now <= end;
}

/**
 * True si al menos uno de los roles del usuario esta en roles_target de la notif.
 *
 * Comparacion exacta post-trim (case-sensitive, igual que el SecuritySuite).
 * Roles vacios en la notif → nunca hay match (la notif no es visible para nadie).
 *
 * @param notif     - Notificacion con roles_target
 * @param userRoles - Roles del usuario (array de { RolNombre })
 */
export function matchesUserRole(
  notif: NotifForMatch,
  userRoles: UserRoleForMatch[]
): boolean {
  if (notif.roles_target.length === 0) return false;
  const targetSet = new Set(notif.roles_target.map((r) => r.trim()));
  return userRoles.some((r) => targetSet.has(r.RolNombre.trim()));
}

/**
 * Combina isNotifActive + matchesUserRole en un solo check.
 */
export function matchesUser(
  notif: NotifForMatch,
  userRoles: UserRoleForMatch[],
  now: Date = new Date()
): boolean {
  return isNotifActive(notif, now) && matchesUserRole(notif, userRoles);
}
