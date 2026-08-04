/**
 * Tests de components/metricas/demora-comparativa-logic.ts — lógica pura
 * extraída de DemoraComparativa.tsx para poder testearse sin
 * jsdom/@testing-library/react (el repo no los tiene, vitest.config.ts usa
 * environment: 'node' — mismo patrón que __tests__/metricas-dashboard-
 * theme.test.ts y __tests__/dashboard-lifecycle.test.ts).
 *
 * Fix round 1 sobre Task 8 (Important): la card no distinguía "el motor no
 * corrió" de "no tenés zonas asignadas" — ambos caían en el mismo mensaje,
 * porque el endpoint devuelve 200 con arrays vacíos en los dos casos
 * (fail-closed). `sinAlcanceNoRoot` es el predicado que el componente usa
 * TANTO para elegir el mensaje (render) COMO para saltear el fetch
 * (`buildComparativaFetch` retorna `skip: true` antes de construir la URL o
 * los headers) — testear que `buildComparativaFetch({...sin alcance}).skip
 * === true` prueba, por inspección directa del código de
 * DemoraComparativa.tsx (`if (intent.skip) return;` ANTES de la única
 * llamada a `fetch(...)` del componente), que el endpoint no se llama.
 */

import { describe, it, expect } from 'vitest';
import {
  sinAlcanceNoRoot,
  buildComparativaFetch,
  mensajeSinDatos,
  MENSAJE_SIN_ALCANCE,
  MENSAJE_SIN_CORRIDAS,
  MENSAJE_ESCENARIO_NO_CONFIGURADO,
  capacidadHumana,
  sufijosPunto,
  detalleUltimaCorrida,
} from './demora-comparativa-logic';
import type { UltimaCorridaZona } from '@/types/demoras-comparativa';

/** Nombre EXACTO que exige requireFuncionalidad en app/api/demoras/comparativa/route.ts. */
const FUNC = 'Estadisticas Cumplimiento';

describe('sinAlcanceNoRoot()', () => {
  it('no-root sin empresas -> true (sin alcance)', () => {
    expect(sinAlcanceNoRoot(false, [])).toBe(true);
  });

  it('no-root con empresas -> false', () => {
    expect(sinAlcanceNoRoot(false, [70])).toBe(false);
  });

  it('root sin empresas -> false (root ve todo igual)', () => {
    expect(sinAlcanceNoRoot(true, [])).toBe(false);
  });

  it('root con empresas -> false', () => {
    expect(sinAlcanceNoRoot(true, [70, 80])).toBe(false);
  });
});

describe('MENSAJE_SIN_ALCANCE', () => {
  it('no menciona jerga interna (fail-closed / scope) — hablado desde el usuario', () => {
    expect(MENSAJE_SIN_ALCANCE.toLowerCase()).not.toMatch(/fail-closed|scope/);
  });

  it('distingue el texto del mensaje genérico de "sin corridas"', () => {
    expect(MENSAJE_SIN_ALCANCE).not.toBe(MENSAJE_SIN_CORRIDAS);
  });
});

// ─── B3: el escenario sin configuración es una condición PERMANENTE ────────
// El motor tiene el escenario 1000 hardcodeado (`v_esc integer := 1000` en
// demoras_calcular_run) y demoras_config solo se siembra para ese escenario,
// pero la pantalla tiene selector. Con cualquier otro escenario la card queda
// vacía para siempre: decir "todavía no hay corridas del motor para hoy"
// explica con un estado transitorio algo que no va a cambiar nunca.

describe('mensajeSinDatos()', () => {
  it('escenario configurado -> el motor todavía no corrió hoy (transitorio)', () => {
    expect(mensajeSinDatos(true)).toBe(MENSAJE_SIN_CORRIDAS);
  });

  it('escenario SIN configuración -> lo dice explícitamente (permanente)', () => {
    expect(mensajeSinDatos(false)).toBe(MENSAJE_ESCENARIO_NO_CONFIGURADO);
  });

  it('los dos mensajes son distintos entre sí', () => {
    expect(MENSAJE_ESCENARIO_NO_CONFIGURADO).not.toBe(MENSAJE_SIN_CORRIDAS);
  });

  it('el mensaje de "no configurado" no promete que vaya a haber datos', () => {
    expect(MENSAJE_ESCENARIO_NO_CONFIGURADO.toLowerCase()).not.toMatch(/todav[íi]a|a[úu]n|pronto/);
  });
});

