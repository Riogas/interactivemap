/**
 * POST /api/docs/try
 *
 * Ejecuta, desde el servidor y con la sesión del root que abrió el portal, una
 * llamada a una API de esta misma app, y devuelve status, headers y cuerpo.
 *
 * Gate: requireRoot (lib/docs/root-guard.ts) — el mismo que GET /api/docs/spec:
 * firma del JWT verificada + consulta a SecuritySuite, fail-closed.
 *
 * Cuerpo del request:
 *   { payload: "<base64 de {metodo, path, query, headers, body, confirmacion}>" }
 *
 * El base64 NO es ofuscación: el WAF de nginx delante de TrackMovil rechaza con 403
 * los bodies con sintaxis de shell, y un ejemplo de request legítimo puede tenerla.
 * Codificado, el WAF ve una tira de base64 y el cuerpo llega entero.
 *
 * Reglas (lib/docs/try-request.ts, con sus tests):
 *   - solo paths `/api/...` del ORIGEN DE CONFIANZA, que se resuelve en el servidor
 *     (`DOCS_TRY_ORIGEN` o el `PORT` del proceso) y **nunca** desde un header del
 *     request: el `Host` lo elige el cliente, y creerle era SSRF con el Bearer y el
 *     cookie jar del root adentro. Nunca es un proxy abierto;
 *   - GET/HEAD van directo; POST/PUT/PATCH/DELETE exigen `confirmacion` == path exacto;
 *   - `cookie` / `authorization` y los `x-track-*` (la autorización de la app) los pone
 *     este handler desde el request entrante: los que mande el payload se descartan (y
 *     se listan en `headersDescartados`);
 *   - timeout 30 s, respuesta truncada a 1 MB.
 *
 * Respuestas:
 *   200 { status, statusText, headers, body, duracionMs, truncado, ... } — el 200 es
 *       del ejecutor: el status del endpoint llamado va adentro, en `status`.
 *   400 payload/método/path inválidos (PAYLOAD_INVALIDO, METODO_INVALIDO,
 *       PATH_INVALIDO, PATH_FUERA_DE_API, PATH_BLOQUEADO)
 *   401/403 el gate root (sin token, token inválido, sin permiso)
 *   428 CONFIRMACION_REQUERIDA — escritura sin el path escrito
 *   503 SecuritySuite no contestó (SECAPI_*), o no hay origen de confianza
 *       (ORIGEN_NO_CONFIGURADO)
 *   504 TIMEOUT — el endpoint llamado no respondió en 30 s
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireRoot } from '@/lib/docs/root-guard';
import { ENV_ORIGEN, origenDeConfianza } from '@/lib/docs/servidores';
import {
  construirUrl,
  decodificarPayload,
  validarPeticion,
  HEADERS_PROPAGABLES,
  LIMITE_RESPUESTA_BYTES,
  TIMEOUT_TRY_MS,
  type PeticionTry,
} from '@/lib/docs/try-request';

export const dynamic = 'force-dynamic';

/** Headers de la respuesta que no se devuelven al portal. */
const HEADERS_RESPUESTA_OCULTOS = new Set(['set-cookie', 'set-cookie2']);

interface CuerpoLeido {
  body: string;
  truncado: boolean;
}

function recortar(texto: string): CuerpoLeido {
  const bytes = Buffer.from(texto, 'utf-8');
  if (bytes.byteLength <= LIMITE_RESPUESTA_BYTES) return { body: texto, truncado: false };
  return { body: bytes.subarray(0, LIMITE_RESPUESTA_BYTES).toString('utf-8'), truncado: true };
}

/**
 * Lee el cuerpo de la respuesta cortando en 1 MB.
 *
 * Va por el stream (no `res.text()`) para no traerse a memoria un dump entero antes
 * de recortarlo: en cuanto pasa el límite, cancela la lectura.
 */
async function leerCuerpoLimitado(res: Response): Promise<CuerpoLeido> {
  const stream = res.body;
  if (!stream || typeof stream.getReader !== 'function') {
    return recortar(await res.text());
  }

  const reader = stream.getReader();
  const trozos: Buffer[] = [];
  let total = 0;
  let truncado = false;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;

    const trozo = Buffer.from(value);
    if (total + trozo.byteLength > LIMITE_RESPUESTA_BYTES) {
      trozos.push(trozo.subarray(0, LIMITE_RESPUESTA_BYTES - total));
      truncado = true;
      await reader.cancel().catch(() => {});
      break;
    }
    trozos.push(trozo);
    total += trozo.byteLength;
  }

  return { body: Buffer.concat(trozos).toString('utf-8'), truncado };
}

/**
 * Headers con los que sale la llamada.
 *
 * El ORDEN es la regla de seguridad: primero lo que pidió el root (ya saneado), y
 * ENCIMA —con `set()` incondicional— lo que decide el servidor. Al revés (que era como
 * estaba: los propagables solo si el payload no los traía) el payload ganaba, y como
 * `x-track-isroot` / `x-track-funcs` / `x-track-empresas-ids` son la autorización real
 * de la app (`lib/api-auth-gates.ts`), el ejecutor era una escalada de privilegios.
 *
 * Los `x-track-*` salen del REQUEST ENTRANTE, así que el portal ejecuta con el mismo
 * scope que tiene el root en su navegador: ni más, ni menos. Si el request no los trae,
 * se borran (no se hereda nada del payload).
 */
