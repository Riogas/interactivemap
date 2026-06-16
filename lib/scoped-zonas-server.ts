import { getServerSupabaseClient } from '@/lib/supabase';

/**
 * Devuelve las zonas (zona_nro) que trabajan las empresas fleteras dadas,
 * leídas de `fleteras_zonas`.
 *
 * Uso: los pedidos/services SIN ASIGNAR tienen `empresa_fletera_id = 0`, por lo
 * que NO matchean el filtro de empresa server-side. Para que un usuario no-root
 * los vea (chip del navbar, /stats, capa "pedidos por zona"), se incluyen los SA
 * que caen en las zonas que cubren sus empresas. Este helper resuelve ese set de
 * zonas en el backend, evitando exponer SA de zonas fuera del scope.
 *
 * Consistente con `useScopedZonaIds` (cliente): el scope se define por las zonas
 * de servicio URGENTE de las empresas (las NOCTURNAS quedan fuera del scope).
 *
 * @param escenarioId  Escenario activo (fleteras_zonas.escenario_id).
 * @param empresaIds   Empresas permitidas del usuario (allowedEmpresas ∩ scope).
 * @returns Array de zona_nro únicos. [] si no hay datos o ante error (fail-safe).
 */
export async function getScopedZonasForEmpresas(
  escenarioId: number,
  empresaIds: number[],
): Promise<number[]> {
  if (!Number.isFinite(escenarioId) || empresaIds.length === 0) return [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = getServerSupabaseClient() as any;
  const { data, error } = await db
    .from('fleteras_zonas')
    .select('zonas')
    .eq('escenario_id', escenarioId)
    .in('empresa_fletera_id', empresaIds)
    .ilike('tipo_de_servicio', 'URGENTE');

  if (error || !Array.isArray(data)) return [];

  const set = new Set<number>();
  for (const row of data) {
    const zonas = row?.zonas;
    if (Array.isArray(zonas)) {
      for (const z of zonas) {
        // Aceptar solo números reales (>0). Evita que null→0 ('sin zona') o
        // strings no numéricos entren al scope.
        if (typeof z === 'number' && Number.isFinite(z) && z > 0) {
          set.add(z);
        }
      }
    }
  }
  return [...set];
}
