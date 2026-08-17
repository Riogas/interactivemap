/**
 * Gate root del portal de documentación de APIs (`/docs`).
 *
 * Contexto (spec docs/superpowers/specs/2026-08-17-portal-docs-apis-design.md §5.2):
 * el portal lista TODOS los endpoints de la app, incluyendo cuáles no validan nada.
 * Es información sensible, así que el gate tiene que ser server-side y real.
 *
 * Por qué NO se usan `x-track-isroot` / `x-track-funcs` (lo que hace el resto de la
 * app vía `lib/api-auth-gates.ts`): esos headers los pone el front y cualquiera los
 * puede forjar. Para el catálogo de endpoints eso no alcanza. Acá se le pregunta a
 * SecuritySuite por HTTP, igual que hace Goya, y se acepta únicamente su respuesta.
 *
 * El JWT de secapi NO lleva flag de root (su payload es {iss, username, userId,
 * sistema}), así que no hay forma de decidirlo leyendo el token: hay que preguntar.
 *
 * Flujo:
 *   1. Bearer del header Authorization, o cookie `token`.
 *   2. POST {SECURITY_SUITE_URL}/api/db/permisos → { ObjetoKey: 'docs', AccionKey: 'view' }.
 *   3. Se acepta solo `permitido === 'GRANTED'`. La razón puede ser 'ROOT' (bypass por
 *      usuarios.es_root='S') o el otorgamiento vía rol Root; ambas valen.
 *   4. Cache en memoria por token: 5 min el positivo, 30 s el negativo.
 *   5. Cualquier error (red, timeout, JSON roto, 5xx) → DENIEGA. Fail-closed.
 */

import { createHash } from 'crypto';

/** Misma env que ya usan app/api/auth/permisos y app/api/auth/login. */
const SECURITY_SUITE_URL = process.env.SECURITY_SUITE_URL || 'http://localhost:3001';

/** App 5 en la tabla `aplicaciones` de secapi. Se manda id + nombre: secapi resuelve por cualquiera. */
const APLICACION_ID = 5;
const APLICACION_NOMBRE = 'RiogasTracking';

/** Objeto PAGE + acción dados de alta por scripts/seed-docs-funcionalidad.ts (secapi). */
const OBJETO_KEY = 'docs';
const ACCION_KEY = 'view';

/** El guard corre en el camino crítico de cada request: falla rápido, no reintenta. */
const TIMEOUT_MS = 5000;

const TTL_OK_MS = 5 * 60 * 1000;
const TTL_DENIED_MS = 30 * 1000;

/** Datos del usuario que resolvió el guard. Salen del JWT (identidad) + secapi (autorización). */
export interface DocsUsuario {
  username: string;
  userId: number | null;
  /** Razón que devolvió secapi: 'ROOT', 'ROL', etc. Útil para auditar quién entró y por qué. */
  razon: string;
}

export type RootGuardResult =
  | { ok: true; usuario: DocsUsuario }
  | { ok: false; status: number; code: string };

interface EntradaCache {
  expiraEn: number;
  resultado: RootGuardResult;
}

const cache = new Map<string, EntradaCache>();

/**
 * Vacía el cache. Solo para tests — en runtime el TTL alcanza.
 */
export function resetDocsGuardCache(): void {
  cache.clear();
}

