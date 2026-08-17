/**
 * Validación del ejecutor de llamadas del portal `/docs` (POST /api/docs/try).
 *
 * Contexto (spec docs/superpowers/specs/2026-08-17-portal-docs-apis-design.md §5.3):
 * el portal permite disparar una llamada real contra el ambiente en el que está
 * parado el root. Eso es útil y es peligroso, así que las reglas de abajo NO son
 * negociables y viven acá — separadas del handler — para poder testearlas solas.
 *
 * ── Las cinco reglas ───────────────────────────────────────────────────────────
 *
 * 1. **Nunca es un proxy abierto.** Solo se ejecuta contra el propio host de la app.
 *    Se rechaza cualquier path que no empiece con `/api/`, cualquier URL absoluta
 *    (`http://…`), cualquier `//host` (protocol-relative) y cualquier traversal
 *    (`..`, `%2e`, `%2f`, `\`). Y después de armar la URL se vuelve a comprobar que
 *    el origen resultante sea el propio: la validación textual sola no alcanza.
 *    El origen lo resuelve `lib/docs/servidores.ts` desde `DOCS_TRY_ORIGEN` o el
 *    `PORT` del proceso — **nunca** desde un header del request.
 *
 * 2. **Las escrituras se confirman escribiendo el path.** POST/PUT/PATCH/DELETE
 *    exigen `confirmacion === <path exacto>`; si no coincide → 428
 *    CONFIRMACION_REQUERIDA. El ambiente puede ser producción y el que abre el
 *    portal es root: un POST accidental no se puede desandar.
 *
 * 3. **Los headers de credencial y de autorización los pone el servidor, no el
 *    cliente.** `cookie` y `authorization` viajan con la sesión del root que abrió el
 *    portal; si el payload los trae, se descartan (y se informa cuáles, no se
 *    descartan en silencio). Lo mismo con los hop-by-hop y los `x-forwarded-*`, que
 *    mentirían sobre el origen del request, y con **todo el prefijo `x-track-`**:
 *    `x-track-isroot`, `x-track-funcs` y `x-track-empresas-ids` son exactamente los
 *    headers en los que se apoya `lib/api-auth-gates.ts`, así que dejar que el
 *    payload los eligiera convertía al ejecutor en una escalada de privilegios
 *    (pasás el gate root del portal y después te fabricás el scope que quieras).
 *    Esos tres los propaga el handler desde el request entrante, siempre.
 *
 * 4. **Timeout de 30 s y respuesta truncada a 1 MB.** Un endpoint colgado no puede
 *    colgar el portal, y un dump de medio millón de filas no puede volar el browser.
 *
 * 5. **El payload viaja en base64.** No es ofuscación: el WAF de nginx delante de
 *    TrackMovil rechaza con 403 los bodies con sintaxis de shell (`curl`, `;`, `$(`…),
 *    y un ejemplo de request perfectamente legítimo puede contenerla. Codificado, el
 *    WAF ve una tira de base64 y el body llega entero.
 */

/** Métodos que el ejecutor acepta. TRACE/CONNECT/OPTIONS no tienen sentido acá. */
export const METODOS_TRY = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
export type MetodoTry = (typeof METODOS_TRY)[number];

/** Los que exigen confirmación escrita del path. */
const ESCRITURAS: ReadonlySet<string> = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Cuerpo de la respuesta a partir del cual se trunca. */
export const LIMITE_RESPUESTA_BYTES = 1024 * 1024;

/** Un endpoint colgado no cuelga el portal. */
export const TIMEOUT_TRY_MS = 30_000;

/**
 * El ejecutor no se llama a sí mismo: sería una recursión con la sesión del root
 * adentro, y no hay ningún caso de uso que lo necesite.
 *
 * Se comparan normalizados (ver `normalizarParaBloqueo`): con la igualdad exacta,
 * `/api/docs/try/` con barra final esquivaba el candado y Next servía igual el handler.
 */
const PATHS_BLOQUEADOS: readonly string[] = ['/api/docs/try'];

/**
 * Forma canónica del path para compararlo con la lista de bloqueados: minúsculas,
 * barras repetidas colapsadas y sin barra final. Es el mismo criterio que usa secapi.
 *
 * Solo se usa para comparar; lo que se reenvía es el path tal como vino.
 */
function normalizarParaBloqueo(path: string): string {
  const canonico = path.toLowerCase().replace(/\/{2,}/g, '/');
  return canonico.length > 1 ? canonico.replace(/\/+$/, '') : canonico;
}

