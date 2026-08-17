/**
 * Merge del catálogo generado (docs/api/openapi.json) con las anotaciones a mano
 * (docs/api/anotaciones.yaml).
 *
 * Regla única: **la anotación siempre gana**. Lo generado no envejece pero tampoco
 * sabe quién consume un endpoint ni por qué existe; eso lo pone la anotación.
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
      if (valor.notas !== undefined) operacion['x-notas'] = valor.notas;
      if (valor.ejemplos !== undefined) operacion['x-ejemplos'] = valor.ejemplos;
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
