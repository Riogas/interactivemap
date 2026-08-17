#!/usr/bin/env node
/**
 * Generador del catálogo de APIs de TrackMovil → docs/api/openapi.json (OpenAPI 3.1).
 *
 * Uso:  pnpm docs:api
 *
 * Qué hace: recorre app/api/ ** /route.ts, deriva el path desde la estructura de
 * carpetas, detecta los handlers HTTP exportados y extrae lo que puede del código:
 *
 *   - el docblock de cabecera del archivo (fuente PRIMARIA: en TrackMovil casi todos
 *     los handlers documentan ahí query params, gates y forma de la respuesta),
 *   - los gates de autenticación efectivamente invocados (requireAuth,
 *     requireFuncionalidad, requireApiKey, requireAllowlistedEmail, headers x-track-*),
 *   - los códigos de estado que el handler devuelve.
 *
 * NO inventa nada: si el docblock no dice, el campo no sale. Las descripciones ricas,
 * los consumidores y los ejemplos van a mano en docs/api/anotaciones.yaml, que se
 * mergea encima al servir GET /api/docs/spec.
 *
 * Es DETERMINISTA a propósito (sin timestamps, claves ordenadas): correrlo dos veces
 * sobre el mismo código produce byte a byte el mismo JSON, así el diff de git muestra
 * solo lo que cambió de verdad en las APIs.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR_API = path.join(RAIZ, 'app', 'api');
const SALIDA = path.join(RAIZ, 'docs', 'api', 'openapi.json');

const METODOS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

/**
 * Rutas excluidas del catálogo, con el motivo. Quedan igual en `x-excluidos` para que
 * el portal pueda mostrar que existen y por qué no están documentadas endpoint a endpoint.
 */