/**
 * Headers de autorización propios de TrackMovil que el handler propaga SIEMPRE desde
 * el request entrante, y que el payload no puede elegir (ver `headerProhibido`).
 *
 * Son los que lee `lib/api-auth-gates.ts` (`requireFuncionalidad`): el scope efectivo
 * del que llama. Se propagan para que un GET al dashboard desde el portal devuelva lo
 * mismo que devolvería desde el navegador del root — ni más ni menos.
 */
export const HEADERS_PROPAGABLES: readonly string[] = [
  'x-track-isroot',
  'x-track-funcs',
  'x-track-empresas-ids',
];

/**
 * Headers que NO se reenvían aunque el payload los traiga.
 *
 * - credenciales (`cookie`, `authorization`, `proxy-authorization`): los pone el
 *   servidor con la sesión del root, no el cliente;
 * - hop-by-hop (`connection`, `te`, `upgrade`, …) y `content-length`/`host`: los
 *   maneja el runtime, mandarlos a mano rompe el request;
 * - `x-forwarded-*` / `x-real-ip`: mentirían sobre el origen del request en los logs
 *   y en cualquier gate que mire la IP;
 * - todo `x-track-*`: es la autorización de la app (ver `HEADERS_PROPAGABLES`).
 */
export const HEADERS_PROHIBIDOS: ReadonlySet<string> = new Set([
  'authorization',
  'connection',
  'content-length',
  'cookie',
  'cookie2',
  'expect',
  'host',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'set-cookie',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'via',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-port',
  'x-forwarded-proto',
  'x-real-ip',
  // Autoriza los endpoints de importación/integración (`requireApiKey`). No es
  // explotable sin conocer INTERNAL_API_KEY, pero vale la misma regla que para
  // los `x-track-*`: los headers con los que la app autoriza no los elige el
  // payload.
  'x-api-key',
]);

/**
 * true si el texto tiene caracteres de control, CR o LF incluidos.
 *
 * Se chequea por código de carácter y no con una clase de regex para que este
 * archivo no tenga bytes de control adentro.
 */
function tieneControl(texto: string): boolean {
  for (let i = 0; i < texto.length; i++) {
    const c = texto.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return true;
  }
  return false;
}

/** Nombre de header válido según RFC 7230 (token). */
const NOMBRE_HEADER = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

/**
 * true si el header no se puede reenviar: la lista de arriba, o los prefijos
 * `proxy-`, `sec-` y `x-track-`.
 *
 * El prefijo `x-track-` se bloquea entero y no solo los tres nombres conocidos: el día
 * que alguien sume un `x-track-loquesea` a un gate, el ejecutor ya no se lo deja elegir
 * al payload sin que nadie se acuerde de venir a tocar esta lista.
 */
export function headerProhibido(nombre: string): boolean {
  const n = nombre.trim().toLowerCase();
  return (
    HEADERS_PROHIBIDOS.has(n) ||
    n.startsWith('proxy-') ||
    n.startsWith('sec-') ||
    n.startsWith('x-track-')
  );
}

export interface HeadersSaneados {
  headers: Record<string, string>;
  /** Los que se tiraron, para poder avisarlo en la UI en vez de mentir por omisión. */
  descartados: string[];
}

/**
 * Deja pasar solo headers reenviables y con valores sanos.
 *
 * Se descarta —además de la lista prohibida— cualquier nombre que no sea un token
 * HTTP y cualquier valor con CR/LF adentro (inyección de headers).
 */
export function sanearHeaders(bruto: unknown): HeadersSaneados {
  const headers: Record<string, string> = {};
  const descartados: string[] = [];

  if (typeof bruto !== 'object' || bruto === null || Array.isArray(bruto)) {
    return { headers, descartados };
  }

  for (const [clave, valor] of Object.entries(bruto as Record<string, unknown>)) {
    const nombre = clave.trim();
    if (nombre === '') continue;

    if (!NOMBRE_HEADER.test(nombre) || headerProhibido(nombre)) {
      descartados.push(nombre);
      continue;
    }

    if (valor === null || valor === undefined) continue;
    if (typeof valor === 'object') {
      descartados.push(nombre);
      continue;
    }

    const texto = String(valor);
    // CR/LF en un valor de header = inyección de headers. No se sanea: se descarta.
    // Los espacios sí valen (`application/json; charset=utf-8` es un valor legítimo).
    if (tieneControl(texto)) {
      descartados.push(nombre);
      continue;
    }

    headers[nombre] = texto;
  }

  return { headers, descartados };
}

export type Fallo = { ok: false; status: number; code: string; error: string };

function fallo(status: number, code: string, error: string): Fallo {
  return { ok: false, status, code, error };
}

/**
 * base64 (o base64url) → objeto JSON.
 *
 * @param payload el string tal cual llegó en `{ payload }`
 */
