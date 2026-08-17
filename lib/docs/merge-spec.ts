/**
 * Merge del catálogo generado (docs/api/openapi.json) con las anotaciones a mano
 * (docs/api/anotaciones.yaml).
 *
 * Regla única: **la anotación siempre gana**. Lo generado no envejece pero tampoco
 * sabe quién consume un endpoint ni por qué existe; eso lo pone la anotación.
 *
 * Con UNA excepción: `x-auth` —los gates que el generador leyó del código— no se pisa
 * nunca. Si una anotación pudiera declarar que un endpoint está protegido, el apartado
 * "Estado de la autenticación" del portal dejaría de ser un relevamiento del código y
 * pasaría a ser una opinión. `auth_badges` solo cambia la etiqueta que se muestra.
 *
 * Claves soportadas por endpoint (ver docs/api/README.md): `resumen`, `descripcion`,
 * `consumidores`, `auth`, `auth_badges`, `parametros`, `cuerpo`, `respuestas`,
 * `errores`, `notas`, `ejemplos`.
 *
 * Las anotaciones que apuntan a un endpoint que ya no existe no se descartan en
 * silencio: salen en `x-anotaciones.huerfanas` para que se vean en el portal. Un
 * catálogo que miente es peor que uno incompleto.
 */

import { parseYamlSimple, type YamlValue } from './yaml-min';

type Objeto = Record<string, unknown>;

function esObjeto(v: unknown): v is Objeto {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Métodos que puede tener una clave de anotación (`POST /api/import/gps`). */
const METODOS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];

/** Texto de un valor de YAML, o undefined si no hay nada usable. */
function texto(valor: unknown): string | undefined {
  if (typeof valor === 'string' && valor.trim() !== '') return valor;
  if (typeof valor === 'number' || typeof valor === 'boolean') return String(valor);
  return undefined;
}

/**
 * `parametros:` → `parameters[]` de OpenAPI.
 *
 * Se mergea por (nombre, en): si el generador ya sacó el param del docblock, la
 * anotación lo completa (tipo, ejemplo, mejor descripción) en vez de duplicarlo.
 */
function mergearParametros(operacion: Objeto, anotados: unknown): void {
  if (!Array.isArray(anotados)) return;

  const previos = Array.isArray(operacion.parameters) ? (operacion.parameters as Objeto[]) : [];
  const salida = [...previos];

  for (const bruto of anotados) {
    if (!esObjeto(bruto)) continue;
    const nombre = texto(bruto.nombre ?? bruto.name);
    if (!nombre) continue;
    const donde = texto(bruto.en ?? bruto.in) ?? 'query';

    const param: Objeto = {
      name: nombre,
      in: donde,
      required: bruto.requerido === true || donde === 'path',
      description: texto(bruto.descripcion),
      schema: { type: texto(bruto.tipo) ?? 'string' },
    };
    if (bruto.ejemplo !== undefined && bruto.ejemplo !== null) param.example = bruto.ejemplo;

    const idx = salida.findIndex((p) => esObjeto(p) && p.name === nombre && p.in === donde);
    if (idx >= 0) salida[idx] = { ...salida[idx], ...param };
    else salida.push(param);
  }

  operacion.parameters = salida;
}

/** `cuerpo:` → `requestBody` (con `x-campos` para la tabla de campos del visor). */
function mergearCuerpo(operacion: Objeto, anotado: unknown): void {
  if (!esObjeto(anotado)) return;

  const contentType = texto(anotado.contentType ?? anotado.content_type) ?? 'application/json';
  const contenido: Objeto = {};
  if (anotado.ejemplo !== undefined && anotado.ejemplo !== null) contenido.example = anotado.ejemplo;
  if (anotado.schema !== undefined) contenido.schema = anotado.schema;

  const campos = Array.isArray(anotado.campos)
    ? anotado.campos.filter(esObjeto).map((c) => ({
        nombre: texto(c.nombre) ?? '',
        tipo: texto(c.tipo),
        requerido: c.requerido === true,
        descripcion: texto(c.descripcion),
      }))
    : [];

  operacion.requestBody = {
    description: texto(anotado.descripcion),
    required: anotado.requerido === true,
    content: { [contentType]: contenido },
    'x-campos': campos,
  };
}

