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
 * Uso:
 *   const gate = requireFuncionalidad(request, 'Nombre Canonico');
 *   if (gate !== true) return gate;
 */
export function requireFuncionalidad(
  request: NextRequest,
  nombre: string,
): true | NextResponse {
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
