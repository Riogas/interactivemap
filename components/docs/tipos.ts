/**
 * Forma del documento que sirve `GET /api/docs/spec`: el OpenAPI 3.1 generado por
 * `pnpm docs:api` mergeado con `docs/api/anotaciones.yaml`.
 *
 * Son tipos LAXOS a propósito (casi todo opcional): el documento se arma en runtime
 * a partir de un JSON versionado y un YAML escrito a mano, así que el visor tiene que
 * poder renderizar un endpoint al que le falte cualquier cosa sin romperse.
 *
 * Las extensiones `x-*` son nuestras; las produce el generador (`x-auth`, `x-archivo`)
 * o el merge de anotaciones (`x-consumidores`, `x-notas`, `x-ejemplos`, `x-errores`).
 */

/** Gates que el generador encontró invocados en el handler. */
export interface AuthGenerada {
  gates?: string[];
  funcionalidades?: string[];
  /** true = el handler no invoca ningún gate. Es el dato más sensible del catálogo. */
  sinGate?: boolean;
}

export interface Parametro {
  name: string;
  in: string;
  required?: boolean;
  description?: string;
  schema?: { type?: string; format?: string; enum?: unknown[] };
  /** Valor de ejemplo para prellenar el formulario del "Try it". */
  example?: string | number | boolean;
}

export interface Respuesta {
  description?: string;
  content?: Record<string, { example?: unknown; schema?: unknown }>;
}

/** Una fila de la tabla de campos del cuerpo del request (viene de las anotaciones). */
export interface CampoCuerpo {
  nombre: string;
  tipo?: string;
  requerido?: boolean;
  descripcion?: string;
}

export interface CuerpoRequest {
  description?: string;
  required?: boolean;
  content?: Record<string, { example?: unknown; schema?: unknown }>;
  'x-campos'?: CampoCuerpo[];
}

export interface ErrorConocido {
  codigo?: number | string;
  code?: string;
  cuando?: string;
  solucion?: string;
}

export interface EjemploAnotado {
  titulo?: string;
  lenguaje?: string;
  codigo?: string;
}

export interface Operacion {
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: Parametro[];
  requestBody?: CuerpoRequest;
  responses?: Record<string, Respuesta>;
  deprecated?: boolean;

  'x-auth'?: AuthGenerada;
  /** Archivo del repo que implementa el handler. */
  'x-archivo'?: string;
  'x-generado'?: boolean;
  /** true si tiene entrada en anotaciones.yaml. */
  'x-anotado'?: boolean;
  'x-consumidores'?: string[] | string;
  'x-auth-nota'?: string;
  /** Badges de autenticación declarados a mano; ganan sobre los inferidos. */
  'x-auth-badges'?: string[];
  'x-notas'?: string;
  'x-ejemplos'?: EjemploAnotado[];
  'x-errores'?: ErrorConocido[];
}

export interface Servidor {
  url: string;
  description?: string;
}

export interface SpecDocs {
  openapi?: string;
  info?: { title?: string; version?: string; description?: string };
  servers?: Servidor[];
  tags?: Array<{ name: string; description?: string }>;
  paths?: Record<string, Record<string, Operacion>>;
  'x-excluidos'?: Array<{ archivo: string; motivo: string }>;
  'x-resumen'?: Record<string, number>;
  'x-anotaciones'?: {
    disponible?: boolean;
    anotados?: number;
    huerfanas?: string[];
    error?: string;
    version?: unknown;
  };
}

/** Un endpoint del catálogo, ya aplanado (una fila = un método + un path). */
export interface Endpoint {
  /** `GET /api/pedidos` — estable, sirve de key de React y de ancla en la URL. */
  id: string;
  metodo: string;
  ruta: string;
  modulo: string;
  op: Operacion;
}

export type TonoBadge = 'peligro' | 'aviso' | 'ok' | 'neutro';

export interface BadgeAuth {
  etiqueta: string;
  tono: TonoBadge;
  /** Texto del `title`: por qué este badge dice lo que dice. */
  detalle?: string;
}