/** El token no se guarda en claro como clave del cache. */
function claveCache(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Bearer del header Authorization; si no hay, cookie `token` (mismo orden que secapi). */
function extraerToken(request: { headers: Headers }): string | null {
  const auth = request.headers.get('authorization') ?? '';
  if (auth.toLowerCase().startsWith('bearer ')) {
    const t = auth.slice(7).trim();
    if (t.length > 0) return t;
  }

  const cookieHeader = request.headers.get('cookie') ?? '';
  for (const parte of cookieHeader.split(';')) {
    const idx = parte.indexOf('=');
    if (idx <= 0) continue;
    if (parte.slice(0, idx).trim() !== 'token') continue;
    const valor = decodeURIComponent(parte.slice(idx + 1).trim());
    if (valor.length > 0) return valor;
  }

  return null;
}

/**
 * Lee el payload del JWT SIN verificar la firma. Se usa solo para saber a nombre de
 * quién mostrar la página; la autorización la decide secapi, que sí valida el usuario
 * contra su base. Un token forjado no pasa el paso 2 aunque acá se lea lindo.
 */
function leerPayloadJwt(token: string): Record<string, unknown> | null {
  try {
    const partes = token.split('.');
    if (partes.length < 2) return null;
    const b64 = partes[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(Buffer.from(b64, 'base64').toString('utf-8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Verifica contra SecuritySuite que el usuario del token puede ver `/docs`.
 *
 * @example
 * ```ts
 * const gate = await requireRoot(request);
 * if (!gate.ok) {
 *   return NextResponse.json({ success: false, error: 'Acceso denegado', code: gate.code }, { status: gate.status });
 * }
 * // gate.usuario.username
 * ```
 */
export async function requireRoot(request: { headers: Headers }): Promise<RootGuardResult> {
  const token = extraerToken(request);
  if (!token) {
    return { ok: false, status: 401, code: 'NO_TOKEN' };
  }

  const clave = claveCache(token);
  const cacheado = cache.get(clave);
  if (cacheado && cacheado.expiraEn > Date.now()) {
    return cacheado.resultado;
  }

  const resultado = await consultarSecapi(token);
  cache.set(clave, {
    expiraEn: Date.now() + (resultado.ok ? TTL_OK_MS : TTL_DENIED_MS),
    resultado,
  });
  return resultado;
}

async function consultarSecapi(token: string): Promise<RootGuardResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${SECURITY_SUITE_URL}/api/db/permisos`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        AplicacionId: APLICACION_ID,
        aplicacion: APLICACION_NOMBRE,
        ObjetoKey: OBJETO_KEY,
        AccionKey: ACCION_KEY,
      }),
      signal: controller.signal,
      cache: 'no-store',
    });

    // secapi contesta 401/403 con cuerpo {permitido:'DENIED', razon}. Se respeta su status
    // salvo el 500, que no es "no tenés permiso" sino "no sé": eso es 503 y se reintenta
    // en 30 s, no 5 min.
    const data = (await res.json().catch(() => null)) as
      | { permitido?: string; razon?: string }
      | null;

    if (!data || typeof data !== 'object') {
      console.error('[docs/root-guard] respuesta ilegible de secapi', res.status);
      return { ok: false, status: 503, code: 'SECAPI_RESPUESTA_INVALIDA' };
    }

    if (data.permitido === 'GRANTED') {
      const payload = leerPayloadJwt(token) ?? {};
      const userIdRaw = Number(payload.userId ?? payload.sub ?? NaN);
      return {
        ok: true,
        usuario: {
          username: String(payload.username ?? payload.email ?? '').trim(),
          userId: Number.isFinite(userIdRaw) ? userIdRaw : null,
          razon: String(data.razon ?? 'GRANTED'),
        },
      };
    }

    if (res.status >= 500) {
      console.error('[docs/root-guard] secapi respondió 5xx', res.status, data.razon);
      return { ok: false, status: 503, code: 'SECAPI_ERROR' };
    }

    const razon = String(data.razon ?? 'ACCESS_DENIED');
    // NO_TOKEN / INVALID_TOKEN / NO_USERNAME_IN_TOKEN son 401 (sesión inválida);
    // el resto es 403 (sesión válida, sin permiso).
    const status = res.status === 401 ? 401 : 403;
    return { ok: false, status, code: razon };
  } catch (error) {
    // Timeout, DNS, conexión rechazada, secapi apagado. El portal NO se abre por esto.
    console.error('[docs/root-guard] no se pudo consultar secapi — se deniega (fail-closed)', error);
    return { ok: false, status: 503, code: 'SECAPI_INACCESIBLE' };
  } finally {
    clearTimeout(timeoutId);
  }
}