describe('buildComparativaFetch()', () => {
  const base = {
    escenario: 1000,
    tipo: 'URGENTE' as const,
    zona: null,
    funcionalidades: [FUNC],
  };

  it('no-root SIN empresas -> skip:true, sin construir url ni headers (no se llama al endpoint)', () => {
    const intent = buildComparativaFetch({ ...base, isRoot: false, empresasIds: [] });
    expect(intent.skip).toBe(true);
    // Union discriminada: con skip:true, TS ni deja acceder a url/headers.
    // Confirmamos igual en runtime que el objeto no trae esas claves.
    expect('url' in intent).toBe(false);
    expect('headers' in intent).toBe(false);
  });

  it('sin escenario elegido -> skip:true (root)', () => {
    const intent = buildComparativaFetch({ ...base, escenario: null, isRoot: true, empresasIds: [] });
    expect(intent.skip).toBe(true);
  });

  it('sin escenario elegido -> skip:true (no-root con empresas)', () => {
    const intent = buildComparativaFetch({ ...base, escenario: null, isRoot: false, empresasIds: [70] });
    expect(intent.skip).toBe(true);
  });

  it('root -> skip:false, header x-track-isroot, sin query param empresaIds', () => {
    const intent = buildComparativaFetch({ ...base, isRoot: true, empresasIds: [] });
    expect(intent.skip).toBe(false);
    if (intent.skip) throw new Error('unreachable');
    expect(intent.headers['x-track-isroot']).toBe('S');
    expect(intent.url).toBe('/api/demoras/comparativa?escenario=1000&tipo=URGENTE');
  });

  it('no-root CON empresas -> skip:false, query param empresaIds (CSV), sin header x-track-isroot', () => {
    const intent = buildComparativaFetch({ ...base, isRoot: false, empresasIds: [70, 80] });
    expect(intent.skip).toBe(false);
    if (intent.skip) throw new Error('unreachable');
    expect(intent.headers['x-track-isroot']).toBeUndefined();
    const url = new URL(intent.url, 'http://localhost');
    expect(url.searchParams.get('empresaIds')).toBe('70,80');
    expect(url.searchParams.get('escenario')).toBe('1000');
    expect(url.searchParams.get('tipo')).toBe('URGENTE');
  });

  it('zona elegida -> viaja en la url', () => {
    const intent = buildComparativaFetch({ ...base, zona: 42, isRoot: true, empresasIds: [] });
    expect(intent.skip).toBe(false);
    if (intent.skip) throw new Error('unreachable');
    const url = new URL(intent.url, 'http://localhost');
    expect(url.searchParams.get('zona')).toBe('42');
  });

  it('sin zona elegida -> no viaja el param "zona"', () => {
    const intent = buildComparativaFetch({ ...base, isRoot: true, empresasIds: [] });
    expect(intent.skip).toBe(false);
    if (intent.skip) throw new Error('unreachable');
    const url = new URL(intent.url, 'http://localhost');
    expect(url.searchParams.has('zona')).toBe(false);
  });

  // ─── B5: sin x-track-funcs, NINGÚN no-root pasaba el gate del endpoint ───
  // route.ts corre requireFuncionalidad(request, 'Estadisticas Cumplimiento'),
  // que lee ese header. La card lo omitía por completo para no-root (headers
  // quedaba en {}), así que todos recibían 403 aunque tuvieran la
  // funcionalidad asignada en SecuritySuite.

  describe('header x-track-funcs (gate Estadisticas Cumplimiento)', () => {
    it('no-root manda x-track-funcs con sus funcionalidades', () => {
      const intent = buildComparativaFetch({ ...base, isRoot: false, empresasIds: [70] });
      if (intent.skip) throw new Error('unreachable');
      expect(intent.headers['x-track-funcs']).toBe(FUNC);
    });

    it('root TAMBIÉN lo manda (mismo patrón que app/dashboard/page.tsx:1213)', () => {
      const intent = buildComparativaFetch({ ...base, isRoot: true, empresasIds: [] });
      if (intent.skip) throw new Error('unreachable');
      expect(intent.headers['x-track-funcs']).toBe(FUNC);
      expect(intent.headers['x-track-isroot']).toBe('S');
    });

    it('varias funcionalidades viajan como CSV', () => {
      const intent = buildComparativaFetch({
        ...base,
        isRoot: false,
        empresasIds: [70],
        funcionalidades: ['Otra Cosa', FUNC],
      });
      if (intent.skip) throw new Error('unreachable');
      expect(intent.headers['x-track-funcs']).toBe(`Otra Cosa,${FUNC}`);
    });

    it('descarta vacíos y espacios sobrantes (no genera comas huérfanas)', () => {
      const intent = buildComparativaFetch({
        ...base,
        isRoot: false,
        empresasIds: [70],
        funcionalidades: ['  ', ` ${FUNC} `, ''],
      });
      if (intent.skip) throw new Error('unreachable');
      expect(intent.headers['x-track-funcs']).toBe(FUNC);
    });

    it('sin funcionalidades el header viaja vacío (el 403 del server es correcto ahí)', () => {
      const intent = buildComparativaFetch({ ...base, isRoot: false, empresasIds: [70], funcionalidades: [] });
      if (intent.skip) throw new Error('unreachable');
      expect(intent.headers['x-track-funcs']).toBe('');
    });
  });
});

