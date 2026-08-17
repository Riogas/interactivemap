/**
 * Lógica pura del visor de `/docs`: aplanar el catálogo, buscar, clasificar la
 * autenticación y resumir el estado real de los gates.
 *
 * Está separada de los componentes a propósito: los tests corren en entorno `node`
 * (vitest.config.ts) y no montan React, así que todo lo que valga la pena testear
 * —que es justamente lo que decide qué badge ve el root— tiene que vivir acá.
 */

import type {
  BadgeAuth,
  Endpoint,
  Operacion,
  Parametro,
  SpecDocs,
  TonoBadge,
} from './tipos';

/** Orden de los métodos en las listas: lectura primero, borrado último. */
export const ORDEN_METODOS = ['get', 'head', 'post', 'put', 'patch', 'delete', 'options'];

export const COLOR_METODO: Record<string, string> = {
  get: 'bg-stats-info-soft text-stats-info',
  head: 'bg-stats-info-soft text-stats-info',
  post: 'bg-stats-success-soft text-stats-success',
  put: 'bg-stats-warning-soft text-stats-warning',
  patch: 'bg-stats-warning-soft text-stats-warning',
  delete: 'bg-stats-destructive-soft text-stats-destructive',
  options: 'bg-stats-neutral-soft text-stats-neutral',
};

/** Aplana `paths` a una lista ordenada por módulo → ruta → método. */
export function listarEndpoints(spec: SpecDocs | null): Endpoint[] {
  const out: Endpoint[] = [];
  for (const [ruta, operaciones] of Object.entries(spec?.paths ?? {})) {
    for (const [metodo, op] of Object.entries(operaciones ?? {})) {
      if (typeof op !== 'object' || op === null) continue;
      out.push({
        id: `${metodo.toUpperCase()} ${ruta}`,
        metodo: metodo.toLowerCase(),
        ruta,
        modulo: op.tags?.[0] ?? 'sin-modulo',
        op,
      });
    }
  }
  out.sort(
    (a, b) =>
      a.modulo.localeCompare(b.modulo) ||
      a.ruta.localeCompare(b.ruta) ||
      ORDEN_METODOS.indexOf(a.metodo) - ORDEN_METODOS.indexOf(b.metodo),
  );
  return out;
}

export interface Modulo {
  nombre: string;
  descripcion?: string;
  endpoints: Endpoint[];
  /** Cuántos de sus endpoints no validan nada. */
  sinAuth: number;
}

/** Agrupa por módulo conservando el orden alfabético y sumando los sin gate. */
export function agruparPorModulo(endpoints: Endpoint[], spec: SpecDocs | null): Modulo[] {
  const descripciones = new Map<string, string>();
  for (const tag of spec?.tags ?? []) {
    if (tag?.name && tag.description) descripciones.set(tag.name, tag.description);
  }

  const grupos = new Map<string, Endpoint[]>();
  for (const e of endpoints) {
    const lista = grupos.get(e.modulo);
    if (lista) lista.push(e);
    else grupos.set(e.modulo, [e]);
  }

  return [...grupos.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([nombre, lista]) => ({
      nombre,
      descripcion: descripciones.get(nombre),
      endpoints: lista,
      sinAuth: lista.filter((e) => esSinAuth(e.op)).length,
    }));
}

/** true si el generador no encontró ningún gate invocado en el handler. */
export function esSinAuth(op: Operacion): boolean {
  return op['x-auth']?.sinGate === true;
}

/** true si alguno de sus gates es un header que el cliente puede escribir a mano. */
export function esSpoofeable(op: Operacion): boolean {
  if (esSinAuth(op)) return false;
  return (op['x-auth']?.gates ?? []).some((g) => /x-track-isroot/i.test(g));
}

