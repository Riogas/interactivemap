/**
 * Gate root del portal de documentación de APIs (`/docs`).
 *
 * Contexto (spec docs/superpowers/specs/2026-08-17-portal-docs-apis-design.md §5.2):
 * el portal lista TODOS los endpoints de la app, incluyendo cuáles no validan nada.
 * Es información sensible, así que el gate tiene que ser server-side y real.
 *
 * Por qué NO se usan `x-track-isroot` / `x-track-funcs` (lo que hace el resto de la
 * app vía `lib/api-auth-gates.ts`): esos headers los pone el front y cualquiera los
 * puede forjar. Para el catálogo de endpoints eso no alcanza. Acá se verifica la FIRMA
 * del JWT y después se le pregunta a SecuritySuite por HTTP.
 *
 * ── Por qué se verifica la firma acá y no alcanza con preguntarle a secapi ──────────
 * Ninguna app del ecosistema verifica hoy la firma del token: lo decodifican con base64
 * y le creen al payload. Con eso, `Bearer <header>.<base64 de {"username":"root"}>.<x>`
 * es un token válido para cualquiera que lo escriba a mano. Este guard cierra ese
 * agujero SOLO en el camino de /docs (el resto de la autenticación de la app queda
 * intacta a propósito: cambiarla es otra tarea, con otro alcance de pruebas).
 *
 * La verificación es LOCAL y va ANTES de la consulta a secapi: no tiene sentido gastar
 * una llamada de red por un token que ni siquiera está firmado.
 *
 * ── Fail-closed ante mala configuración ────────────────────────────────────────────
 * Si `JWT_SECRET` no está seteada, o vale el default que trae el código de secapi
 * (`security-suite-secret-key`), el guard devuelve 503 SECRETO_NO_CONFIGURADO y NO
 * abre. Verificar contra un secreto que está publicado en el repo de secapi es lo mismo
 * que no verificar nada, y un portal que publica qué endpoints están sin autenticación
 * no se abre "por las dudas". Ver docs/api/README.md § Acceso.
 *
 * Flujo:
 *   1. Bearer del header Authorization, o cookie `token`.
 *   2. `JWT_SECRET` real configurada, si no 503 SECRETO_NO_CONFIGURADO.
 *   3. `jwt.verify` (HS256, el algoritmo con el que firma secapi): firma y vencimiento.
 *      Vencido → 401 TOKEN_VENCIDO. Firma/formato inválido → 401 TOKEN_INVALIDO.
 *   4. POST {SECURITY_SUITE_URL}/api/db/permisos → { ObjetoKey: 'docs', AccionKey: 'view' }.
 *   5. Se acepta solo un 2xx con `permitido === 'GRANTED'`. La razón puede ser 'ROOT'
 *      (bypass por usuarios.es_root='S') o el otorgamiento vía rol Root; ambas valen.
 *   6. Cache en memoria por token: 5 min el positivo, 30 s el negativo.
 *   7. Cualquier error (red, timeout, JSON roto, 5xx) → DENIEGA. Fail-closed.
 */

import { createHash } from 'crypto';
import jwt from 'jsonwebtoken';
import type { Algorithm, JwtPayload } from 'jsonwebtoken';

/**
 * Misma env que ya usan app/api/auth/permisos y app/api/auth/login.
 * Sin fallback a propósito: un default apuntando a localhost le pregunta
 * "¿este usuario es root?" a lo que sea que esté escuchando en ese puerto, y
 * alcanza con que conteste GRANTED. Si falta, el guard devuelve 503.
 */
function urlSecapi(): string | null {
  const bruto = (process.env.SECURITY_SUITE_URL ?? '').trim();
  if (!bruto) return null;
  return bruto.replace(/\/$/, '');
}

/**
 * Default que trae el código de secapi (`src/lib/auth/responses.ts`, `src/app/api/db/menu/route.ts`).
 * Está en un repo: como secreto no vale nada. Si `JWT_SECRET` vale esto, se trata como
 * "no configurada".
 */
const SECRETO_DEFAULT_SECAPI = 'security-suite-secret-key';

/** secapi firma con el default de jsonwebtoken (HS256). Se fija para no aceptar otro alg. */
const ALGORITMOS: Algorithm[] = ['HS256'];

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

/** Datos del usuario que resolvió el guard. Salen del JWT verificado + secapi (autorización). */
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
 * Secreto con el que secapi firma los tokens. Se lee en cada request (no en el import)
 * para que un deploy que arregla la env no necesite reiniciar el módulo, y para que los
 * tests puedan moverla.
 *
 * @returns el secreto, o null si no hay uno usable (ausente, vacío o el default del repo).
 */
/** Largo mínimo exigido: verificar HS256 contra un secreto corto no prueba nada,
 *  se rompe offline a partir de cualquier token capturado. */
const LARGO_MINIMO_SECRETO = 32;

function leerSecreto(): string | null {
  const secreto = (process.env.JWT_SECRET ?? '').trim();
  if (secreto === '') return null;
  if (secreto === SECRETO_DEFAULT_SECAPI) return null;
  if (secreto.length < LARGO_MINIMO_SECRETO) return null;
  return secreto;
}