export function decodificarPayload(payload: unknown): { ok: true; valor: unknown } | Fallo {
  if (typeof payload !== 'string' || payload.trim() === '') {
    return fallo(400, 'PAYLOAD_REQUERIDO', 'Falta `payload`: el request va en base64 (ver docs/api/README.md).');
  }

  const limpio = payload.trim().replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/\-_]*={0,2}$/.test(limpio)) {
    return fallo(400, 'PAYLOAD_INVALIDO', '`payload` no es base64.');
  }

  let texto: string;
  try {
    texto = Buffer.from(limpio.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8');
  } catch {
    return fallo(400, 'PAYLOAD_INVALIDO', '`payload` no se pudo decodificar de base64.');
  }

  try {
    return { ok: true, valor: JSON.parse(texto) };
  } catch {
    return fallo(400, 'PAYLOAD_INVALIDO', 'El contenido de `payload` no es JSON válido.');
  }
}

/**
 * Todo lo que hace que un path NO se pueda ejecutar: traversal (crudo o codificado),
 * separador de Windows, esquema absoluto y `#`. Los espacios y los caracteres de
 * control se chequean aparte, con `tieneControl`.
 */
const PATH_PELIGROSO = /(\.\.|%2e|%2f|%5c|%00|\\|:\/\/|#)/i;

export interface PathValidado {
  path: string;
  query: Record<string, string>;
}

/**
 * Valida y parte el path pedido.
 *
 * Acepta la query pegada al path (`/api/pedidos?escenario=1000`) y la devuelve
 * separada, para que el handler la vuelva a armar con `URLSearchParams` y no
 * concatene strings a mano.
 */
export function validarPath(bruto: unknown): ({ ok: true } & PathValidado) | Fallo {
  if (typeof bruto !== 'string' || bruto.trim() === '') {
    return fallo(400, 'PATH_REQUERIDO', 'Falta `path`.');
  }

  const entero = bruto.trim();

  // Absoluta o protocol-relative: el ejecutor no sale del propio host, nunca.
  if (/^[a-z][a-z0-9+.-]*:/i.test(entero) || entero.startsWith('//')) {
    return fallo(400, 'PATH_INVALIDO', 'Solo se ejecutan paths del propio host: `path` no puede ser una URL.');
  }

  const corte = entero.indexOf('?');
  const soloPath = corte === -1 ? entero : entero.slice(0, corte);
  const queryCruda = corte === -1 ? '' : entero.slice(corte + 1);

  if (PATH_PELIGROSO.test(soloPath) || tieneControl(soloPath) || soloPath.includes(' ')) {
    return fallo(400, 'PATH_INVALIDO', 'El path tiene caracteres no permitidos (traversal, escape o control).');
  }

  if (!soloPath.startsWith('/api/')) {
    return fallo(400, 'PATH_FUERA_DE_API', 'Solo se pueden ejecutar endpoints bajo /api/.');
  }

  if (PATHS_BLOQUEADOS.includes(normalizarParaBloqueo(soloPath))) {
    return fallo(400, 'PATH_BLOQUEADO', 'El ejecutor no se llama a sí mismo.');
  }

  const query: Record<string, string> = {};
  if (queryCruda !== '') {
    for (const [k, v] of new URLSearchParams(queryCruda)) query[k] = v;
  }

  return { ok: true, path: soloPath, query };
}

export interface PeticionTry {
  metodo: MetodoTry;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  headersDescartados: string[];
  /** Cuerpo a reenviar, ya sin el campo `confirmacion`. `undefined` = sin cuerpo. */
  body: unknown;
  esEscritura: boolean;
}

export type ValidacionTry = ({ ok: true } & { peticion: PeticionTry }) | Fallo;

/** Normaliza los valores de query a string (los números y booleanos son válidos). */
function normalizarQuery(bruto: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (typeof bruto !== 'object' || bruto === null || Array.isArray(bruto)) return out;
  for (const [clave, valor] of Object.entries(bruto as Record<string, unknown>)) {
    if (valor === null || valor === undefined || valor === '') continue;
    if (typeof valor === 'object') continue;
    out[clave.trim()] = String(valor);
  }
  return out;
}

/**
 * Valida el payload YA decodificado y devuelve la petición lista para ejecutar.
 *
 * Orden de las validaciones (importa): método → path → confirmación. Un path
 * inválido se rechaza aunque venga confirmado, y una escritura a un path válido se
 * frena antes de tocar nada si falta la confirmación.
 *
 * @param bruto objeto `{ metodo, path, query, headers, body, confirmacion }`
 */
export function validarPeticion(bruto: unknown): ValidacionTry {
  if (typeof bruto !== 'object' || bruto === null || Array.isArray(bruto)) {
    return fallo(400, 'PAYLOAD_INVALIDO', 'El payload decodificado tiene que ser un objeto.');
  }

  const carga = bruto as Record<string, unknown>;

  const metodo = String(carga.metodo ?? carga.method ?? 'GET').trim().toUpperCase();
  if (!(METODOS_TRY as readonly string[]).includes(metodo)) {
    return fallo(400, 'METODO_INVALIDO', `Método no soportado: ${metodo}.`);
  }

  const path = validarPath(carga.path);
  if (!path.ok) return path;

  const esEscritura = ESCRITURAS.has(metodo);

  // El cuerpo puede traer `confirmacion` adentro (es lo que escribe la UI en el
  // diálogo). Se lee de los dos lados y se saca antes de reenviar: la confirmación
  // es del portal, no del endpoint de destino.
  let body = carga.body;
  let confirmacion = carga.confirmacion;
  if (typeof body === 'object' && body !== null && !Array.isArray(body)) {
    const copia = { ...(body as Record<string, unknown>) };
    if ('confirmacion' in copia) {
      if (confirmacion === undefined) confirmacion = copia.confirmacion;
      delete copia.confirmacion;
      body = copia;
    }
  }

  if (esEscritura && String(confirmacion ?? '') !== path.path) {
    return fallo(
      428,
      'CONFIRMACION_REQUERIDA',
      `Para ejecutar ${metodo} hay que confirmar escribiendo el path exacto: ${path.path}`,
    );
  }

  const { headers, descartados } = sanearHeaders(carga.headers);

  return {
    ok: true,
    peticion: {
      metodo: metodo as MetodoTry,
      path: path.path,
      query: { ...path.query, ...normalizarQuery(carga.query) },
      headers,
      headersDescartados: descartados,
      body,
      esEscritura,
    },
  };
}

/**
 * Arma la URL final y comprueba —otra vez, ya resuelta— que caiga en el ORIGEN DE
 * CONFIANZA.
 *
 * `origenConfianza` viene de `origenDeConfianza()` (env `DOCS_TRY_ORIGEN` o el `PORT`
 * del proceso), nunca de un header del request. Ese es el punto: la versión anterior
 * comparaba el destino contra la base derivada del `Host`, o sea contra un valor que
 * elegía el mismo que mandaba el request, y por eso nunca rechazaba nada. Es el único
 * parámetro de origen que recibe esta función justamente para que no exista una "base"
 * alternativa que alguien pueda pasar sin darse cuenta.
 *
 * @param origenConfianza origen resuelto en el servidor (ej. `http://127.0.0.1:3002`)
 * @param peticion la petición ya validada
 */
export function construirUrl(
  origenConfianza: string,
  peticion: PeticionTry,
): { ok: true; url: string } | Fallo {
  let confianza: URL;
  try {
    confianza = new URL(origenConfianza);
  } catch {
    return fallo(503, 'ORIGEN_NO_CONFIGURADO', 'El servidor no pudo resolver su origen de confianza.');
  }
  if (confianza.protocol !== 'http:' && confianza.protocol !== 'https:') {
    return fallo(503, 'ORIGEN_NO_CONFIGURADO', 'El origen de confianza tiene que ser http(s).');
  }

  let destino: URL;
  try {
    // La base es el ORIGEN pelado, no la URL tal cual vino: si `origenConfianza`
    // trajera un path, un `path` relativo podría resolver contra él.
    destino = new URL(peticion.path, confianza.origin);
  } catch {
    return fallo(400, 'PATH_INVALIDO', 'El path no forma una URL válida.');
  }

  if (destino.origin !== confianza.origin) {
    return fallo(400, 'PATH_INVALIDO', 'El destino quedó fuera del origen de confianza de la app.');
  }
  if (!destino.pathname.startsWith('/api/')) {
    return fallo(400, 'PATH_FUERA_DE_API', 'Solo se pueden ejecutar endpoints bajo /api/.');
  }

  // Y la recursión, sobre el path que se va a pedir de verdad. `validarPeticion`
  // la bloquea sobre el TEXTO que mandó el cliente, pero `new URL` resuelve los
  // segmentos punto (RFC 3986): `/api/docs/./try` pasa el filtro textual y
  // aterriza igual en `/api/docs/try`.
  if (PATHS_BLOQUEADOS.includes(normalizarParaBloqueo(destino.pathname))) {
    return fallo(400, 'PATH_BLOQUEADO', 'El ejecutor no se llama a sí mismo.');
  }

  const qs = new URLSearchParams(peticion.query).toString();
  return { ok: true, url: qs === '' ? destino.toString() : `${destino.toString()}?${qs}` };
}
