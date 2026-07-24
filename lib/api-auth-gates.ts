import { NextRequest, NextResponse } from 'next/server';

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
