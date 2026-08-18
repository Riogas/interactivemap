/**
 * Tests de la lógica del visor de /docs.
 *
 * Lo que se cuida acá es lo que el root LEE: que un endpoint sin gate se vea como
 * "SIN AUTH" y nunca como otra cosa, que el conteo del apartado "Estado de la
 * autenticación" sea el real, y que la búsqueda encuentre por path, método, módulo y
 * texto de la descripción.
 */

import { describe, it, expect } from 'vitest';
import {
  agruparPorModulo,
  ambienteDeHost,
  badgePrincipal,
  badgesAuth,
  esSinAuth,
  esSpoofeable,
  filtrarEndpoints,
  formatearCuerpo,
  listarEndpoints,
  parametrosDe,
  resumenAuth,
  tonoDeStatus,
} from './docs-logic';
import { ejemploCurl, ejemploFetch, ejemploVb6, ejemplosDe, rutaConValores, VALORES_VACIOS } from './ejemplos';
import type { SpecDocs } from './tipos';

const SPEC: SpecDocs = {
  tags: [{ name: 'import', description: 'Ingesta desde sistemas externos.' }, { name: 'zonas' }],
  paths: {
    '/api/import/gps': {
      post: {
        summary: 'Insertar registros de GPS tracking',
        description: 'AUTENTICACIÓN:\n- Opción 1: Header X-API-Key\n- Opción 2: Token en el body (app móvil)',
        tags: ['import'],
        'x-auth': { gates: ['header x-api-key'], funcionalidades: [], sinGate: false },
        'x-anotado': true,
        'x-consumidores': ['App móvil MoveIT'],
      },
    },
    '/api/import/pedidos': {
      post: {
        summary: 'Alta de pedidos del sender de GeneXus',
        tags: ['import'],
        'x-auth': { gates: ['requireApiKey'], funcionalidades: [], sinGate: false },
        'x-consumidores': ['Sender de GeneXus / SGM', 'Pantalla VB6 de despacho'],
      },
    },
    '/api/zonas': {
      get: {
        summary: 'Obtener todas las zonas disponibles',
        tags: ['zonas'],
        'x-auth': { gates: [], funcionalidades: [], sinGate: true },
      },
    },
    '/api/movil/{id}': {
      get: {
        summary: 'Detalle de un móvil',
        tags: ['zonas'],
        parameters: [{ name: 'escenario', in: 'query', required: true, description: 'requerido, int' }],
        'x-auth': {
          gates: ['header x-track-isroot (spoofeable)', 'requireAuth (sesión Supabase)'],
          funcionalidades: [],
          sinGate: false,
        },
      },
    },
  },
};

const ENDPOINTS = listarEndpoints(SPEC);

describe('listarEndpoints', () => {
  it('aplana paths × métodos y ordena por módulo → ruta', () => {
    expect(ENDPOINTS.map((e) => e.id)).toEqual([
      'POST /api/import/gps',
      'POST /api/import/pedidos',
      'GET /api/movil/{id}',
      'GET /api/zonas',
    ]);
  });

  it('un spec vacío no rompe nada', () => {
    expect(listarEndpoints(null)).toEqual([]);
    expect(listarEndpoints({})).toEqual([]);
  });
});

describe('badges de autenticación', () => {
  it('sin gate ⇒ SIN AUTH, y es el badge que manda', () => {
    const zonas = ENDPOINTS.find((e) => e.id === 'GET /api/zonas')!;

    expect(esSinAuth(zonas.op)).toBe(true);
    expect(badgesAuth(zonas.op).map((b) => b.etiqueta)).toEqual(['SIN AUTH']);
    expect(badgePrincipal(zonas.op).tono).toBe('peligro');
  });

  it('x-api-key se reconoce por el gate, escrito como sea', () => {
    const gps = ENDPOINTS.find((e) => e.id === 'POST /api/import/gps')!;
    const pedidos = ENDPOINTS.find((e) => e.id === 'POST /api/import/pedidos')!;

    expect(badgesAuth(gps.op).map((b) => b.etiqueta)).toContain('x-api-key');
    expect(badgesAuth(pedidos.op).map((b) => b.etiqueta)).toContain('x-api-key');
  });

  it('el token en el body sale del texto del handler, aunque el gate no lo diga', () => {
    const gps = ENDPOINTS.find((e) => e.id === 'POST /api/import/gps')!;

    expect(badgesAuth(gps.op).map((b) => b.etiqueta)).toContain('token en body');
  });

  it('un gate por header forjable se marca como aviso, no como si fuera seguridad', () => {
    const movil = ENDPOINTS.find((e) => e.id === 'GET /api/movil/{id}')!;

    expect(esSpoofeable(movil.op)).toBe(true);
    const badge = badgesAuth(movil.op).find((b) => b.etiqueta === 'header x-track-isroot');
    expect(badge?.tono).toBe('aviso');
  });

  it('los badges declarados a mano ganan sobre los inferidos', () => {
    const badges = badgesAuth({ 'x-auth': { sinGate: true }, 'x-auth-badges': ['x-api-key'] });

    expect(badges.map((b) => b.etiqueta)).toEqual(['x-api-key']);
  });
});

