import { NextRequest, NextResponse } from 'next/server';
import { es503Permanente } from './securitysuite-guard';

/**
 * requireFuncionalidad — gate genérico de autorización por funcionalidad.
 *
 * Modelo de confianza (mismo que el x-track-isroot previo):
 *   El front serializa los nombres de funcionalidades de todos los roles del
 *   usuario activo en el header x-track-funcs como lista separada por coma.
 *   El servidor confía en ese header igual que confiaba en x-track-isroot —
 *   no hay validación criptográfica server-side del header en sí mismo.
 *   Alguien malintencionado podría manipular el header en sus propias requests,
 *   pero tendría que hacerlo deliberadamente request por request.
 *   El acceso a los endpoints admin presupone red interna o sesión autenticada.
 *
 * Bypass de root:
 *   Si el header x-track-isroot === 'S', el usuario es superusuario y pasa
 *   cualquier gate. Esto mantiene la consistencia con los guards de página, que
 *   usan `isRoot(user) || hasFuncionalidad(...)`. Sin este bypass, un root sin la
 *   funcionalidad puntual entraba a la página (guard con bypass) pero recibía 403
 *   al llamar al endpoint (gate sin bypass) → "Acceso denegado".
 *   Para gates que deban respetarse incluso para root, pasar allowRoot=false.
 *
 * Uso:
 *   const gate = requireFuncionalidad(request, 'Nombre Canonico');
 *   if (gate !== true) return gate;
 */
export function requireFuncionalidad(
  request: NextRequest,
  nombre: string,
  allowRoot: boolean = true,
): true | NextResponse {
  if (allowRoot && (request.headers.get('x-track-isroot') ?? '').trim() === 'S') {
    return true;
  }
  const funcsHeader = request.headers.get('x-track-funcs') ?? '';
  const funcs = new Set(
    funcsHeader
      .split(',')
      .map((f) => f.trim())
      .filter((f) => f.length > 0),
  );
  if (!funcs.has(nombre)) {
    return NextResponse.json(
      {
        success: false,
        error: 'Acceso denegado',
        code: 'NO_FUNCIONALIDAD',
        funcionalidad: nombre,
      },
      { status: 403 },
    );
  }
  return true;
}

/**
 * requireAllowlistedEmail — gate por email VERIFICADO server-side.
 *
 * A diferencia de requireFuncionalidad / x-track-* (que confían en headers que
 * el cliente puede forjar), este chequea el email de la sesión autenticada
 * (el que devuelve `requireAuth`, validado contra Supabase Auth) contra una
 * allowlist configurada por env (CSV de emails). Sirve como defensa concreta
 * en endpoints con datos sensibles MIENTRAS el modelo de authz server-side
 * real (resolver scope/rol desde SecuritySuite en el server) no esté hecho:
 * aunque alguien forje `x-track-isroot`/`x-track-funcs`, si su email autenticado
 * no está en la lista no ve nada.
 *
 * Semántica:
 *  - env vacía/ausente  -> `true` (no rompe el flujo; loguea un warning para
 *    que quede claro que el endpoint depende solo del gate por headers).
 *  - env seteada        -> el email debe estar en la lista (case-insensitive);
 *    si no, 403 `NOT_ALLOWLISTED`.
 *
 * Uso:
 *   const gate = requireAllowlistedEmail(authResult.user?.email, process.env.MI_ALLOWLIST);
 *   if (gate !== true) return gate;
 */
export function requireAllowlistedEmail(
  email: string | null | undefined,
  allowlistEnv: string | undefined,
): true | NextResponse {
  const raw = (allowlistEnv ?? '').trim();
  if (raw === '') {
    console.warn(
      '[api-auth-gates] allowlist de email no configurada — el endpoint depende solo del gate por headers (spoofeable). Configurar la env antes de exponer datos sensibles.',
    );
    return true;
  }
  const allowed = new Set(
    raw
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e.length > 0),
  );
  const e = (email ?? '').trim().toLowerCase();
  if (e.length === 0 || !allowed.has(e)) {
    return NextResponse.json(
      { success: false, error: 'Acceso denegado', code: 'NOT_ALLOWLISTED' },
      { status: 403 },
    );
  }
  return true;
}

/**
 * requireAuthorizationHeader — exige una credencial usable en `Authorization`
 * ANTES de proxiar a los endpoints `/api/db/*` del SecuritySuite.
 *
 * Por qué vive acá y no repetido en cada route: las rutas que proxían al
 * SecuritySuite venían mandando
 *   `Authorization: request.headers.get('Authorization') ?? ''`.
 * Con la sesión caída eso forwardea un header vacío y delega el rechazo al
 * upstream, que responde un 401 opaco (body con prosa genérica + el código
 * SIN_TOKEN en el header `x-auth-guard`) que el cliente muestra como "Error del
 * servicio upstream" — o, en la pantalla de listado, como una tabla vacía sin
 * ninguna explicación. Cortar acá permite decir lo que realmente pasó: se cayó
 * la sesión, no el otro servicio.
 *
 * Esto deja de ser un caso raro cuando el SecuritySuite cierra `/api/db/*`
 * (todas las operaciones pasan a exigir JWT con firma verificada): al setear el
 * secreto de firma, TODOS los tokens vigentes se invalidan de una.
 *
 * También corta el caso `"Bearer "` / `"Bearer null"`: los helpers
 * `getAuthHeaders` del cliente arman el header como `'Bearer ' + (token ?? '')`,
 * así que sin token el header EXISTE pero no trae credencial.
 *
 * Uso:
 *   const auth = requireAuthorizationHeader(request);
 *   if (typeof auth !== 'string') return auth;
 *   // `auth` es el header ya validado, listo para forwardear al upstream.
 */
