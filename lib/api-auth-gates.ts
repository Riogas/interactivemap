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
