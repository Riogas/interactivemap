import { NextRequest, NextResponse } from 'next/server';
import { debugFlags } from '@/lib/debug-config';
import { requireApiKey } from '@/lib/auth-middleware';

/**
 * GET /api/debug/toggle
 * Ver estado actual de los flags de debug.
 *
 * POST /api/debug/toggle
 * Prender/apagar logs en runtime sin reiniciar PM2.
 *
 * Body: { "flag": "gps" | "movZonas", "value": true | false }
 * O sin body para toggle automático de GPS.
 *
 * Ejemplos:
 *   curl -X POST https://track.rfriogas.com/api/debug/toggle -H "X-API-Key: ..." -H "Content-Type: application/json" -d '{"flag":"gps","value":true}'
 *   curl -X POST https://track.rfriogas.com/api/debug/toggle -H "X-API-Key: ..."   # toggle GPS
 *   curl    https://track.rfriogas.com/api/debug/toggle -H "X-API-Key: ..."         # ver estado
 */

export async function GET(request: NextRequest) {
  const keyValidation = requireApiKey(request);
  if (keyValidation instanceof NextResponse) return keyValidation;

  return NextResponse.json({
    flags: { ...debugFlags },
    help: {
      gps: 'Logs de coordenadas GPS (encolamiento, flush, batching)',
      movZonas: 'Logs de importación movZonaServicio',
    },
    usage: 'POST con { "flag": "gps", "value": true } para prender, false para apagar',
  });
}

export async function POST(request: NextRequest) {
  const keyValidation = requireApiKey(request);
  if (keyValidation instanceof NextResponse) return keyValidation;

  try {
    let flag = 'gps';
    let value: boolean | undefined;

    // Intentar parsear body (puede venir vacío para toggle simple)
    try {
      const body = await request.json();
      if (body.flag) flag = body.flag;
      if (body.value !== undefined) value = Boolean(body.value);
    } catch {
      // Body vacío → toggle GPS por defecto
    }

    if (!(flag in debugFlags)) {
      return NextResponse.json(
        { error: `Flag "${flag}" no existe. Disponibles: ${Object.keys(debugFlags).join(', ')}` },
        { status: 400 }
      );
    }

    const key = flag as keyof typeof debugFlags;
    const oldValue = debugFlags[key];
    debugFlags[key] = value !== undefined ? value : !debugFlags[key];

    const emoji = debugFlags[key] ? '🟢 ON' : '🔴 OFF';
    console.log(`\n🔧 DEBUG TOGGLE: ${flag} → ${emoji} (era: ${oldValue ? 'ON' : 'OFF'})\n`);

    return NextResponse.json({
      success: true,
      flag,
      oldValue,
      newValue: debugFlags[key],
      message: `${flag} logs: ${emoji}`,
      allFlags: { ...debugFlags },
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: 'Error interno', details: error.message },
      { status: 500 }
    );
  }
}