/** `respuestas:` → completa `responses[código]` con descripción y ejemplo. */
function mergearRespuestas(operacion: Objeto, anotadas: unknown): void {
  if (!esObjeto(anotadas)) return;

  const respuestas = esObjeto(operacion.responses) ? (operacion.responses as Objeto) : {};

  for (const [codigo, valor] of Object.entries(anotadas)) {
    if (!esObjeto(valor)) continue;
    const previa = esObjeto(respuestas[codigo]) ? (respuestas[codigo] as Objeto) : {};
    const descripcion = texto(valor.descripcion) ?? texto(previa.description);

    const nueva: Objeto = { ...previa };
    if (descripcion) nueva.description = descripcion;
    if (valor.ejemplo !== undefined && valor.ejemplo !== null) {
      const contentType = texto(valor.contentType) ?? 'application/json';
      nueva.content = { [contentType]: { example: valor.ejemplo } };
    }
    respuestas[codigo] = nueva;
  }

  operacion.responses = respuestas;
}

export interface ResultadoMerge {
  spec: Objeto;
  anotados: number;
  huerfanas: string[];
}

/**
 * Aplica las anotaciones sobre una copia del spec generado.
 *
 * @param specGenerado documento OpenAPI producido por `pnpm docs:api`
 * @param yamlCrudo    contenido de anotaciones.yaml, o null si el archivo no existe
 */
export function mergearAnotaciones(specGenerado: Objeto, yamlCrudo: string | null): ResultadoMerge {
  const spec = JSON.parse(JSON.stringify(specGenerado)) as Objeto;

  if (yamlCrudo === null || yamlCrudo.trim() === '') {
    spec['x-anotaciones'] = { disponible: false, anotados: 0, huerfanas: [] };
    return { spec, anotados: 0, huerfanas: [] };
  }

  let anotaciones: YamlValue;
  try {
    anotaciones = parseYamlSimple(yamlCrudo);
  } catch (error) {
    // Un YAML roto no puede tumbar el catálogo: se sirve lo generado y se avisa.
    console.error('[docs/merge-spec] anotaciones.yaml no se pudo parsear', error);
    spec['x-anotaciones'] = {
      disponible: false,
      error: error instanceof Error ? error.message : String(error),
      anotados: 0,
      huerfanas: [],
    };
    return { spec, anotados: 0, huerfanas: [] };
  }

  if (!esObjeto(anotaciones)) {
    spec['x-anotaciones'] = { disponible: false, anotados: 0, huerfanas: [] };
    return { spec, anotados: 0, huerfanas: [] };
  }

  const paths = esObjeto(spec.paths) ? spec.paths : {};
  const huerfanas: string[] = [];
  let anotados = 0;

  // ── Endpoints ──────────────────────────────────────────────────────────────
  const endpoints = anotaciones.endpoints;
  if (esObjeto(endpoints)) {
    for (const [clave, valor] of Object.entries(endpoints)) {
      if (!esObjeto(valor)) continue;

      const partes = clave.trim().split(/\s+/);
      const metodo = (partes[0] ?? '').toLowerCase();
      const ruta = partes.slice(1).join(' ');
      if (!METODOS.includes(metodo) || ruta === '') {
        huerfanas.push(clave);
        continue;
      }

      const item = paths[ruta];
      const operacion = esObjeto(item) ? item[metodo] : undefined;
      if (!esObjeto(operacion)) {
        huerfanas.push(clave);
        continue;
      }

      if (typeof valor.resumen === 'string') operacion.summary = valor.resumen;
      if (typeof valor.descripcion === 'string') operacion.description = valor.descripcion;
      if (valor.consumidores !== undefined) operacion['x-consumidores'] = valor.consumidores;
      if (valor.auth !== undefined) operacion['x-auth-nota'] = valor.auth;
      // `x-auth` (lo que el generador leyó del código) NO se pisa nunca: los badges
      // declarados solo cambian cómo se etiqueta, no qué gates dice que hay.
      if (valor.auth_badges !== undefined) operacion['x-auth-badges'] = valor.auth_badges;
      if (valor.notas !== undefined) operacion['x-notas'] = valor.notas;
      if (valor.ejemplos !== undefined) operacion['x-ejemplos'] = valor.ejemplos;
      if (valor.errores !== undefined) operacion['x-errores'] = valor.errores;
      mergearParametros(operacion, valor.parametros);
      mergearCuerpo(operacion, valor.cuerpo);
      mergearRespuestas(operacion, valor.respuestas);
      operacion['x-anotado'] = true;
      anotados++;
    }
  }

  // ── Módulos → descripción de los tags ──────────────────────────────────────
  const modulos = anotaciones.modulos;
  if (esObjeto(modulos) && Array.isArray(spec.tags)) {
    for (const tag of spec.tags as Objeto[]) {
      const nota = modulos[String(tag.name)];
      if (esObjeto(nota) && typeof nota.descripcion === 'string') tag.description = nota.descripcion;
    }
  }

  spec['x-anotaciones'] = {
    disponible: true,
    version: anotaciones.version ?? null,
    anotados,
    huerfanas,
  };

  return { spec, anotados, huerfanas };
}
