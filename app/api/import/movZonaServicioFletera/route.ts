import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase';
import { requireApiKey } from '@/lib/auth-middleware';

// ─── Helpers ────────────────────────────────────────────────────────

/**
 * Transforma los items de MovZonas a un array JSON para la columna `zonas`.
 *
 * Entrada (Genexus):
 *   [
 *     { Zona: "3",  PrioridadOTransito: 1, Moviles: [304, 305] },
 *     { Zona: "10", PrioridadOTransito: 0, Movil: 330 }
 *   ]
 *
 * Salida (JSON para columna zonas):
 *   [
 *     { zona_id: 3,  prioridad_o_transito: 1, moviles: [304, 305] },
 *     { zona_id: 10, prioridad_o_transito: 0, moviles: [330] }
 *   ]
 */
function buildZonasJson(rawItems: any[]): any[] {
  return rawItems.map((item: any) => {
    const zona_id = parseInt(String(item.Zona ?? item.zona_id ?? '0'), 10);
    const prioridad_o_transito = parseInt(
      String(item.PrioridadOTransito ?? item.prioridad_o_transito ?? '0'),
      10
    );

    // Determinar los móviles
    let moviles: number[] = [];
    if (Array.isArray(item.Moviles) && item.Moviles.length > 0) {
      moviles = item.Moviles.map((m: any) => Number(m));
    } else if (item.Movil !== undefined) {
      moviles = [Number(item.Movil)];
    } else if (item.movil_id !== undefined) {
      moviles = [Number(item.movil_id)];
    }

    return {
      zona_id,
      prioridad_o_transito,
      moviles,
    };
  });
}

// ─── POST & PUT ─────────────────────────────────────────────────────

/**
 * POST /api/import/movZonaServicioFletera
 * PUT  /api/import/movZonaServicioFletera
 *
 * Importar zonas de empresa fletera a la tabla `fleteras_zonas`.
 *
 * Body esperado (formato Genexus):
 * {
 *   "EscenarioId": 1000,
 *   "TipoDeZona": "Distribucion",
 *   "Efletera": "5",
 *   "TipoServicio-TipoZona-Zona": [
 *     {
 *       "TipoDeServicio": "URGENTE",
 *       "MovZonas": [
 *         { "Zona": "3",  "PrioridadOTransito": 1, "Moviles": [304, 305] },
 *         { "Zona": "10", "PrioridadOTransito": 0, "Movil": 330 }
 *       ]
 *     },
 *     {
 *       "TipoDeServicio": "GAS",
 *       "MovZonas": [
 *         { "Zona": "1", "PrioridadOTransito": 1, "Moviles": [100, 101] }
 *       ]
 *     }
 *   ]
 * }
 *
 * Tabla destino: fleteras_zonas
 *   PK: (escenario_id, tipo_de_zona, empresa_fletera_id, tipo_de_servicio)
 *   zonas: JSONB — [{ zona_id, prioridad_o_transito, moviles: [...] }, ...]
 *
 * Comportamiento: UPSERT por PK — si ya existe la combinación, reemplaza las zonas.
 */