describe('resumenAuth — los números del apartado de autenticación', () => {
  it('cuenta los que no validan nada y los deja listados', () => {
    const r = resumenAuth(ENDPOINTS);

    expect(r.total).toBe(4);
    expect(r.sinAuth.map((e) => e.id)).toEqual(['GET /api/zonas']);
    expect(r.porcentajeSinAuth).toBe(25);
    expect(r.spoofeables.map((e) => e.id)).toEqual(['GET /api/movil/{id}']);
    expect(r.porApiKey).toHaveLength(2);
    expect(r.anotados).toBe(1);
  });
});

describe('búsqueda', () => {
  it('encuentra por path', () => {
    expect(filtrarEndpoints(ENDPOINTS, 'import/gps').map((e) => e.id)).toEqual(['POST /api/import/gps']);
  });

  it('encuentra por módulo', () => {
    expect(filtrarEndpoints(ENDPOINTS, 'import')).toHaveLength(2);
  });

  it('una palabra que es un método filtra por método', () => {
    expect(filtrarEndpoints(ENDPOINTS, 'get').map((e) => e.metodo)).toEqual(['get', 'get']);
  });

  it('los términos se acumulan (AND)', () => {
    expect(filtrarEndpoints(ENDPOINTS, 'post import gps').map((e) => e.id)).toEqual(['POST /api/import/gps']);
  });

  it('busca en el texto de la descripción y sin acentos', () => {
    expect(filtrarEndpoints(ENDPOINTS, 'movil').map((e) => e.id)).toContain('POST /api/import/gps');
    expect(filtrarEndpoints(ENDPOINTS, 'autenticacion').map((e) => e.id)).toEqual(['POST /api/import/gps']);
  });

  it('encuentra por consumidor anotado', () => {
    expect(filtrarEndpoints(ENDPOINTS, 'genexus').map((e) => e.id)).toEqual(['POST /api/import/pedidos']);
  });

  it('el filtro "sin-auth" deja solo los que no validan nada', () => {
    expect(filtrarEndpoints(ENDPOINTS, '', 'sin-auth').map((e) => e.id)).toEqual(['GET /api/zonas']);
  });
});

describe('agruparPorModulo', () => {
  it('agrupa, describe y cuenta los sin gate de cada módulo', () => {
    const modulos = agruparPorModulo(ENDPOINTS, SPEC);

    expect(modulos.map((m) => m.nombre)).toEqual(['import', 'zonas']);
    expect(modulos[0].descripcion).toBe('Ingesta desde sistemas externos.');
    expect(modulos[1].sinAuth).toBe(1);
  });
});

describe('parametrosDe', () => {
  it('completa los parámetros de path que el generador no declara', () => {
    const movil = ENDPOINTS.find((e) => e.id === 'GET /api/movil/{id}')!;
    const params = parametrosDe(movil);

    expect(params[0]).toMatchObject({ name: 'id', in: 'path', required: true });
    expect(params[1]).toMatchObject({ name: 'escenario', in: 'query' });
  });
});