// ─── Desglose por zona: la última corrida traducida a lenguaje llano ────────
// Los fixtures son corridas REALES del escenario 1000 (2026-08-03 09:40,
// primer día completo del modelo CONSUMO_TRAMOS): si un caso parece raro,
// probablemente sea porque pasó de verdad.

/** Corrida "limpia": zona 3 SERVICE — 2 escalones, ritmo del chofer. */
function corridaBase(overrides: Partial<UltimaCorridaZona> = {}): UltimaCorridaZona {
  return {
    corrida_at: '2026-08-03T09:40:00-03:00',
    demora_informada: 90,
    demora_cruda: 86.05,
    as400: null,
    capacidad_inicial: 0.011502,
    capacidad_final: 0.011916,
    tramos: 2,
    cola_por_delante: 0,
    moviles_considerados: 4,
    ritmo_usado: 15.3,
    ritmo_origen: 'CHOFER',
    ritmo_muestras: 214,
    sin_capacidad: false,
    clampeado: null,
    suavizado_aplicado: false,
    ...overrides,
  };
}

describe('capacidadHumana()', () => {
  it('invierte pedidos/min a "1 pedido cada ~N min" (0,0166 no le dice nada a nadie; 60 sí)', () => {
    // 1/0.016851 = 59.3 -> 59 (zona 5 SERVICE real)
    expect(capacidadHumana(0.016851)).toBe('1 pedido cada ~59 min');
    // 1/0.011916 = 83.9 -> 84
    expect(capacidadHumana(0.011916)).toBe('1 pedido cada ~84 min');
  });

  it('capacidad 0 (o negativa) = nadie disponible, no una división por cero', () => {
    expect(capacidadHumana(0)).toBe('nadie disponible');
    expect(capacidadHumana(-0.01)).toBe('nadie disponible');
  });

  it('null -> em dash (corridas sin auditoría)', () => {
    expect(capacidadHumana(null)).toBe('—');
  });

  it('capacidad altísima no produce "1 pedido cada ~1 min" redundante', () => {
    expect(capacidadHumana(0.8)).toBe('más de 1 pedido por minuto');
  });

  it('capacidad ínfima usa separador de miles (zona 8 real: 0,000414 -> ~2.415 min)', () => {
    expect(capacidadHumana(0.000414)).toBe('1 pedido cada ~2.415 min');
  });
});