/** Badges declarados a mano en anotaciones.yaml (`auth_badges:`). */
const BADGES_CONOCIDOS: Record<string, BadgeAuth> = {
  jwt: { etiqueta: 'JWT', tono: 'ok', detalle: 'Bearer emitido por SecuritySuite.' },
  'x-api-key': {
    etiqueta: 'x-api-key',
    tono: 'ok',
    detalle: 'API key compartida con el sistema que consume el endpoint.',
  },
  'token en body': {
    etiqueta: 'token en body',
    tono: 'aviso',
    detalle: 'El secreto viaja DENTRO del cuerpo del request, no en un header.',
  },
  'sin auth': {
    etiqueta: 'SIN AUTH',
    tono: 'peligro',
    detalle: 'El handler no valida nada: cualquiera que llegue al puerto lo puede llamar.',
  },
  sesion: {
    etiqueta: 'Sesión Supabase',
    tono: 'ok',
    detalle: 'Cookie de sesión de Supabase verificada server-side.',
  },
};

/** gate del generador → badge que ve el root. El orden importa: el primero manda. */
const REGLAS_GATES: Array<{ patron: RegExp; badge: BadgeAuth }> = [
  {
    patron: /requireRoot/i,
    badge: {
      etiqueta: 'JWT root',
      tono: 'ok',
      detalle: 'Firma del JWT verificada (HS256) + permiso consultado a SecuritySuite en cada request.',
    },
  },
  {
    patron: /requireApiKey|x-api-key/i,
    badge: {
      etiqueta: 'x-api-key',
      tono: 'ok',
      detalle: 'Header x-api-key comparado contra INTERNAL_API_KEY (timing-safe).',
    },
  },
  {
    patron: /requireAuth/i,
    badge: { etiqueta: 'Sesión Supabase', tono: 'ok', detalle: 'requireAuth: cookie de sesión de Supabase.' },
  },
  {
    patron: /requireFuncionalidad/i,
    badge: {
      etiqueta: 'Permiso RBAC',
      tono: 'neutro',
      detalle: 'requireFuncionalidad: se exige una funcionalidad de SecuritySuite.',
    },
  },
  {
    patron: /requireAllowlistedEmail/i,
    badge: {
      etiqueta: 'Allowlist de email',
      tono: 'neutro',
      detalle: 'El email tiene que estar en la env de allowlist.',
    },
  },
  {
    patron: /x-track-isroot/i,
    badge: {
      etiqueta: 'header x-track-isroot',
      tono: 'aviso',
      detalle: 'Lo pone el front y cualquiera lo puede forjar: como gate no alcanza.',
    },
  },
];

/** Detecta el patrón "token adentro del cuerpo" en el texto del handler o de la nota. */
function mencionaTokenEnBody(op: Operacion): boolean {
  const texto = `${op.description ?? ''} ${op['x-auth-nota'] ?? ''}`;
  return /token\s+(en\s+el\s+|dentro\s+del\s+|en\s+)?body|token\s+en\s+el\s+cuerpo/i.test(texto);
}

/**
 * Badges de autenticación de un endpoint, en el orden en que se muestran.
 *
 * Prioridad: lo declarado a mano (`auth_badges` en anotaciones.yaml) gana sobre lo
 * inferido de los gates, porque el generador ve qué función se llama pero no qué
 * significa. Sin anotación, se derivan de `x-auth.gates`.
 */
export function badgesAuth(op: Operacion): BadgeAuth[] {
  const declarados = op['x-auth-badges'];
  if (Array.isArray(declarados) && declarados.length > 0) {
    return declarados.map(
      (clave) => BADGES_CONOCIDOS[String(clave).trim().toLowerCase()] ?? { etiqueta: String(clave), tono: 'neutro' },
    );
  }

  if (esSinAuth(op)) return [BADGES_CONOCIDOS['sin auth']];

  const gates = op['x-auth']?.gates ?? [];
  const badges: BadgeAuth[] = [];
  for (const regla of REGLAS_GATES) {
    if (gates.some((g) => regla.patron.test(g))) badges.push(regla.badge);
  }
  if (mencionaTokenEnBody(op)) badges.push(BADGES_CONOCIDOS['token en body']);

  return badges.length > 0 ? badges : [{ etiqueta: 'sin clasificar', tono: 'neutro' }];
}