const EXCLUIDOS = [
  {
    archivo: 'app/api/proxy/[...path]/route.ts',
    motivo:
      'Catch-all que reenvía a la API legacy de GeneXus (EXTERNAL_API_URL). Se documenta que el proxy existe y a dónde apunta, no cada endpoint del otro lado.',
  },
  {
    archivo: 'app/api/doc/route.ts',
    motivo:
      'Endpoint roto: lee API_DOCUMENTATION.md, un archivo que ya no existe en el repo, y devuelve 500 siempre. Queda anotado hasta que se decida borrarlo o reescribirlo apuntando a este portal.',
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Recorrido de archivos
// ─────────────────────────────────────────────────────────────────────────────

function listarRutas(dir) {
  const out = [];
  for (const entrada of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const completo = path.join(dir, entrada.name);
    if (entrada.isDirectory()) out.push(...listarRutas(completo));
    else if (entrada.name === 'route.ts' || entrada.name === 'route.js') out.push(completo);
  }
  return out;
}

/** Ruta del repo con separadores POSIX (para comparar contra EXCLUIDOS y reportar). */
function rutaRelativa(archivo) {
  return path.relative(RAIZ, archivo).split(path.sep).join('/');
}

/**
 * app/api/movil/[id]/route.ts → /api/movil/{id}
 * Los grupos de rutas de Next `(grupo)` no forman parte de la URL.
 */
function pathDesdeArchivo(archivo) {
  const rel = path.relative(DIR_API, path.dirname(archivo)).split(path.sep).filter(Boolean);
  const segmentos = [];
  for (const seg of rel) {
    if (seg.startsWith('(') && seg.endsWith(')')) continue;
    if (seg.startsWith('[...') && seg.endsWith(']')) segmentos.push(`{${seg.slice(4, -1)}}`);
    else if (seg.startsWith('[') && seg.endsWith(']')) segmentos.push(`{${seg.slice(1, -1)}}`);
    else segmentos.push(seg);
  }
  return '/api' + (segmentos.length ? '/' + segmentos.join('/') : '');
}

// ─────────────────────────────────────────────────────────────────────────────
// Lectura del código
// ─────────────────────────────────────────────────────────────────────────────

/** Handlers HTTP exportados, en orden canónico. */
function detectarMetodos(fuente) {
  const encontrados = new Set();
  const re = new RegExp(
    `export\\s+(?:async\\s+)?function\\s+(${METODOS.join('|')})\\s*[(<]|export\\s+const\\s+(${METODOS.join('|')})\\s*[:=]`,
    'g',
  );
  let m;
  while ((m = re.exec(fuente)) !== null) encontrados.add(m[1] ?? m[2]);
  return METODOS.filter((x) => encontrados.has(x));
}

/** Convierte un docblock crudo en texto plano. */
function limpiarDocblock(bruto) {
  return bruto
    .replace(/^\/\*\*+/, '')
    .replace(/\*+\/$/, '')
    .split('\n')
    .map((l) => l.replace(/^\s*\*\s?/, ''))
    .join('\n')
    .trim();
}

/** Un docblock, sin permitir que el match se pase de largo hasta el siguiente. */
const DOCBLOCK = '\\/\\*\\*(?:(?!\\*\\/)[\\s\\S])*\\*\\/';

/**
 * Docblock de cabecera del endpoint. Dos casos, en orden:
 *   1. El archivo abre con un docblock (patrón dominante en los handlers nuevos).
 *   2. El archivo abre con imports y el docblock viene pegado al `export` del handler.
 * Si el primer docblock documenta una función interna (no exportada), se descarta:
 * ese archivo queda sin descripción y el conteo lo reporta.
 */
function docblockCabecera(fuente) {
  const sinBom = fuente.replace(/^﻿/, '');

  const alInicio = sinBom.match(new RegExp(`^\\s*(${DOCBLOCK})`));
  if (alInicio) return limpiarDocblock(alInicio[1]);

  const seguidoDeExport = sinBom.match(new RegExp(`(${DOCBLOCK})\\s*export\\s`));
  return seguidoDeExport ? limpiarDocblock(seguidoDeExport[1]) : null;
}

/** Docblock pegado (solo espacios en el medio) al `export ... METODO`. */
function docblockDelMetodo(fuente, metodo) {
  const re = new RegExp(
    `(${DOCBLOCK})\\s*export\\s+(?:async\\s+)?(?:function\\s+${metodo}\\s*[(<]|const\\s+${metodo}\\s*[:=])`,
  );
  const m = fuente.match(re);
  return m ? limpiarDocblock(m[1]) : null;
}

/**
 * Descarta la primera línea del docblock cuando es solo `GET /api/loquesea`, que es
 * información que ya tenemos derivada del árbol de carpetas.
 */
function quitarEncabezadoRedundante(texto) {
  const lineas = texto.split('\n');
  if (lineas.length > 0 && new RegExp(`^\\s*(?:${METODOS.join('|')})(?:\\s*[/,|]\\s*(?:${METODOS.join('|')}))*\\s+/\\S*\\s*$`).test(lineas[0])) {
    return lineas.slice(1).join('\n').trim();
  }
  return texto.trim();
}

/** Resumen corto: primera oración del docblock, acotada. */
function resumenDesde(texto) {
  const primerParrafo = texto.split(/\n\s*\n/)[0].replace(/\s+/g, ' ').trim();
  if (primerParrafo === '') return null;
  const corte = primerParrafo.match(/^(.{20,180}?\.)\s/);
  const bruto = corte ? corte[1] : primerParrafo;
  return bruto.length > 200 ? bruto.slice(0, 197) + '...' : bruto;
}

/**
 * Query params documentados en el docblock. Formato reconocido (el que usa el repo):
 *
 *   Query params:
 *     - escenario (requerido, int)
 *     - empresaIds: CSV de empresa_fletera_id
 */
function queryParamsDesde(texto) {
  const lineas = texto.split('\n');
  const params = [];
  let dentro = false;
  let actual = null;

  const cerrar = () => {
    if (actual) params.push(actual);
    actual = null;
  };

  for (const linea of lineas) {
    if (/^\s*(query\s*(params?|string)|par[áa]metros\s*(de\s*)?(query|url)?)\s*(opcionales\s*)?:/i.test(linea)) {
      cerrar();
      dentro = true;
      continue;
    }
    if (!dentro) continue;

    const item = linea.match(/^\s*[-*]\s*`?([A-Za-z_][\w.\[\]]*)`?\s*(?:\(([^)]*)\))?\s*[:—-]?\s*(.*)$/);
    if (item) {
      cerrar();
      const notas = (item[2] ?? '').trim();
      const desc = [notas, item[3].trim()].filter(Boolean).join(' — ');
      actual = {
        name: item[1],
        in: 'query',
        required: /requerid|obligatori/i.test(notas + ' ' + item[3]),
        description: desc || undefined,
      };
      continue;
    }
    if (/^\s{3,}\S/.test(linea) && actual) {
      actual.description = ((actual.description ?? '') + ' ' + linea.trim()).trim();
      continue;
    }
    if (linea.trim() === '') continue;
    cerrar();
    dentro = false;
  }
  cerrar();

  return params;
}

/** Params de path derivados del árbol de carpetas (`[id]` → `{id}`). */
function pathParams(rutaUrl) {
  return [...rutaUrl.matchAll(/\{([^}]+)\}/g)].map((m) => ({
    name: m[1],
    in: 'path',
    required: true,
    schema: { type: 'string' },
  }));
}

