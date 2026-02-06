import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { requireAuth } from '@/lib/auth-middleware';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ movilId: string }> }
) {
  // 🔒 AUTENTICACIÓN REQUERIDA
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const { movilId } = await params;

    // Obtener parámetros de query
    const searchParams = request.nextUrl.searchParams;
    const escenarioId = searchParams.get('escenarioId') || '1';
    const fecha = searchParams.get('fecha'); // ✅ NUEVO: Obtener fecha del query param

    // 🔧 RETRY LOGIC: Reintentar hasta 3 veces si falla por timeout
    let pedidos = null;
    let error = null;
    let attempt = 0;
    const maxRetries = 3;

    while (attempt < maxRetries && !pedidos) {
      attempt++;
      
      try {
        console.log(`🔄 Intento ${attempt}/${maxRetries} - Obteniendo pedidos pendientes para móvil ${movilId}`);
        
        // Construir query de pedidos pendientes del móvil
        let query = supabase
          .from('pedidos')
          .select(`
            id,
            escenario,
            movil,
            estado_nro,
            cliente_ciudad,
            cliente_direccion,
            cliente_nombre,
            cliente_nro,
            cliente_tel,
            cliente_obs,
            detalle_html,
            empresa_fletera_id,
            fch_hora_max_ent_comp,
            fch_para,
            google_maps_url,
            imp_bruto,
            imp_flete,
            pedido_obs,
            precio,
            prioridad,
            producto_cant,
            producto_cod,
            producto_nom,
            servicio_nombre,
            tipo,
            ubicacion,
            zona_nro
          `)
          .eq('movil', movilId)
          .eq('escenario', escenarioId)
          .in('estado_nro', [1, 2, 3, 4, 5, 6, 7]) // Estados que representan pendientes
          .not('latitud', 'is', null) // Solo pedidos con coordenadas
          .not('longitud', 'is', null);

        // ✅ Filtrar por fecha si se proporciona
        if (fecha) {
          query = query.eq('fch_para', fecha);
        }

        query = query
          .order('prioridad', { ascending: false })
          .order('fch_hora_para', { ascending: true});

        const result = await query;

        if (result.error) {
          throw result.error;
        }

        pedidos = result.data;
        console.log(`✅ Pedidos obtenidos exitosamente (${pedidos?.length || 0} registros)`);
        
      } catch (err: any) {
        error = err;
        const isTimeout = err.message?.includes('timeout') || err.message?.includes('Timeout') || err.message?.includes('fetch failed');
        
        if (isTimeout && attempt < maxRetries) {
          const delay = Math.pow(2, attempt - 1) * 1000; // 1s, 2s, 4s
          console.error(`❌ Timeout en intento ${attempt}/${maxRetries} - Reintentando en ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        } else if (attempt >= maxRetries) {
          console.error(`❌ Error después de ${maxRetries} intentos:`, {
            message: err.message,
            details: err.toString(),
            hint: err.hint || '',
            code: err.code || '',
          });
        } else {
          // Error no relacionado con timeout, no reintentar
          throw err;
        }
      }
    }

    if (error && !pedidos) {
      return NextResponse.json(
        { error: 'Error al obtener pedidos pendientes', details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      movilId: parseInt(movilId),
      escenarioId: parseInt(escenarioId),
      pedidos: pedidos || [],
      total: pedidos?.length || 0,
    });
  } catch (error) {
    console.error('Error inesperado:', error);
    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500 }
    );
  }
}