async function handleImport(request: NextRequest) {
  const keyValidation = requireApiKey(request);
  if (keyValidation instanceof NextResponse) return keyValidation;

  const method = request.method;

  try {
    const body = await request.json();

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`📥 ${method} /api/import/movZonaServicioFletera`);
    console.log('📅 Timestamp:', new Date().toISOString());
    console.log('📦 Body crudo (keys):', Object.keys(body));
    console.log('📦 Body completo:', JSON.stringify(body, null, 2).substring(0, 5000));

    // ── Campos raíz obligatorios ──────────────────────────────────
    const escenario_id = parseInt(String(body.EscenarioId ?? body.escenario_id ?? '0'), 10);
    if (!escenario_id) {
      return NextResponse.json(
        { error: 'Se requiere EscenarioId a nivel raíz' },
        { status: 400 }
      );
    }

    const tipo_de_zona = (body.TipoDeZona ?? body.tipo_de_zona ?? '').trim();

    const efleteraRaw = body.Efletera ?? body.efletera ?? body.empresa_fletera_id ?? null;
    const empresa_fletera_id = efleteraRaw !== null ? parseInt(String(efleteraRaw), 10) : null;

    if (empresa_fletera_id === null || isNaN(empresa_fletera_id)) {
      return NextResponse.json(
        { error: 'Se requiere Efletera (empresa_fletera_id) a nivel raíz' },
        { status: 400 }
      );
    }

    console.log(`🏷️ EscenarioId: ${escenario_id}`);
    console.log(`🏷️ TipoDeZona: "${tipo_de_zona}"`);
    console.log(`🏢 Efletera: ${empresa_fletera_id}`);

    // ── Array de servicios ────────────────────────────────────────
    const servicios =
      body['TipoServicio-TipoZona-Zona'] ||
      body['tiposervicio_tipozona_zona'] ||
      [];

    if (!Array.isArray(servicios) || servicios.length === 0) {
      return NextResponse.json(
        { error: 'Se requiere al menos un elemento en "TipoServicio-TipoZona-Zona"' },
        { status: 400 }
      );
    }

    console.log(`📋 Grupos de TipoDeServicio recibidos: ${servicios.length}`);

    const supabase = getServerSupabaseClient();
    const tiposServicioProcesados: string[] = [];
    const upsertedRows: any[] = [];

    // ── Procesar cada grupo de TipoDeServicio ─────────────────────
    for (const grupo of servicios) {
      const tipo_de_servicio = (
        grupo.TipoDeServicio ?? grupo.tipo_de_servicio ?? ''
      )
        .trim()
        .toUpperCase();

      if (!tipo_de_servicio) {
        console.warn('⚠️ Grupo sin TipoDeServicio, saltado:', JSON.stringify(grupo));
        continue;
      }

      let rawItems = grupo.MovZonas || [];
      if (!Array.isArray(rawItems)) rawItems = [rawItems];

      console.log(
        `\n🔸 TipoDeServicio: "${tipo_de_servicio}" — ${rawItems.length} MovZona(s) crudo(s)`
      );

      // Construir JSON de zonas
      const zonas = buildZonasJson(rawItems);

      console.log(`   🔄 Zonas JSON generado: ${zonas.length} zona(s)`);
      if (zonas.length > 0) {
        console.log('   Ejemplo:', JSON.stringify(zonas[0]));
      }

      // UPSERT en fleteras_zonas (PK: escenario_id, tipo_de_zona, empresa_fletera_id, tipo_de_servicio)
      const row = {
        escenario_id,
        tipo_de_zona,
        empresa_fletera_id,
        tipo_de_servicio,
        zonas,
        updated_at: new Date().toISOString(),
      };

      const { data, error } = await (supabase as any)
        .from('fleteras_zonas')
        .upsert(row, {
          onConflict: 'escenario_id,tipo_de_zona,empresa_fletera_id,tipo_de_servicio',
        })
        .select();

      if (error) {
        console.error(`   ❌ Error al upsert fleteras_zonas:`, error);
        return NextResponse.json(
          {
            error: 'Error al guardar zonas de fletera',
            details: error.message,
            tipo_de_servicio,
          },
          { status: 500 }
        );
      }

      upsertedRows.push(...(data || []));
      tiposServicioProcesados.push(tipo_de_servicio);
      console.log(`   ✅ Upsert OK para "${tipo_de_servicio}" (${zonas.length} zonas)`);
    }

    console.log(`\n✅ Total: ${upsertedRows.length} fila(s) upserted en fleteras_zonas`);
    console.log(`🏷️ Tipos de servicio: [${tiposServicioProcesados.join(', ')}]`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    return NextResponse.json({
      success: true,
      message: `${upsertedRows.length} registro(s) guardados en fleteras_zonas`,
      count: upsertedRows.length,
      escenario_id,
      empresa_fletera_id,
      tipo_de_zona,
      tipos_de_servicio: tiposServicioProcesados,
      data: upsertedRows,
    });
  } catch (error: any) {
    console.error(`❌ Error inesperado en ${method} /api/import/movZonaServicioFletera:`, error);
    console.error('❌ Stack:', error.stack);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    return NextResponse.json(
      { error: 'Error interno del servidor', details: error.message },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  return handleImport(request);
}

export async function PUT(request: NextRequest) {
  return handleImport(request);
}

/**
 * GET /api/import/movZonaServicioFletera
 * Consultar zonas de una empresa fletera.
 *
 * Query params:
 *   - escenarioId (requerido)
 *   - efletera / empresaFleteraId (requerido)
 *   - tipoDeZona (opcional)
 *   - tipoDeServicio (opcional)
 */
export async function GET(request: NextRequest) {
  const keyValidation = requireApiKey(request);
  if (keyValidation instanceof NextResponse) return keyValidation;

  try {
    const sp = request.nextUrl.searchParams;
    const escenario_id = parseInt(sp.get('escenarioId') || sp.get('escenario_id') || '0', 10);
    const efletera = parseInt(
      sp.get('efletera') || sp.get('empresaFleteraId') || sp.get('empresa_fletera_id') || '0',
      10
    );

    if (!escenario_id || !efletera) {
      return NextResponse.json(
        { error: 'Se requiere escenarioId y efletera como query params' },
        { status: 400 }
      );
    }

    const supabase = getServerSupabaseClient();
    let query = (supabase as any)
      .from('fleteras_zonas')
      .select('*')
      .eq('escenario_id', escenario_id)
      .eq('empresa_fletera_id', efletera);

    const tipoDeZona = sp.get('tipoDeZona') || sp.get('tipo_de_zona');
    if (tipoDeZona) {
      query = query.eq('tipo_de_zona', tipoDeZona);
    }

    const tipoDeServicio = sp.get('tipoDeServicio') || sp.get('tipo_de_servicio');
    if (tipoDeServicio) {
      query = query.eq('tipo_de_servicio', tipoDeServicio.toUpperCase());
    }

    const { data, error } = await query;

    if (error) {
      console.error('❌ Error al consultar fleteras_zonas:', error);
      return NextResponse.json(
        { error: 'Error al consultar', details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      count: data?.length || 0,
      data: data || [],
    });
  } catch (error: any) {
    console.error('❌ Error inesperado en GET /api/import/movZonaServicioFletera:', error);
    return NextResponse.json(
      { error: 'Error interno del servidor', details: error.message },
      { status: 500 }
    );
  }
}
