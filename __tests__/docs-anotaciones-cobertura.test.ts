/**
 * Test antienvejecimiento del catálogo de APIs.
 *
 * El problema que evita: alguien agrega un `route.ts`, corre `pnpm docs:api`, y el
 * endpoint aparece en el portal con lo poco que el generador pudo inferir —sin quién lo
 * consume, sin ejemplo, sin errores conocidos— y nadie se entera. Un catálogo así
 * envejece hasta volverse decorativo.
 *
 * Cómo funciona: TODO endpoint de openapi.json tiene que tener entrada en
 * anotaciones.yaml, salvo los que están en `SIN_ANOTAR_HOY`. Esa lista es la deuda
 * conocida al 2026-08-17 y arranca el test en verde; un endpoint NUEVO sin anotar lo
 * pone en rojo.
 *
 * La lista solo se achica. Si anotás uno, sacalo de acá — el test también falla si una
 * excepción sobra (endpoint ya anotado, o que ya no existe), así no se acumula basura.
 *
 * Es el mismo patrón que usa el motor de demora en
 * components/metricas/documentacion-data.test.ts.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { mergearAnotaciones } from '@/lib/docs/merge-spec';

const RAIZ = process.cwd();
const spec = JSON.parse(readFileSync(path.join(RAIZ, 'docs', 'api', 'openapi.json'), 'utf-8')) as Record<
  string,
  unknown
>;
const yaml = readFileSync(path.join(RAIZ, 'docs', 'api', 'anotaciones.yaml'), 'utf-8');

const { spec: mergeado, huerfanas } = mergearAnotaciones(spec, yaml);

/** `GET /api/pedidos` para cada operación del documento generado. */
function clavesDelSpec(documento: Record<string, unknown>): string[] {
  const paths = (documento.paths ?? {}) as Record<string, Record<string, unknown>>;
  const out: string[] = [];
  for (const [ruta, operaciones] of Object.entries(paths)) {
    for (const metodo of Object.keys(operaciones)) out.push(`${metodo.toUpperCase()} ${ruta}`);
  }
  return out.sort();
}

/** true si la operación quedó marcada como anotada después del merge. */
function estaAnotado(documento: Record<string, unknown>, clave: string): boolean {
  const [metodo, ...resto] = clave.split(' ');
  const ruta = resto.join(' ');
  const paths = (documento.paths ?? {}) as Record<string, Record<string, Record<string, unknown>>>;
  return paths[ruta]?.[metodo.toLowerCase()]?.['x-anotado'] === true;
}

/**
 * Deuda conocida al 2026-08-17: endpoints que hoy salen solo con lo que el generador
 * infiere del código. NO se agrega nada acá sin una razón escrita en el PR.
 *
 * Prioridad para achicarla: los que están sin ningún gate (se ven en el apartado
 * "Estado de la autenticación" del portal) y los de /api/admin.
 */
const SIN_ANOTAR_HOY: readonly string[] = [
  'DELETE /api/admin/login-blocks/{id}',
  'DELETE /api/admin/notificaciones/{id}',
  'DELETE /api/fleteras-zonas',
  'DELETE /api/incidents/{id}',
  'DELETE /api/puntos-interes',
  'DELETE /api/puntos-interes/import-osm',
  'GET /api/admin/escenario-settings',
  'GET /api/admin/login-blocks',
  'GET /api/admin/login-logs',
  'GET /api/admin/login-security/config',
  'GET /api/admin/login-security/usuario-detalle',
  'GET /api/admin/notificaciones',
  'GET /api/admin/notificaciones/{id}/lecturas',
  'GET /api/admin/usuarios-empresa',
  'GET /api/audit/config',
  'GET /api/audit/list',
  'GET /api/coordinates',
  'GET /api/debug/toggle',
  'GET /api/demoras/comparativa',
  'GET /api/demoras/modelo',
  'GET /api/email-config',
  'GET /api/fleteras-zonas',
  'GET /api/incidents/list',
  'GET /api/incidents/{id}/video',
  'GET /api/manual/current',
  'GET /api/metricas/desfasaje/analisis',
  'GET /api/metricas/evolucion-dia',
  'GET /api/metricas/variantes',
  'GET /api/metricas/variantes/reproceso',
  'GET /api/metricas/zona-corrida',
  'GET /api/movil-session/{id}',
  'GET /api/moviles-actividad-dia',
  'GET /api/moviles-zonas',
  'GET /api/pedidos-pendientes',
  'GET /api/pedidos-pendientes/{movilId}',
  'GET /api/pedidos-servicios-pendientes/{movilId}',
  'GET /api/pedidos-servicios/{movilId}',
  'GET /api/puntos-interes',
  'GET /api/puntos-interes/import-osm',
  'GET /api/servicio-detalle/{servicioId}',
  'GET /api/zonas/capacidad-snapshot',
  'PATCH /api/incidents/{id}',
  'PATCH /api/puntos-interes',
  'POST /api/admin/login-security/unblock',
  'POST /api/admin/notificaciones',
  'POST /api/admin/notificaciones/upload',
  'POST /api/admin/recalcular-cap-entrega-all',
  'POST /api/admin/reset-manual',
  'POST /api/admin/upload-manual',
  'POST /api/admin/usuarios-empresa/toggle',
  'POST /api/audit',
  'POST /api/audit/config',
  'POST /api/debug/toggle',
  'POST /api/email-config/test',
  'POST /api/fleteras-zonas',
  'POST /api/incidents',
  'POST /api/incidents/upload',
  'POST /api/incidents/upload-url',
  'POST /api/metricas/cumplimiento/run',
  'POST /api/metricas/variantes/reproceso',
  'POST /api/moviles-dia/rebuild',
  'POST /api/moviles-zonas',
  'POST /api/notificaciones/{id}/state',
  'POST /api/proxy/login',
  'POST /api/puntos-interes',
  'POST /api/puntos-interes/import-osm',
  'PUT /api/admin/escenario-settings',
  'PUT /api/admin/login-security/config',
  'PUT /api/admin/notificaciones/{id}',
  'PUT /api/demoras/modelo',
  'PUT /api/email-config',
  'PUT /api/fleteras-zonas',
  'PUT /api/realtime-config',
];