function headersDeSalida(request: NextRequest, peticion: PeticionTry): Headers {
  const headers = new Headers();
  for (const [k, v] of Object.entries(peticion.headers)) headers.set(k, v);

  const autorizacion = request.headers.get('authorization');
  if (autorizacion) headers.set('authorization', autorizacion);
  else headers.delete('authorization');

  const cookie = request.headers.get('cookie');
  if (cookie) headers.set('cookie', cookie);
  else headers.delete('cookie');

  // Los gates de scope de la app leen estos headers; si el portal los perdiera, un
  // GET al dashboard volvería vacío y parecería un bug del endpoint.
  for (const propagable of HEADERS_PROPAGABLES) {
    const valor = request.headers.get(propagable);
    if (valor) headers.set(propagable, valor);
    else headers.delete(propagable);
  }

  headers.set('accept', headers.get('accept') ?? 'application/json, text/plain;q=0.9, */*;q=0.8');
  headers.set('user-agent', 'TrackMovil-DocsPortal/1.0');
  return headers;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const gate = await requireRoot(request);
  if (!gate.ok) {
    return NextResponse.json(
      { success: false, error: 'Acceso denegado', code: gate.code },
      { status: gate.status },
    );
  }

  const sobre = (await request.json().catch(() => null)) as { payload?: unknown } | null;
  const decodificado = decodificarPayload(sobre?.payload);
  if (!decodificado.ok) {
    return NextResponse.json(
      { success: false, error: decodificado.error, code: decodificado.code },
      { status: decodificado.status },
    );
  }

  const validacion = validarPeticion(decodificado.valor);
  if (!validacion.ok) {
    return NextResponse.json(
      { success: false, error: validacion.error, code: validacion.code },
      { status: validacion.status },
    );
  }
  const peticion = validacion.peticion;

  // El destino NO sale de ningún header del request (Host, x-forwarded-host, Origin,
  // Referer: los elige el cliente). Ver lib/docs/servidores.ts.
  const origen = origenDeConfianza();
  if (origen === null) {
    return NextResponse.json(
      {
        success: false,
        error: `El servidor no pudo resolver un origen de confianza. Revisá ${ENV_ORIGEN} (o PORT) — ver docs/api/README.md.`,
        code: 'ORIGEN_NO_CONFIGURADO',
      },
      { status: 503 },
    );
  }

  const destino = construirUrl(origen, peticion);
  if (!destino.ok) {
    return NextResponse.json(
      { success: false, error: destino.error, code: destino.code },
      { status: destino.status },
    );
  }

  const headers = headersDeSalida(request, peticion);

  let cuerpo: string | undefined;
  if (peticion.body !== undefined && peticion.body !== null && peticion.metodo !== 'GET' && peticion.metodo !== 'HEAD') {
    cuerpo = typeof peticion.body === 'string' ? peticion.body : JSON.stringify(peticion.body);
    if (!headers.has('content-type')) headers.set('content-type', 'application/json');
  }

  // Queda registro de quién ejecutó qué: es root, contra el ambiente real.
  console.info(
    `[docs/try] ${gate.usuario.username || 'root'} → ${peticion.metodo} ${peticion.path}` +
      (peticion.esEscritura ? ' (escritura confirmada)' : ''),
  );

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_TRY_MS);
  const arranque = Date.now();

  try {
    const res = await fetch(destino.url, {
      method: peticion.metodo,
      headers,
      body: cuerpo,
      redirect: 'manual',
      cache: 'no-store',
      signal: controller.signal,
    });

    const { body, truncado } = await leerCuerpoLimitado(res);

    const headersRespuesta: Record<string, string> = {};
    res.headers.forEach((valor, clave) => {
      if (!HEADERS_RESPUESTA_OCULTOS.has(clave.toLowerCase())) headersRespuesta[clave] = valor;
    });

    return NextResponse.json(
      {
        success: true,
        status: res.status,
        statusText: res.statusText,
        headers: headersRespuesta,
        body,
        duracionMs: Date.now() - arranque,
        truncado,
        // Lo que se ejecutó de verdad, no lo que se pidió: si el portal descartó un
        // header, el que mira la respuesta tiene que poder verlo.
        ejecutado: { metodo: peticion.metodo, url: destino.url },
        headersDescartados: peticion.headersDescartados,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    const abortado = error instanceof Error && error.name === 'AbortError';
    if (abortado) {
      return NextResponse.json(
        {
          success: false,
          error: `El endpoint no respondió en ${TIMEOUT_TRY_MS / 1000} segundos.`,
          code: 'TIMEOUT',
          duracionMs: Date.now() - arranque,
        },
        { status: 504 },
      );
    }
    console.error('[docs/try] la llamada falló', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'La llamada falló',
        code: 'FALLO_DE_RED',
        duracionMs: Date.now() - arranque,
      },
      { status: 502 },
    );
  } finally {
    clearTimeout(timeoutId);
  }
}
