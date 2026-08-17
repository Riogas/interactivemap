/**
 * GET /api/docs/spec
 *
 * Devuelve el catálogo de APIs de TrackMovil: el OpenAPI 3.1 generado por
 * `pnpm docs:api` mergeado con las anotaciones a mano de docs/api/anotaciones.yaml.
 *
 * Gate: requireRoot (lib/docs/root-guard.ts) — verificado contra SecuritySuite en cada
 * request, fail-closed. NO usa x-track-isroot: este endpoint publica qué endpoints de
 * la app no validan nada, así que un gate por header forjable no alcanza.
 *
 * Respuestas:
 *   200 documento OpenAPI 3.1 (application/json)
 *   401 sin token / token inválido
 *   403 el usuario no tiene la funcionalidad 'docs' de la app 5
 *   503 SecuritySuite no contestó (fail-closed: no se abre el catálogo)
 */

import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import path from 'path';
import { requireRoot } from '@/lib/docs/root-guard';
import { mergearAnotaciones } from '@/lib/docs/merge-spec';
// Import estático: queda dentro del bundle. Leerlo del filesystem en runtime es
// justamente lo que dejó roto a /api/doc (busca un .md que no existe en el deploy).
import openapiGenerado from '@/docs/api/openapi.json';

export const dynamic = 'force-dynamic';

const RUTA_ANOTACIONES = path.join(process.cwd(), 'docs', 'api', 'anotaciones.yaml');

/** El YAML sí se lee del disco (no hay loader para YAML). Si falta, se sirve solo lo generado. */
async function leerAnotaciones(): Promise<string | null> {
  try {
    return await readFile(RUTA_ANOTACIONES, 'utf-8');
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const gate = await requireRoot(request);
  if (!gate.ok) {
    return NextResponse.json(
      { success: false, error: 'Acceso denegado', code: gate.code },
      { status: gate.status },
    );
  }

  const yaml = await leerAnotaciones();
  const { spec } = mergearAnotaciones(openapiGenerado as unknown as Record<string, unknown>, yaml);

  return NextResponse.json(spec, {
    headers: {
      // Catálogo solo-root: que no quede en ningún cache intermedio.
      'Cache-Control': 'no-store',
    },
  });
}