type VerificacionJwt =
  | { ok: true; payload: JwtPayload }
  | { ok: false; status: number; code: string };

/**
 * Verifica firma y vencimiento del JWT emitido por SecuritySuite. Local, sin red.
 *
 * Un token que no pasa por acá no llega nunca a `/api/db/permisos`.
 */
function verificarJwt(token: string, secreto: string): VerificacionJwt {
  try {
    const payload = jwt.verify(token, secreto, { algorithms: ALGORITMOS });
    // `verify` devuelve string cuando el token no lleva un payload JSON. No es un token
    // de secapi: se rechaza igual que una firma inválida.
    if (typeof payload === 'string') {
      return { ok: false, status: 401, code: 'TOKEN_INVALIDO' };
    }
    return { ok: true, payload };
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      return { ok: false, status: 401, code: 'TOKEN_VENCIDO' };
    }
    // JsonWebTokenError cubre firma inválida, alg no permitido, malformado y NotBefore.
    if (error instanceof jwt.JsonWebTokenError) {
      return { ok: false, status: 401, code: 'TOKEN_INVALIDO' };
    }
    console.error('[docs/root-guard] error inesperado verificando el JWT', error);
    return { ok: false, status: 401, code: 'TOKEN_INVALIDO' };
  }
}

/**
 * Verifica que el token esté firmado por SecuritySuite y que su usuario pueda ver `/docs`.
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

  // Mala configuración = no se abre. No se cachea: es estado del proceso, no del token.
  const secreto = leerSecreto();
  if (secreto === null) {
    console.error(
      '[docs/root-guard] JWT_SECRET ausente o igual al default del código: /docs no se abre. ' +
        'Seteá el MISMO secreto con el que firma SecuritySuite (ver docs/api/README.md).',
    );
    return { ok: false, status: 503, code: 'SECRETO_NO_CONFIGURADO' };
  }

  // Verificación LOCAL antes de la red: un token sin firma válida no gasta una llamada
  // a secapi. Y va antes del cache: así un token que vence dentro de la ventana de 5 min
  // deja de entrar en cuanto vence, sin esperar a que expire la entrada cacheada.
  const verificado = verificarJwt(token, secreto);
  if (!verificado.ok) {
    return { ok: false, status: verificado.status, code: verificado.code };
  }

  const clave = claveCache(token);
  const cacheado = cache.get(clave);
  if (cacheado && cacheado.expiraEn > Date.now()) {
    return cacheado.resultado;
  }

  const resultado = await consultarSecapi(token, verificado.payload);
  cache.set(clave, {
    expiraEn: Date.now() + (resultado.ok ? TTL_OK_MS : TTL_DENIED_MS),
    resultado,
  });
  return resultado;
}

async function consultarSecapi(token: string, payload: JwtPayload): Promise<RootGuardResult> {
  const baseSecapi = urlSecapi();
  if (!baseSecapi) {
    console.error(
      '[docs/root-guard] SECURITY_SUITE_URL no está configurada: /docs no se abre. ' +
        'Sin ella no hay contra quién verificar el permiso (ver docs/api/README.md).',
    );
    return { ok: false, status: 503, code: 'SECAPI_URL_NO_CONFIGURADA' };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${baseSecapi}/api/db/permisos`, {
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

    const data = (await res.json().catch(() => null)) as
      | { permitido?: string; razon?: string }
      | null;

    // PRIMERO el status HTTP, DESPUÉS el cuerpo. Al revés (mirar `permitido` antes que
    // `res.ok`) un 500 cuyo cuerpo trajera 'GRANTED' abriría el portal: el cuerpo de una
    // respuesta de error no es una autorización.
    if (!res.ok) {
      if (res.status >= 500) {
        // No es "no tenés permiso" sino "no sé": 503, y se reintenta en 30 s, no en 5 min.
        console.error('[docs/root-guard] secapi respondió 5xx', res.status, data?.razon);
        return { ok: false, status: 503, code: 'SECAPI_ERROR' };
      }
      // secapi contesta 401/403 con cuerpo {permitido:'DENIED', razon}.
      // NO_TOKEN / INVALID_TOKEN / NO_USERNAME_IN_TOKEN son 401 (sesión inválida);
      // el resto es 403 (sesión válida, sin permiso).
      const status = res.status === 401 ? 401 : 403;
      const razon = String(data?.razon ?? (status === 401 ? 'INVALID_TOKEN' : 'ACCESS_DENIED'));
      return { ok: false, status, code: razon };
    }

    if (!data || typeof data !== 'object') {
      console.error('[docs/root-guard] respuesta ilegible de secapi', res.status);
      return { ok: false, status: 503, code: 'SECAPI_RESPUESTA_INVALIDA' };
    }

    if (data.permitido === 'GRANTED') {
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

    const razon = String(data.razon ?? 'ACCESS_DENIED');
    return { ok: false, status: 403, code: razon };
  } catch (error) {
    // Timeout, DNS, conexión rechazada, secapi apagado. El portal NO se abre por esto.
    console.error('[docs/root-guard] no se pudo consultar secapi — se deniega (fail-closed)', error);
    return { ok: false, status: 503, code: 'SECAPI_INACCESIBLE' };
  } finally {
    clearTimeout(timeoutId);
  }
}
