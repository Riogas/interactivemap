import { NextRequest, NextResponse } from 'next/server';
import { API_BASE_URL } from '@/lib/api/config';
import { requireAuth } from '@/lib/auth-middleware';
import https from 'https';

export const dynamic = 'force-dynamic';

// Agente HTTPS que ignora errores de certificado SSL (certificados internos)
const httpsAgent = new https.Agent({
  rejectUnauthorized: false
});

/**
 * GET /api/movil-session/[id]?fecha=2026-02-10
 * 
 * Obtiene datos de sesión del chofer para un móvil específico
 * desde el endpoint externo /tracking/getSessionData
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  // 🔒 Autenticación requerida
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const params = await context.params;
    const movilId = parseInt(params.id);

    if (isNaN(movilId)) {
      return NextResponse.json(
        { error: 'Invalid movil ID' },
        { status: 400 }
      );
    }

    // Obtener fecha del query string (default: hoy)
    const { searchParams } = new URL(request.url);
    const fecha = searchParams.get('fecha') || new Date().toISOString().split('T')[0];

    console.log(`📡 API /movil-session/${movilId} - Fetching session data (fecha: ${fecha})`);

    const externalUrl = `${API_BASE_URL}/tracking/getSessionData`;

    const response = await fetch(externalUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        EscenarioId: 1000,
        Movil: movilId,
        Fecha: fecha,
      }),
      // @ts-expect-error - Node.js fetch accepts agent option
      agent: externalUrl.startsWith('https') ? httpsAgent : undefined,
    });

    if (!response.ok) {
      console.error(`❌ External API error: ${response.status} ${response.statusText}`);
      return NextResponse.json(
        { error: 'Error al obtener datos de sesión', status: response.status },
        { status: response.status }
      );
    }

    const data = await response.json();
    console.log(`✅ Session data received for movil ${movilId}:`, {
      chofer: data.Chofer,
      telefono: data.Telefono,
      historialCount: data.Historial?.length || 0,
    });

    return NextResponse.json({
      success: true,
      movilId,
      chofer: data.Chofer || null,
      telefono: data.Telefono || null,
      fechaInicio: data.FechaInicio || null,
      idTerminal: data.idTerminal || null,
      historial: (data.Historial || []).map((h: { ChoferHistorico: string; InicioHistorico: string }) => ({
        chofer: h.ChoferHistorico,
        inicio: h.InicioHistorico,
      })),
    });
  } catch (error) {
    const params = await context.params;
    console.error(`❌ API Error for movil-session ${params.id}:`, error);
    return NextResponse.json(
      { error: 'Error interno al obtener datos de sesión' },
      { status: 500 }
    );
  }
}
