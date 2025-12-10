import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

/**
 * Transforma campos de PascalCase a snake_case para Supabase
 */
function transformMovilToSupabase(movil: any) {
  return {
    id: movil.id || movil.Nro?.toString() || movil.nro?.toString(),
    descripcion: movil.Descripcion || movil.descripcion,
    detalle_html: movil.DetalleHTML || movil.detalle_html || '',
    distancia_max_mts_cump_pedidos: movil.DistanciaMaxMtsCumpPedidos ?? movil.distancia_max_mts_cump_pedidos ?? 0,
    empresa_fletera_id: movil.EFleteraId || movil.empresa_fletera_id,
    empresa_fletera_nom: movil.EFleteraNom || movil.empresa_fletera_nom,
    estado_desc: movil.EstadoDesc || movil.estado_desc || '',
    estado_nro: movil.EstadoNro ?? movil.estado_nro ?? 0,
    fch_hora_mov: movil.FchHoraMov || movil.fch_hora_mov,
    fch_hora_upd_firestore: movil.FchHoraUPDFireStore || movil.fch_hora_upd_firestore,
    matricula: movil.Matricula || movil.matricula,
    mostrar_en_mapa: movil.MostrarEnMapa === 'S' || movil.mostrar_en_mapa === true,
    nro: movil.Nro ?? movil.nro,
    obs: movil.Obs || movil.obs || '',
    pedidos_pendientes: movil.PedidosPendientes ?? movil.pedidos_pendientes ?? 0,
    permite_baja_momentanea: movil.PermiteBajaMomentanea === 'S' || movil.permite_baja_momentanea === true,
    print_screen: movil.PrintScreen === 'S' || movil.print_screen === true,
    se_puede_activar_desde_la_app: movil.SePuedeActivarDesdeLaApp === 'S' || movil.se_puede_activar_desde_la_app === true,
    se_puede_desactivar_desde_la_app: movil.SePuedeDesactivarDesdeLaApp === 'S' || movil.se_puede_desactivar_desde_la_app === true,
    tamano_lote: movil.TamanoLote ?? movil.tamano_lote,
    visible_en_app: movil.VisibleEnApp === 'S' || movil.visible_en_app === true,
    debug_mode: movil.debugMode ?? movil.debug_mode ?? false,
    gps_n8n: movil.gpsN8n ?? movil.gps_n8n ?? false,
    grabar_pantalla: movil.grabarPantalla ?? movil.grabar_pantalla ?? false,
  };
}

/**
 * POST /api/import/moviles
 * Importar móviles desde fuente externa
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    let { moviles } = body;

    // Si no viene "moviles", asumir que el body ES el movil
    if (!moviles) {
      moviles = body;
    }

    // Normalizar a array si es un solo objeto
    const movilesArray = Array.isArray(moviles) ? moviles : [moviles];

    if (movilesArray.length === 0) {
      return NextResponse.json(
        { error: 'Se requiere al menos un móvil' },
        { status: 400 }
      );
    }

    console.log(`📦 Importando ${movilesArray.length} móvil(es)...`);

    // Transformar campos a formato Supabase
    const transformedMoviles = movilesArray.map(transformMovilToSupabase);

    // Insertar móviles en Supabase
    const { data, error } = await supabase
      .from('moviles')
      .insert(transformedMoviles)
      .select();

    if (error) {
      console.error('❌ Error al importar móviles:', error);
      return NextResponse.json(
        { error: 'Error al importar móviles', details: error.message },
        { status: 500 }
      );
    }

    console.log(`✅ ${data?.length || 0} móviles importados`);

    return NextResponse.json({
      success: true,
      message: `${data?.length || 0} móviles importados correctamente`,
      data,
    });
  } catch (error: any) {
    console.error('❌ Error inesperado:', error);
    return NextResponse.json(
      { error: 'Error interno del servidor', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/import/moviles
 * Actualizar móviles existentes (upsert)
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    let { moviles } = body;

    // Si no viene "moviles", asumir que el body ES el movil
    if (!moviles) {
      moviles = body;
    }

    // Normalizar a array si es un solo objeto
    const movilesArray = Array.isArray(moviles) ? moviles : [moviles];

    if (movilesArray.length === 0) {
      return NextResponse.json(
        { error: 'Se requiere al menos un móvil para actualizar' },
        { status: 400 }
      );
    }

    console.log(`🔄 Actualizando ${movilesArray.length} móvil(es)...`);

    // Transformar campos a formato Supabase
    const transformedMoviles = movilesArray.map(transformMovilToSupabase);

    // Upsert: Insertar o actualizar si ya existe
    const { data, error } = await supabase
      .from('moviles')
      .upsert(transformedMoviles, {
        onConflict: 'id', // PRIMARY KEY de la tabla
      })
      .select();

    if (error) {
      console.error('❌ Error al actualizar móviles:', error);
      return NextResponse.json(
        { error: 'Error al actualizar móviles', details: error.message },
        { status: 500 }
      );
    }

    console.log(`✅ ${data?.length || 0} móviles actualizados`);

    return NextResponse.json({
      success: true,
      message: `${data?.length || 0} móviles actualizados correctamente`,
      data,
    });
  } catch (error: any) {
    console.error('❌ Error inesperado:', error);
    return NextResponse.json(
      { error: 'Error interno del servidor', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/import/moviles
 * Eliminar móviles por IDs
 */
export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const { movil_ids } = body;

    if (!movil_ids || !Array.isArray(movil_ids)) {
      return NextResponse.json(
        { error: 'Se requiere un array de movil_ids' },
        { status: 400 }
      );
    }

    console.log(`🗑️ Eliminando ${movil_ids.length} móviles...`);

    const { data, error } = await supabase
      .from('moviles')
      .delete()
      .in('id', movil_ids)
      .select();

    if (error) {
      console.error('❌ Error al eliminar móviles:', error);
      return NextResponse.json(
        { error: 'Error al eliminar móviles', details: error.message },
        { status: 500 }
      );
    }

    console.log(`✅ ${data?.length || 0} móviles eliminados`);

    return NextResponse.json({
      success: true,
      message: `${data?.length || 0} móviles eliminados correctamente`,
      deleted_count: data?.length || 0,
    });
  } catch (error: any) {
    console.error('❌ Error inesperado:', error);
    return NextResponse.json(
      { error: 'Error interno del servidor', details: error.message },
      { status: 500 }
    );
  }
}
