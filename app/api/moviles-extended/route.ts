import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '@/lib/auth-middleware';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

export async function GET(request: NextRequest) {
  // 🔒 AUTENTICACIÓN REQUERIDA
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  try {
    console.log('🔍 Fetching moviles extended data from Supabase...');

    // 1. Obtener datos de móviles (tamano_lote, matricula)
    const { data: movilesData, error: movilesError } = await supabase
      .from('moviles')
      .select('id, nro, tamano_lote, matricula, descripcion, estado_desc, estado_nro, empresa_fletera_id, empresa_fletera_nom')
      .eq('mostrar_en_mapa', true);

    if (movilesError) {
      console.error('❌ Error fetching moviles:', movilesError);
      return NextResponse.json({
        success: false,
        error: movilesError.message,
      }, { status: 500 });
    }

    // 2. Contar pedidos asignados por móvil (solo estado=1 y fecha de hoy)
    const hoy = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const hojSinGuiones = hoy.replace(/-/g, ''); // '2026-02-17' → '20260217' (formato services)
    const [pedidosResult, servicesResult] = await Promise.all([
      supabase
        .from('pedidos')
        .select('movil')
        .eq('escenario', 1000)
        .in('estado_nro', [1]) // Solo estado 1 (Pendiente/Asignado)
        .eq('fch_para', hoy) // Solo pedidos del día actual
        .not('movil', 'is', null),
      supabase
        .from('services')
        .select('movil')
        .eq('escenario', 1000)
        .in('estado_nro', [1]) // Solo estado 1 (Pendiente/Asignado)
        .eq('fch_para', hojSinGuiones) // Solo services del día actual
        .not('movil', 'is', null),
    ]);

    if (pedidosResult.error) {
      console.error('❌ Error counting pedidos:', pedidosResult.error);
      return NextResponse.json({ success: false, error: pedidosResult.error.message }, { status: 500 });
    }
    if (servicesResult.error) {
      console.error('❌ Error counting services:', servicesResult.error);
      return NextResponse.json({ success: false, error: servicesResult.error.message }, { status: 500 });
    }

    // 3. Agrupar pedidos + services por móvil
    const pedidosPorMovil: Record<number, number> = {};
    for (const pedido of pedidosResult.data) {
      if (pedido.movil) pedidosPorMovil[pedido.movil] = (pedidosPorMovil[pedido.movil] || 0) + 1;
    }
    for (const service of servicesResult.data) {
      if (service.movil) pedidosPorMovil[service.movil] = (pedidosPorMovil[service.movil] || 0) + 1;
    }

    // 4. Combinar datos
    const movilesExtended = movilesData.map(movil => ({
      id: movil.id,           // TEXT - ID del móvil en Supabase
      nro: movil.nro,         // INTEGER - Número del móvil
      tamanoLote: movil.tamano_lote || 0,
      matricula: movil.matricula || '',
      descripcion: movil.descripcion,
      estadoDesc: movil.estado_desc || '',
      estadoNro: movil.estado_nro ?? null,
      empresa_fletera_id: movil.empresa_fletera_id,
      empresa_fletera_nom: movil.empresa_fletera_nom,
      pedidosAsignados: pedidosPorMovil[movil.nro] || 0, // Usar nro para contar pedidos
    }));

    console.log(`✅ Fetched ${movilesExtended.length} moviles with extended data`);
    console.log('📊 Sample movil data:', movilesExtended[0]); // Ver primer móvil

    return NextResponse.json({
      success: true,
      count: movilesExtended.length,
      data: movilesExtended,
    });

  } catch (error) {
    console.error('❌ Unexpected error:', error);
    return NextResponse.json({
      success: false,
      error: 'Error interno del servidor',
    }, { status: 500 });
  }
}