describe('sufijosPunto()', () => {
  it('punto limpio -> sin marcas', () => {
    expect(sufijosPunto({ sin_capacidad: false, clampeado: null, ritmo_origen: 'CHOFER' })).toEqual([]);
  });

  it('techo y mínimo se dicen', () => {
    expect(sufijosPunto({ sin_capacidad: false, clampeado: 'MAX', ritmo_origen: 'ZONA' })).toEqual(['techo']);
    expect(sufijosPunto({ sin_capacidad: false, clampeado: 'MIN', ritmo_origen: 'ZONA' })).toEqual(['mínimo']);
  });

  it('sin móviles TAPA el techo: informar 120 sin nadie no es un clamp del modelo', () => {
    expect(sufijosPunto({ sin_capacidad: true, clampeado: 'MAX', ritmo_origen: 'DEFECTO' }))
      .toEqual(['sin móviles', 'ritmo por defecto']);
  });

  it('ritmo global/por defecto se marca (número menos confiable)', () => {
    expect(sufijosPunto({ sin_capacidad: false, clampeado: null, ritmo_origen: 'GLOBAL' })).toEqual(['ritmo global']);
    expect(sufijosPunto({ sin_capacidad: false, clampeado: null, ritmo_origen: 'DEFECTO' })).toEqual(['ritmo por defecto']);
  });
});