/** El badge que define la fila en las listas (el peor tono manda). */
export function badgePrincipal(op: Operacion): BadgeAuth {
  const badges = badgesAuth(op);
  const peso: Record<TonoBadge, number> = { peligro: 0, aviso: 1, neutro: 2, ok: 3 };
  return [...badges].sort((a, b) => peso[a.tono] - peso[b.tono])[0];
}

export interface ResumenAuth {
  total: number;
  sinAuth: Endpoint[];
  spoofeables: Endpoint[];
  porApiKey: Endpoint[];
  conSesion: Endpoint[];
  anotados: number;
  /** Porcentaje de endpoints sin ningún gate, redondeado a un decimal. */
  porcentajeSinAuth: number;
}

/**
 * El apartado "Estado de la autenticación": los números que justifican que el portal
 * sea solo-root. No se esconde nada, se cuenta.
 */
export function resumenAuth(endpoints: Endpoint[]): ResumenAuth {
  const sinAuth = endpoints.filter((e) => esSinAuth(e.op));
  const spoofeables = endpoints.filter((e) => esSpoofeable(e.op));
  const porApiKey = endpoints.filter((e) =>
    (e.op['x-auth']?.gates ?? []).some((g) => /requireApiKey|x-api-key/i.test(g)),
  );
  const conSesion = endpoints.filter((e) => (e.op['x-auth']?.gates ?? []).some((g) => /requireAuth/i.test(g)));

  return {
    total: endpoints.length,
    sinAuth,
    spoofeables,
    porApiKey,
    conSesion,
    anotados: endpoints.filter((e) => e.op['x-anotado'] === true).length,
    porcentajeSinAuth:
      endpoints.length === 0 ? 0 : Math.round((sinAuth.length / endpoints.length) * 1000) / 10,
  };
}

/** Minúsculas y sin acentos, para que "métricas" matchee "metricas". */
function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

export type FiltroEndpoints = 'todos' | 'sin-auth' | 'anotados' | 'sin-anotar';

/** Todo el texto por el que se puede encontrar un endpoint. */
function textoBuscable(e: Endpoint): string {
  const op = e.op;
  const consumidores = Array.isArray(op['x-consumidores'])
    ? op['x-consumidores'].join(' ')
    : String(op['x-consumidores'] ?? '');
  return normalizar(
    [
      e.metodo,
      e.ruta,
      e.modulo,
      op.summary ?? '',
      op.description ?? '',
      op.operationId ?? '',
      op['x-archivo'] ?? '',
      op['x-notas'] ?? '',
      op['x-auth-nota'] ?? '',
      consumidores,
      (op['x-auth']?.gates ?? []).join(' '),
      esSinAuth(op) ? 'sin auth singate sin gate' : '',
      (op.parameters ?? []).map((p) => p.name).join(' '),
    ].join('  '),
  );
}

/**
 * Busca por path, método, módulo y texto de la descripción.
 *
 * Cada palabra tiene que aparecer (AND), así "post import gps" llega a un solo
 * endpoint. Una palabra que sea un método HTTP matchea el método exacto.
 */
export function filtrarEndpoints(
  endpoints: Endpoint[],
  texto: string,
  filtro: FiltroEndpoints = 'todos',
): Endpoint[] {
  const base = endpoints.filter((e) => {
    if (filtro === 'sin-auth') return esSinAuth(e.op);
    if (filtro === 'anotados') return e.op['x-anotado'] === true;
    if (filtro === 'sin-anotar') return e.op['x-anotado'] !== true;
    return true;
  });

  const terminos = normalizar(texto).split(/\s+/).filter(Boolean);
  if (terminos.length === 0) return base;

  return base.filter((e) => {
    const heno = textoBuscable(e);
    return terminos.every((t) =>
      ORDEN_METODOS.includes(t) ? e.metodo === t : heno.includes(t),
    );
  });
}