export function requireAuthorizationHeader(request: NextRequest): string | NextResponse {
  const raw = (request.headers.get('Authorization') ?? '').trim();
  // Sacar el esquema para mirar la credencial en sí. `\b` (y no `\s+`) para que
  // un `"Bearer"` pelado también quede como credencial vacía.
  const credencial = raw.replace(/^Bearer\b/i, '').trim();

  if (
    raw.length === 0 ||
    credencial.length === 0 ||
    credencial === 'null' ||
    credencial === 'undefined'
  ) {
    return NextResponse.json(
      {
        success: false,
        error: 'Tu sesión venció o no es válida. Volvé a iniciar sesión.',
        code: 'SIN_SESION',
      },
      { status: 401 },
    );
  }

  return raw;
}

/**
 * describirErrorUpstream — traduce un error del SecuritySuite a un mensaje que
 * el usuario pueda accionar.
 *
 * El SecuritySuite contesta con códigos internos (`TOKEN_INVALIDO`,
 * `TOKEN_VENCIDO`, `SIN_TOKEN`, `USUARIO_NO_ENCONTRADO`, `SIN_POLITICA`,
 * `SECRETO_NO_CONFIGURADO`, `ERROR_GUARD`) que, pasados tal cual al front, se
 * leen como "se rompió algo" en vez de "se te venció la sesión". Distinguir
 * importa porque la acción es distinta: re-loguearse, pedir permisos, avisar a
 * sistemas, o simplemente reintentar.
 *
 * DÓNDE VIENE EL CÓDIGO: en el header `x-auth-guard`, NO en el body. El guard
 * manda en `error` un mensaje en prosa para humanos, así que comparar el body
 * contra un código es código muerto (ver lib/securitysuite-guard.ts). Por eso el
 * segundo parámetro: los callers le pasan `res.headers.get('x-auth-guard')`. Es
 * opcional — sin él se cae al comportamiento por status, que es el conservador.
 *
 * `ocultarDetalle` marca los casos donde NO conviene reenviar el body del
 * upstream al cliente: las pantallas priorizan `detail.error` sobre `error`, así
 * que dejarlo pisaría el mensaje traducido con el del upstream.
 */
export function describirErrorUpstream(
  status: number,
  codigoGuard?: string | null,
): {
  error: string;
  code: string;
  ocultarDetalle: boolean;
} {
  const codigo = (codigoGuard ?? '').trim().toUpperCase();

  if (status === 401) {
    return {
      error: 'Tu sesión venció o no es válida. Volvé a iniciar sesión.',
      code: 'SESION_INVALIDA',
      ocultarDetalle: true,
    };
  }
  if (status === 403) {
    // No todo 403 es "a este usuario le falta un permiso": el guard también
    // devuelve 403 cuando la ruta no tiene política declarada o queda fuera del
    // alcance del servicio. Eso es un bug de configuración, y mandar a soporte a
    // revisar el RBAC del usuario cuando el problema está en la tabla de
    // políticas es hacerle perder el tiempo al que atiende el reclamo.
    if (codigo === 'SIN_POLITICA' || codigo === 'SERVICIO_FUERA_DE_ALCANCE') {
      return {
        error:
          'El SecuritySuite no tiene declarada una política para esta operación. Es un problema de configuración, no de tus permisos — avisá a sistemas.',
        code: 'CONFIG_UPSTREAM',
        ocultarDetalle: false,
      };
    }
    return {
      error: 'No tenés permisos para esta operación en el SecuritySuite.',
      code: 'SIN_PERMISO_UPSTREAM',
      ocultarDetalle: false,
    };
  }
  if (status === 503) {
    // Los dos 503 del SecuritySuite no son lo mismo: falta el secreto de firma
    // (permanente, reintentar no sirve) vs. el guard se cayó (transitorio).
    if (es503Permanente(codigo)) {
      return {
        error:
          'El servicio de seguridad no está configurado. Reintentar no lo arregla — avisá a sistemas.',
        code: 'UPSTREAM_NO_CONFIGURADO',
        ocultarDetalle: true,
      };
    }
    return {
      error:
        'El servicio de seguridad no está respondiendo. Probá de nuevo en unos minutos; si sigue, avisá a sistemas.',
      code: 'UPSTREAM_NO_DISPONIBLE',
      ocultarDetalle: true,
    };
  }
  return {
    error: 'Error del servicio upstream',
    code: 'UPSTREAM_ERROR',
    ocultarDetalle: false,
  };
}