describe('docs/api — el catálogo no envejece', () => {
  it('anotaciones.yaml parsea y se mergea (si no, el portal serviría solo lo generado)', () => {
    const meta = mergeado['x-anotaciones'] as { disponible?: boolean; error?: string; anotados?: number };

    expect(meta?.error, `anotaciones.yaml no parseó: ${meta?.error ?? ''}`).toBeUndefined();
    expect(meta?.disponible).toBe(true);
    expect(meta?.anotados ?? 0).toBeGreaterThan(0);
  });

  it('ninguna anotación quedó huérfana (apuntando a un endpoint que ya no existe)', () => {
    expect(
      huerfanas,
      `Estas claves de anotaciones.yaml no matchean ningún endpoint de openapi.json. ` +
        `Se renombró o se borró el route.ts: actualizá la clave o borrá la anotación.`,
    ).toEqual([]);
  });

  it('TODO endpoint nuevo tiene que estar anotado en docs/api/anotaciones.yaml', () => {
    const excepciones = new Set(SIN_ANOTAR_HOY);
    const sinAnotar = clavesDelSpec(mergeado).filter(
      (clave) => !estaAnotado(mergeado, clave) && !excepciones.has(clave),
    );

    expect(
      sinAnotar,
      `Endpoints sin entrada en docs/api/anotaciones.yaml:\n  ${sinAnotar.join('\n  ')}\n\n` +
        `Agregá la entrada (quién lo consume, para qué existe, un ejemplo) — ver docs/api/README.md. ` +
        `Si de verdad no corresponde anotarlo, sumalo a SIN_ANOTAR_HOY con el motivo en el PR.`,
    ).toEqual([]);
  });

  it('la lista de excepciones no junta basura: cada una sigue existiendo y sigue sin anotar', () => {
    const todas = new Set(clavesDelSpec(mergeado));

    const inexistentes = SIN_ANOTAR_HOY.filter((clave) => !todas.has(clave));
    expect(
      inexistentes,
      `Excepciones de endpoints que ya no existen en openapi.json — sacalas de SIN_ANOTAR_HOY:\n  ${inexistentes.join('\n  ')}`,
    ).toEqual([]);

    const yaAnotadas = SIN_ANOTAR_HOY.filter((clave) => estaAnotado(mergeado, clave));
    expect(
      yaAnotadas,
      `Ya están anotados: sacalos de SIN_ANOTAR_HOY (la lista solo se achica):\n  ${yaAnotadas.join('\n  ')}`,
    ).toEqual([]);
  });

  it('los endpoints con consumidor externo están anotados sí o sí', () => {
    // /api/import/* es el contrato con el sender de GeneXus y con la app móvil: si
    // alguno se cae del catálogo, el que integra queda sin nada escrito.
    const externos = clavesDelSpec(mergeado).filter((c) => c.includes(' /api/import/'));

    expect(externos.length).toBeGreaterThan(20);
    expect(externos.filter((c) => !estaAnotado(mergeado, c))).toEqual([]);
  });

  it('las anotaciones de los endpoints externos dicen QUIÉN los consume', () => {
    const paths = (mergeado.paths ?? {}) as Record<string, Record<string, Record<string, unknown>>>;
    const sinConsumidores: string[] = [];

    for (const [ruta, operaciones] of Object.entries(paths)) {
      if (!ruta.startsWith('/api/import/')) continue;
      for (const [metodo, op] of Object.entries(operaciones)) {
        const consumidores = op['x-consumidores'];
        const vacio = !Array.isArray(consumidores) || consumidores.length === 0;
        if (vacio) sinConsumidores.push(`${metodo.toUpperCase()} ${ruta}`);
      }
    }

    expect(
      sinConsumidores,
      `Endpoints de integración sin consumidores anotados:\n  ${sinConsumidores.join('\n  ')}`,
    ).toEqual([]);
  });
});