describe('ambienteDeHost', () => {
  it('la máquina del que desarrolla es LOCAL, en verde', () => {
    for (const host of ['localhost:3002', 'localhost', '127.0.0.1:3000', '[::1]:3002']) {
      const local = ambienteDeHost(host);
      expect(local.clave, host).toBe('LOCAL');
      expect(local.esProduccion, host).toBe(false);
      expect(local.tono, host).toBe('ok');
    }
  });

  it('un host con "dev" es DEV, en ámbar', () => {
    const dev = ambienteDeHost('track-dev.riogas.com.uy');

    expect(dev.clave).toBe('DEV');
    expect(dev.esProduccion).toBe(false);
    expect(dev.tono).toBe('aviso');
  });

  it('todo lo demás se asume PRODUCCIÓN, en rojo', () => {
    for (const host of ['track.glp.riogas.com.uy', '192.168.2.22:3002', '']) {
      const prod = ambienteDeHost(host);
      expect(prod.clave, host).toBe('PROD');
      expect(prod.esProduccion, host).toBe(true);
      expect(prod.tono, host).toBe('peligro');
    }
  });
});

describe('ejemplos copiables', () => {
  const gps = ENDPOINTS.find((e) => e.id === 'POST /api/import/gps')!;
  const movil = ENDPOINTS.find((e) => e.id === 'GET /api/movil/{id}')!;
  const pedidos = ENDPOINTS.find((e) => e.id === 'POST /api/import/pedidos')!;

  it('usan el origen del ambiente, no un host fijo', () => {
    const curl = ejemploCurl(gps, 'https://track-dev.riogas.com.uy', VALORES_VACIOS);

    expect(curl).toContain("'https://track-dev.riogas.com.uy/api/import/gps'");
    expect(curl).not.toContain('track.glp');
  });

  it('reflejan lo que hay cargado en el formulario', () => {
    const valores = {
      path: { id: '330' },
      query: { escenario: '1000' },
      headers: {},
      body: '',
    };

    expect(ejemploCurl(movil, 'http://localhost:3002', valores)).toContain(
      "'http://localhost:3002/api/movil/330?escenario=1000'",
    );
  });

  it('sin valor cargado, el parámetro de path queda como placeholder (sin llaves, que curl globea)', () => {
    expect(rutaConValores('/api/movil/{id}', {})).toBe('/api/movil/ID');
    expect(ejemploCurl(movil, 'http://x', VALORES_VACIOS)).not.toContain('{id}');
  });

  it('el curl de un endpoint con x-api-key sugiere el header', () => {
    expect(ejemploCurl(pedidos, 'http://x', VALORES_VACIOS)).toContain("-H 'x-api-key: TU_API_KEY'");
  });

  it('el fetch de un endpoint con sesión manda las cookies', () => {
    expect(ejemploFetch(movil, 'http://x', VALORES_VACIOS)).toContain("credentials: 'include'");
  });

  it('el cuerpo se escapa para el shell sin romper el comando', () => {
    const valores = { ...VALORES_VACIOS, body: `{"nota":"O'Higgins"}` };

    expect(ejemploCurl(gps, 'http://x', valores)).toContain(`-d '{"nota":"O'\\''Higgins"}'`);
  });

  it('el ejemplo VB6 aparece solo si hay un consumidor VB6', () => {
    expect(ejemplosDe(gps, 'http://x').map((e) => e.id)).toEqual(['curl', 'fetch']);
    expect(ejemplosDe(pedidos, 'http://x').map((e) => e.id)).toContain('vb6');
  });

  it('el VB6 duplica las comillas del literal, como manda VB', () => {
    const vb = ejemploVb6(pedidos, 'http://x', { ...VALORES_VACIOS, body: '{"a":1}' });

    expect(vb).toContain('http.send "{""a"":1}"');
    expect(vb).toContain('MSXML2.ServerXMLHTTP.6.0');
  });

  it('los ejemplos anotados a mano van al final', () => {
    const conAnotado = {
      ...gps,
      op: { ...gps.op, 'x-ejemplos': [{ titulo: 'curl real', codigo: 'curl ...' }] },
    };

    expect(ejemplosDe(conAnotado, 'http://x').at(-1)?.titulo).toBe('curl real');
  });
});

describe('utilidades de presentación', () => {
  it('el tono del status separa 2xx de 4xx y 5xx', () => {
    expect(tonoDeStatus(200)).toBe('ok');
    expect(tonoDeStatus(428)).toBe('aviso');
    expect(tonoDeStatus(503)).toBe('peligro');
  });

  it('el cuerpo JSON se indenta y el que no es JSON queda tal cual', () => {
    expect(formatearCuerpo('{"a":1}')).toBe('{\n  "a": 1\n}');
    expect(formatearCuerpo('<html>error</html>')).toBe('<html>error</html>');
  });
});