describe('detalleUltimaCorrida()', () => {
  it('titulo: hora Montevideo + lo informado', () => {
    expect(detalleUltimaCorrida(corridaBase()).titulo).toBe('Última corrida 09:40 — informó 90 min');
  });

  it('corrida limpia: items en orden de lectura y SIN notas', () => {
    const d = detalleUltimaCorrida(corridaBase());
    expect(d.items.map((i) => i.label)).toEqual([
      'Resultado del modelo',
      'Pedidos por delante',
      'Móviles que aportan',
      'Capacidad',
      'Ritmo',
    ]);
    expect(d.notas).toEqual([]);
  });

  it('capacidad con escalones cuenta arranque, final y cuántos fueron', () => {
    const d = detalleUltimaCorrida(corridaBase());
    const cap = d.items.find((i) => i.label === 'Capacidad');
    // 1/0.011502 = 86.9 -> 87 ; 1/0.011916 = 83.9 -> 84
    expect(cap?.value).toBe('arrancó en 1 pedido cada ~87 min y terminó en 1 pedido cada ~84 min, en 2 escalones');
  });

  it('capacidad de un solo tramo se dice constante (no inventa escalones)', () => {
    // Zona 5 URGENTE real: 0.048406 constante, 1/0.048406 = 20.7 -> 21
    const d = detalleUltimaCorrida(corridaBase({ capacidad_inicial: 0.048406, capacidad_final: 0.048406, tramos: 1 }));
    expect(d.items.find((i) => i.label === 'Capacidad')?.value).toBe('1 pedido cada ~21 min (constante)');
  });

  it('capacidad inicial 0 con escalones: "arrancó sin nadie disponible" (no "arrancó en nadie...")', () => {
    // Zona 6 SERVICE real: 0 -> 0.010091 en 2 tramos. 1/0.010091 = 99.1 -> 99
    const d = detalleUltimaCorrida(corridaBase({ capacidad_inicial: 0, capacidad_final: 0.010091, tramos: 2 }));
    expect(d.items.find((i) => i.label === 'Capacidad')?.value)
      .toBe('arrancó sin nadie disponible y terminó en 1 pedido cada ~99 min, en 2 escalones');
  });

  it('ritmo: minutos por pedido + de dónde salió + cuántas muestras', () => {
    const d = detalleUltimaCorrida(corridaBase());
    expect(d.items.find((i) => i.label === 'Ritmo')?.value)
      .toBe('15.3 min por pedido · historia del chofer (214 muestras)');
  });

  it('valor del Despacho presente -> item propio; ausente -> ni aparece (SERVICE/NOCTURNO)', () => {
    const con = detalleUltimaCorrida(corridaBase({ as400: 35 }));
    expect(con.items.find((i) => i.label === 'Despacho en ese momento')?.value).toBe('35 min');
    const sin = detalleUltimaCorrida(corridaBase({ as400: null }));
    expect(sin.items.find((i) => i.label === 'Despacho en ese momento')).toBeUndefined();
  });

  it('techo (clamp MAX) lo explica CON el número crudo — zona 6 SERVICE real', () => {
    const d = detalleUltimaCorrida(corridaBase({ demora_informada: 120, demora_cruda: 143.83, clampeado: 'MAX' }));
    expect(d.notas).toEqual([
      'El modelo dio 143.8 min, por encima del máximo publicable: se informó el techo.',
    ]);
  });

  it('mínimo (clamp MIN) idem — zona 2 URGENTE real', () => {
    const d = detalleUltimaCorrida(corridaBase({ demora_informada: 30, demora_cruda: 17, clampeado: 'MIN' }));
    expect(d.notas).toEqual([
      'El modelo dio 17 min, por debajo del mínimo publicable: se informó el mínimo.',
    ]);
  });

  it('sin móviles activos TAPA la nota del clamp: el techo ahí es por definición, no por cálculo', () => {
    const d = detalleUltimaCorrida(corridaBase({ sin_capacidad: true, clampeado: 'MAX' }));
    expect(d.notas).toEqual([
      'No había ningún móvil activo en la zona: se informó el techo por definición, no por cálculo.',
    ]);
  });

  it('sin móviles + suavizado: NO afirma "se informó el techo" (la suba capada puede haber publicado menos)', () => {
    // Review iteración 2: zona que venía publicando 30, pierde su último
    // móvil → crudo 120, pero la suba se capa (subida_max 30) y publica 60.
    const d = detalleUltimaCorrida(
      corridaBase({ demora_informada: 60, demora_cruda: 120, sin_capacidad: true, clampeado: null, suavizado_aplicado: true }),
    );
    expect(d.notas).toEqual([
      'No había ningún móvil activo en la zona: corresponde el techo por definición, no por cálculo — pero el publicado se mueve de a pasos limitados por corrida (suavizado) y puede no haber llegado al techo todavía.',
    ]);
  });

  // ─── Suavizado: se marca en subas capadas Y en bajas capadas ─────────────
  // demoras_acabado corre crudo → clamp → suavizado → redondeo, y setea
  // suavizado_aplicado en AMBAS direcciones (sube hasta subida_max, baja
  // hasta bajada_max). Hallazgo Critical del review: la primera versión
  // afirmaba siempre "viene bajando", que en una suba capada es la dirección
  // CONTRARIA a la real.

  it('suavizado sin clamp, publicado por DEBAJO del modelo: está subiendo (no "bajando")', () => {
    const d = detalleUltimaCorrida(corridaBase({ demora_informada: 60, demora_cruda: 90, suavizado_aplicado: true }));
    expect(d.notas).toEqual([
      'El modelo pedía 90 min pero el publicado sube de a pasos limitados por corrida (suavizado): todavía está alcanzándolo.',
    ]);
  });

  it('suavizado sin clamp, publicado por ENCIMA del modelo: viene bajando', () => {
    const d = detalleUltimaCorrida(corridaBase({ demora_informada: 60, demora_cruda: 40, suavizado_aplicado: true }));
    expect(d.notas).toEqual([
      'El modelo ya da 40 min pero el publicado baja de a pasos limitados por corrida (suavizado): todavía viene bajando.',
    ]);
  });

  it('suavizado + clamp MAX: UNA sola nota combinada que no afirma "se informó el techo"', () => {
    // El escenario del review: cruda 200, techo 120, pero una suba capada dejó
    // el publicado en 75 — decir "se informó el techo" contradice al título.
    const d = detalleUltimaCorrida(
      corridaBase({ demora_informada: 75, demora_cruda: 200, clampeado: 'MAX', suavizado_aplicado: true }),
    );
    expect(d.notas).toEqual([
      'El modelo dio 200 min, por encima del máximo publicable, y además el publicado se mueve de a pasos limitados por corrida (suavizado): lo informado puede no coincidir ni con el modelo ni con el techo.',
    ]);
  });

  it('suavizado + clamp MIN: idem, combinada', () => {
    const d = detalleUltimaCorrida(
      corridaBase({ demora_informada: 60, demora_cruda: 17, clampeado: 'MIN', suavizado_aplicado: true }),
    );
    expect(d.notas).toHaveLength(1);
    expect(d.notas[0]).toMatch(/mínimo publicable/);
    expect(d.notas[0]).toMatch(/suavizado/);
  });

  it('suavizado sin cruda (fila vieja): nota genérica sin inventar dirección', () => {
    const d = detalleUltimaCorrida(corridaBase({ demora_cruda: null, suavizado_aplicado: true }));
    expect(d.notas).toContain('El publicado se mueve de a pasos limitados por corrida (suavizado).');
  });

  it('corrida sin auditoría (anterior a la migración): no inventa items y lo dice', () => {
    const d = detalleUltimaCorrida(
      corridaBase({
        demora_cruda: null,
        as400: 35,
        capacidad_inicial: null,
        capacidad_final: null,
        tramos: null,
        cola_por_delante: null,
        moviles_considerados: null,
        ritmo_usado: null,
        ritmo_origen: null,
        ritmo_muestras: null,
      }),
    );
    expect(d.items).toEqual([{ label: 'Despacho en ese momento', value: '35 min' }]);
    expect(d.notas).toEqual([
      'Esta corrida no tiene el detalle del modelo por tramos (es anterior a la migración).',
    ]);
  });

  it('ritmo sin muestras informadas: no agrega un "(— muestras)" vacío', () => {
    const d = detalleUltimaCorrida(corridaBase({ ritmo_muestras: null }));
    expect(d.items.find((i) => i.label === 'Ritmo')?.value).toBe('15.3 min por pedido · historia del chofer');
  });

  // ─── Perilla de arranque en modo DESPACHO (2026-08-04) ───────────────
  // Zona sin móviles Y sin pedidos: el run persiste cruda = valor del
  // Despacho — la nota tiene que contarlo, no mentir "se informó el techo".

  it('arranque Despacho: sin móviles + sin pedidos + cruda igual al Despacho -> nota de arranque, no de techo', () => {
    const d = detalleUltimaCorrida(
      corridaBase({ demora_informada: 45, demora_cruda: 45, as400: 45, cola_por_delante: 0, sin_capacidad: true, clampeado: null }),
    );
    expect(d.notas).toEqual([
      'Sin ningún móvil activo pero también sin pedidos: se informó el valor del Despacho como arranque, no un cálculo del modelo.',
    ]);
  });

  it('arranque Despacho + suavizado: la nota combina las dos cosas', () => {
    const d = detalleUltimaCorrida(
      corridaBase({ demora_informada: 60, demora_cruda: 45, as400: 45, cola_por_delante: 0, sin_capacidad: true, clampeado: null, suavizado_aplicado: true }),
    );
    expect(d.notas).toHaveLength(1);
    expect(d.notas[0]).toMatch(/valor del Despacho como arranque/);
    expect(d.notas[0]).toMatch(/suavizado/);
  });

  it('sin móviles pero CON pedidos esperando: sigue la nota de techo (el arranque no aplica)', () => {
    const d = detalleUltimaCorrida(
      corridaBase({ demora_informada: 120, demora_cruda: 120, as400: 45, cola_por_delante: 4, sin_capacidad: true, clampeado: null }),
    );
    expect(d.notas).toEqual([
      'No había ningún móvil activo en la zona: se informó el techo por definición, no por cálculo.',
    ]);
  });
});
