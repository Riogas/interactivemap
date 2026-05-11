import { NextResponse } from 'next/server';

/**
 * GET /api/server-time
 *
 * Retorna la hora actual del servidor en ISO 8601.
 * Sin autenticacion. Sin cache.
 * Usado por useServerTime() para calcular el offset cliente-servidor.
 */
export async function GET() {
  return NextResponse.json(
    { now: new Date().toISOString() },
    {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        Pragma: 'no-cache',
      },
    }
  );
}