/** Nombres de los parámetros de path de una ruta: `/api/movil/{id}` → ['id']. */
export function paramsDeRuta(ruta: string): string[] {
  return [...ruta.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
}

/**
 * Parámetros a mostrar y a pedir en el formulario: los de path (declarados o
 * derivados de la ruta) primero, después los de query.
 *
 * El generador no declara los de path —los deriva del árbol de carpetas— así que si
 * nadie los anotó, se completan acá para que el "Try it" los pueda pedir.
 */
export function parametrosDe(endpoint: Endpoint): Parametro[] {
  const declarados = endpoint.op.parameters ?? [];
  const dePath = paramsDeRuta(endpoint.ruta).map<Parametro>((nombre) => {
    const yaEsta = declarados.find((p) => p.name === nombre && p.in === 'path');
    return yaEsta ?? { name: nombre, in: 'path', required: true, schema: { type: 'string' } };
  });
  const resto = declarados.filter((p) => p.in !== 'path');
  return [...dePath, ...resto];
}

/** Consumidores anotados, siempre como lista. */
export function consumidoresDe(op: Operacion): string[] {
  const bruto = op['x-consumidores'];
  if (Array.isArray(bruto)) return bruto.map((c) => String(c)).filter((c) => c.trim() !== '');
  if (typeof bruto === 'string' && bruto.trim() !== '') return [bruto.trim()];
  return [];
}

/** true si alguno de los consumidores anotados es VB6 (habilita el ejemplo VB6). */
export function tieneConsumidorVb6(op: Operacion): boolean {
  return consumidoresDe(op).some((c) => /\bvb6\b|visual\s*basic/i.test(c));
}

export type ClaveAmbiente = 'DEV' | 'PROD';

export interface Ambiente {
  clave: ClaveAmbiente;
  etiqueta: string;
  detalle: string;
  /** true = todo lo que se ejecute impacta datos reales. */
  esProduccion: boolean;
}

/**
 * Ambiente derivado del host del navegador.
 *
 * Regla deliberadamente binaria: si el host dice "dev" es DEV, y **todo lo demás es
 * PROD**. Un `localhost` también se muestra como PROD, y está bien: el error caro es
 * ejecutar un DELETE creyendo que se está en desarrollo, no al revés.
 *
 * @param host `window.location.host` (o el que se quiera evaluar)
 */
export function ambienteDeHost(host: string): Ambiente {
  const esDev = /dev/i.test(host);
  return esDev
    ? {
        clave: 'DEV',
        etiqueta: 'DEV',
        detalle: `Ambiente de desarrollo (${host}). Lo que ejecutes acá no toca producción.`,
        esProduccion: false,
      }
    : {
        clave: 'PROD',
        etiqueta: 'PRODUCCIÓN',
        detalle: `El host (${host}) no dice "dev": se asume PRODUCCIÓN. Todo lo que ejecutes impacta datos reales.`,
        esProduccion: true,
      };
}

/** Color del status de una respuesta: 2xx ok, 4xx aviso, 5xx peligro. */
export function tonoDeStatus(status: number): TonoBadge {
  if (status >= 200 && status < 300) return 'ok';
  if (status >= 300 && status < 400) return 'neutro';
  if (status >= 400 && status < 500) return 'aviso';
  return 'peligro';
}

/** Formatea un cuerpo de respuesta: JSON indentado si parsea, crudo si no. */
export function formatearCuerpo(texto: string): string {
  const limpio = texto.trim();
  if (limpio === '') return '';
  if (!limpio.startsWith('{') && !limpio.startsWith('[')) return texto;
  try {
    return JSON.stringify(JSON.parse(limpio), null, 2);
  } catch {
    return texto;
  }
}