/**
 * Saca comentarios para que la detección de gates mire CÓDIGO y no prosa. Sin esto, un
 * docblock que dice "no usa x-track-isroot" hacía que el endpoint figurara usándolo.
 * Solo se quitan los `//` que abren la línea: así una URL `https://...` queda intacta.
 */
function quitarComentarios(fuente) {
  return fuente.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/.*$/gm, ' ');
}

/**
 * Autenticación REAL del handler: qué gates se invocan en el archivo. Es lo que hace
 * valioso al portal — deja a la vista qué endpoints no validan nada.
 */
function detectarAuth(fuenteConComentarios) {
  const fuente = quitarComentarios(fuenteConComentarios);
  const gates = [];
  const funcionalidades = [];

  if (/\brequireAuth\s*\(/.test(fuente)) gates.push('requireAuth (sesión Supabase)');
  if (/\brequireApiKey\s*\(/.test(fuente)) gates.push('requireApiKey');
  if (/\brequireRole\s*\(/.test(fuente)) gates.push('requireRole');
  if (/\brequireAllowlistedEmail\s*\(/.test(fuente)) gates.push('requireAllowlistedEmail (env)');
  if (/\brequireRoot\s*\(/.test(fuente)) gates.push('requireRoot (verificado contra secapi)');

  for (const m of fuente.matchAll(/requireFuncionalidad\s*\(\s*[^,]+,\s*['"]([^'"]+)['"]/g)) {
    gates.push('requireFuncionalidad');
    if (!funcionalidades.includes(m[1])) funcionalidades.push(m[1]);
  }

  if (/x-track-isroot/i.test(fuente)) gates.push('header x-track-isroot (spoofeable)');
  if (/x-api-key/i.test(fuente)) gates.push('header x-api-key');
  if (/API_?KEY/.test(fuente) && !gates.some((g) => g.includes('api-key'))) gates.push('API key por env');

  const unicos = [...new Set(gates)].sort();
  return {
    gates: unicos,
    funcionalidades: funcionalidades.sort(),
    // Sin ningún gate el handler es alcanzable por cualquiera que llegue al puerto.
    sinGate: unicos.length === 0,
  };
}

const TEXTO_ESTADO = {
  200: 'OK',
  201: 'Creado',
  202: 'Aceptado (procesamiento diferido)',
  204: 'Sin contenido',
  207: 'Multi-estado',
  304: 'Sin cambios',
  400: 'Request inválido',
  401: 'No autenticado',
  403: 'Acceso denegado',
  404: 'No encontrado',
  409: 'Conflicto',
  413: 'Payload demasiado grande',
  422: 'Entidad no procesable',
  429: 'Demasiadas requests',
  500: 'Error interno',
  502: 'Error del upstream',
  503: 'Servicio no disponible',
  504: 'Timeout del upstream',
};

/** Códigos de estado que el archivo devuelve explícitamente (+ 200, que Next pone por default). */
function detectarEstados(fuenteConComentarios) {
  const fuente = quitarComentarios(fuenteConComentarios);
  const codigos = new Set([200]);
  for (const m of fuente.matchAll(/status\s*:\s*(\d{3})/g)) codigos.add(Number(m[1]));
  for (const m of fuente.matchAll(/\bstatus\s*=\s*(\d{3})/g)) codigos.add(Number(m[1]));
  return [...codigos].sort((a, b) => a - b);
}

/** Módulo = primer segmento después de /api. Es el agrupador del portal. */
function moduloDe(rutaUrl) {
  const seg = rutaUrl.split('/').filter(Boolean);
  return seg.length > 1 ? seg[1] : 'raiz';
}

function operationId(metodo, rutaUrl) {
  const partes = rutaUrl
    .split('/')
    .filter(Boolean)
    .map((s) => s.replace(/[{}]/g, '').replace(/[^A-Za-z0-9]+(.)?/g, (_, c) => (c ? c.toUpperCase() : '')));
  const camel = partes.map((p, i) => (i === 0 ? p : p.charAt(0).toUpperCase() + p.slice(1))).join('');
  return metodo.toLowerCase() + camel.charAt(0).toUpperCase() + camel.slice(1);
}

/** Ordena las claves de un objeto para que el JSON sea estable entre corridas. */
function ordenar(valor) {
  if (Array.isArray(valor)) return valor.map(ordenar);
  if (valor && typeof valor === 'object') {
    const out = {};
    for (const k of Object.keys(valor).sort()) out[k] = ordenar(valor[k]);
    return out;
  }
  return valor;
}

// ─────────────────────────────────────────────────────────────────────────────
// Generación
// ─────────────────────────────────────────────────────────────────────────────

function generar() {
  const pkg = JSON.parse(fs.readFileSync(path.join(RAIZ, 'package.json'), 'utf-8'));
  const archivos = listarRutas(DIR_API);
  const excluidos = new Set(EXCLUIDOS.map((e) => e.archivo));

  const paths = {};
  const modulos = new Set();
  const idsUsados = new Set();
  let endpoints = 0;
  let sinDocblock = 0;
  let sinGate = 0;

  for (const archivo of archivos) {
    const rel = rutaRelativa(archivo);
    if (excluidos.has(rel)) continue;

    // Normalizar CRLF: buena parte del repo está en CRLF y `.` de las regex no matchea \r.
    const fuente = fs.readFileSync(archivo, 'utf-8').replace(/\r\n?/g, '\n');
    const rutaUrl = pathDesdeArchivo(archivo);
    const metodos = detectarMetodos(fuente);
    if (metodos.length === 0) continue;

    const cabecera = docblockCabecera(fuente);
    const auth = detectarAuth(fuente);
    const estados = detectarEstados(fuente);
    const modulo = moduloDe(rutaUrl);
    modulos.add(modulo);

    for (const metodo of metodos) {
      const doc = docblockDelMetodo(fuente, metodo) ?? cabecera;
      const texto = doc ? quitarEncabezadoRedundante(doc) : null;
      if (!texto) sinDocblock++;

      const parametros = [...pathParams(rutaUrl)];
      if (texto && (metodo === 'GET' || metodo === 'HEAD' || metodo === 'DELETE')) {
        for (const p of queryParamsDesde(texto)) {
          if (!parametros.some((x) => x.name === p.name)) parametros.push({ ...p, schema: { type: 'string' } });
        }
      }

      const responses = {};
      for (const codigo of estados) {
        responses[String(codigo)] = { description: TEXTO_ESTADO[codigo] ?? 'Respuesta' };
      }

      let id = operationId(metodo, rutaUrl);
      if (idsUsados.has(id)) {
        let n = 2;
        while (idsUsados.has(`${id}_${n}`)) n++;
        id = `${id}_${n}`;
      }
      idsUsados.add(id);

      const operacion = {
        operationId: id,
        tags: [modulo],
        summary: (texto && resumenDesde(texto)) || `${metodo} ${rutaUrl}`,
        responses,
        'x-archivo': rel,
        'x-auth': auth,
        'x-generado': true,
      };
      if (texto) operacion.description = texto;
      if (parametros.length > 0) operacion.parameters = parametros;
      if (auth.sinGate) sinGate++;

      paths[rutaUrl] = paths[rutaUrl] ?? {};
      paths[rutaUrl][metodo.toLowerCase()] = operacion;
      endpoints++;
    }
  }

  const documento = {
    openapi: '3.1.0',
    info: {
      title: 'TrackMovil — API',
      version: pkg.version ?? '0.0.0',
      description: [
        'Catálogo de las APIs propias de TrackMovil (RiogasTracking, app 5 en SecuritySuite).',
        '',
        'GENERADO por `pnpm docs:api` a partir de app/api/**/route.ts. No editar a mano:',
        'las descripciones, los consumidores y los ejemplos van en docs/api/anotaciones.yaml,',
        'que se mergea encima al servir GET /api/docs/spec.',
        '',
        '`x-auth` refleja los gates que el handler REALMENTE invoca. `x-auth.sinGate: true`',
        'significa que el endpoint no valida nada: es información sensible y por eso este',
        'portal es solo-root.',
      ].join('\n'),
    },
    // Solo el hostname público. Las direcciones internas NO se versionan: este JSON
    // vive en el repo y el repo se clona. El origen contra el que ejecuta el "Try it"
    // lo agrega GET /api/docs/spec en tiempo de servido, resuelto en el servidor desde
    // DOCS_TRY_ORIGEN o el PORT del proceso — nunca desde el Host del request
    // (lib/docs/servidores.ts).
    servers: [{ url: 'https://track.glp.riogas.com.uy', description: 'producción' }],
    tags: [...modulos].sort().map((m) => ({ name: m })),
    paths: ordenar(paths),
    components: {
      securitySchemes: {
        sesionSupabase: {
          type: 'http',
          scheme: 'bearer',
          description: 'Sesión de Supabase Auth validada por requireAuth (lib/auth-middleware.ts).',
        },
        apiKey: {
          type: 'apiKey',
          in: 'header',
          name: 'x-api-key',
          description: 'API key de integraciones externas (sender GeneXus/SGM, VB6).',
        },
        tokenSecapi: {
          type: 'http',
          scheme: 'bearer',
          description: 'JWT emitido por SecuritySuite. Es el que verifica lib/docs/root-guard.ts contra secapi.',
        },
      },
    },
    'x-excluidos': EXCLUIDOS,
    'x-resumen': {
      archivosRuta: archivos.length,
      archivosExcluidos: EXCLUIDOS.length,
      endpoints,
      endpointsSinDocblock: sinDocblock,
      endpointsSinGate: sinGate,
      modulos: modulos.size,
    },
  };

  return documento;
}

const documento = generar();
fs.mkdirSync(path.dirname(SALIDA), { recursive: true });
fs.writeFileSync(SALIDA, JSON.stringify(documento, null, 2) + '\n', 'utf-8');

const r = documento['x-resumen'];
console.log(`docs:api → ${rutaRelativa(SALIDA)}`);
console.log(`  route.ts encontrados : ${r.archivosRuta} (excluidos: ${r.archivosExcluidos})`);
console.log(`  endpoints            : ${r.endpoints} en ${r.modulos} módulos`);
console.log(`  sin docblock         : ${r.endpointsSinDocblock}`);
console.log(`  sin ningún gate      : ${r.endpointsSinGate}`);
