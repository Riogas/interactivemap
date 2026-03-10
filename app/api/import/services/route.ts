import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { requireApiKey } from '@/lib/auth-middleware';

/**
 * Transforma campos de PascalCase a snake_case para Supabase
 */
function transformServiceToSupabase(service: any) {
  const parseDate = (dateStr: string) => {
    if (!dateStr || dateStr.startsWith('0000-00-00')) {
      return null;
    }
    return dateStr;
  };

  /**
   * Convierte fecha en formato YYYYMMDD (sin ceros a la izquierda) a ISO 8601
   */
  const parseDateYYYYMMDD = (dateStr: string) => {
    if (!dateStr || dateStr === '0' || dateStr.startsWith('0000')) {
      return null;
    }

    try {
      const str = dateStr.toString().trim();

      if (str.includes('-') || str.includes('T')) {
        return parseDate(str);
      }

      const year = str.substring(0, 4);
      const monthDay = str.substring(4);

      let month, day;

      if (monthDay.length <= 2) {
        month = '01';
        day = monthDay.padStart(2, '0');
      } else if (monthDay.length === 3) {
        month = monthDay.substring(0, 1).padStart(2, '0');
        day = monthDay.substring(1);
      } else {
        month = monthDay.substring(0, 2);
        day = monthDay.substring(2);
      }

      const isoDate = `${year}-${month}-${day}`;

      const testDate = new Date(isoDate);
      if (isNaN(testDate.getTime())) {
        console.warn(`⚠️ Fecha inválida después de parseo: ${dateStr} -> ${isoDate}`);
        return null;
      }

      return isoDate;
    } catch {
      console.error(`❌ Error parseando fecha YYYYMMDD: ${dateStr}`);
      return null;
    }
  };

  return {
    id: service.id,
    escenario: service.escenario,

    // Datos del cliente
    cliente_ciudad: service.ClienteCiudad?.trim() || service.cliente_ciudad,
    cliente_direccion: service.ClienteDireccion?.trim() || service.cliente_direccion,
    cliente_direccion_esq1: service.ClienteDireccionEsq1?.trim() || service.cliente_direccion_esq1,
    cliente_direccion_obs: service.ClienteDireccionObs?.trim() || service.cliente_direccion_obs,
    cliente_nombre: service.ClienteNombre?.trim() || service.cliente_nombre,
    cliente_nro: service.ClienteNro ?? service.cliente_nro,
    cliente_obs: service.ClienteObs?.trim() || service.cliente_obs,
    cliente_tel: service.ClienteTel?.trim() || service.cliente_tel,

    // Info del servicio
    defecto: service.Defecto?.trim() || service.defecto || '',
    demora_informada: service.DemoraInformada ?? service.demora_informada ?? 0,
    detalle_html: service.DetalleHTML || service.detalle_html || '',
    empresa_fletera_id: service.EFleteraId ?? service.empresa_fletera_id,
    empresa_fletera_nom: service.EFleteraNom?.trim() || service.empresa_fletera_nom,
    estado_nro: service.EstadoNro ?? service.estado_nro,
    fpago_obs1: service.FPagoObs1?.trim() || service.fpago_obs1,

    // Fechas
    fch_hora_max_ent_comp: parseDate(service.FchHoraMaxEntComp || service.fch_hora_max_ent_comp),
    fch_hora_mov: parseDate(service.FchHoraMov || service.fch_hora_mov),
    fch_hora_para: parseDate(service.FchHoraPara || service.fch_hora_para),
    fch_hora_upd_firestore: parseDate(service.FchHoraUPDFireStore || service.fch_hora_upd_firestore),
    fch_para: parseDateYYYYMMDD(service.FchPara || service.fch_para),

    // URLs y precios
    google_maps_url: service.GoogleMapsURL || service.google_maps_url || '',
    imp_bruto: service.ImpBruto ? parseFloat(service.ImpBruto) : service.imp_bruto,
    imp_flete: service.ImpFlete ? parseFloat(service.ImpFlete) : service.imp_flete,

    // Asignación y estado
    movil: service.Movil ?? service.movil,
    orden_cancelacion: service.OrdenCancelacion || service.orden_cancelacion || 'N',
    otros_productos: service.OtrosProductos || service.otros_productos || '',
    pedido_obs: service.PedidoObs?.trim() || service.pedido_obs,
    precio: service.Precio ? parseFloat(service.Precio) : service.precio,
    prioridad: service.Prioridad ?? service.prioridad ?? 0,

    // Producto
    producto_cant: service.ProductoCant ? parseFloat(service.ProductoCant) : service.producto_cant,
    producto_cod: service.ProductoCod?.trim() || service.producto_cod,
    producto_nom: service.ProductoNom?.trim() || service.producto_nom,
    servicio_nombre: service.ServicioNombre?.trim() || service.servicio_nombre,

    // Sub estado
    sub_estado_desc: service.SubEstadoDesc?.trim() || service.sub_estado_desc,
    sub_estado_nro: service.SubEstadoNro ?? service.sub_estado_nro,

    // Otros
    tipo: service.Tipo || service.tipo || 'Services',
    visible_en_app: service.VisibleEnApp || service.visible_en_app || 'S',
    waze_url: service.WazeURL || service.waze_url || '',
    zona_nro: service.ZonaNro ?? service.zona_nro,
    ubicacion: service.ubicacion || '',

    // Coordenadas geográficas
    latitud: service.Latitud ?? service.latitud ?? null,
    longitud: service.Longitud ?? service.longitud ?? null,
  };
}

/**
 * POST /api/import/services
 * Importar o actualizar services desde fuente externa (UPSERT)
 * Si el service existe (mismo id), lo actualiza. Si no existe, lo inserta.
 */
export async function POST(request: NextRequest) {
  const keyValidation = requireApiKey(request);
  if (keyValidation instanceof NextResponse) return keyValidation;

  const timestamp = new Date().toISOString();
  console.log(`📋 IMPORTACIÓN DE SERVICES [${timestamp}]`);

  try {
    const body = await request.json();

    let { services } = body;

    // Si no viene "services", asumir que el body ES el service
    if (!services) {
      services = body;
    }

    // Normalizar a array si es un solo objeto
    const servicesArray = Array.isArray(services) ? services : [services];

    if (servicesArray.length === 0) {
      return NextResponse.json(
        { error: 'Se requiere al menos un service' },
        { status: 400 }
      );
    }

    console.log(`📊 Services a procesar: ${servicesArray.length}`);

    // Transformar campos a formato Supabase
    const transformedServices = servicesArray.map(transformServiceToSupabase);

    const { data, error } = await supabase
      .from('services')
      .upsert(transformedServices as any, {
        onConflict: 'id',
      })
      .select();

    if (error) {
      console.error('❌ Error Supabase services:', error.code, error.message);
      return NextResponse.json(
        { error: 'Error al importar services', details: error.message },
        { status: 500 }
      );
    }

    console.log(`✅ Services procesados: ${data?.length || 0}`);

    return NextResponse.json({
      success: true,
      message: `${data?.length || 0} services procesados correctamente (insertados o actualizados)`,
      data,
    });
  } catch (error: any) {
    console.error('❌ Error inesperado POST services:', error?.message);
    return NextResponse.json(
      { error: 'Error interno del servidor', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/import/services
 * Actualizar services existentes (upsert)
 */
export async function PUT(request: NextRequest) {
  const keyValidation = requireApiKey(request);
  if (keyValidation instanceof NextResponse) return keyValidation;

  const timestamp = new Date().toISOString();
  console.log(`🔄 ACTUALIZACIÓN DE SERVICES [${timestamp}]`);

  try {
    const body = await request.json();

    let { services } = body;

    if (!services) {
      services = body;
    }

    const servicesArray = Array.isArray(services) ? services : [services];

    if (servicesArray.length === 0) {
      return NextResponse.json(
        { error: 'Se requiere al menos un service para actualizar' },
        { status: 400 }
      );
    }

    console.log(`📊 Services a actualizar: ${servicesArray.length}`);

    const transformedServices = servicesArray.map(transformServiceToSupabase);

    const { data, error } = await supabase
      .from('services')
      .upsert(transformedServices as any, {
        onConflict: 'id',
      })
      .select();

    if (error) {
      console.error('❌ Error Supabase actualizar services:', error.code, error.message);
      return NextResponse.json(
        { error: 'Error al actualizar services', details: error.message },
        { status: 500 }
      );
    }

    console.log(`✅ Services actualizados: ${data?.length || 0}`);

    return NextResponse.json({
      success: true,
      message: `${data?.length || 0} services actualizados correctamente`,
      data,
    });
  } catch (error: any) {
    console.error('❌ Error inesperado PUT services:', error?.message);
    return NextResponse.json(
      { error: 'Error interno del servidor', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/import/services
 * Eliminar services por IDs
 */
export async function DELETE(request: NextRequest) {
  const keyValidation = requireApiKey(request);
  if (keyValidation instanceof NextResponse) return keyValidation;

  try {
    const body = await request.json();
    const { service_ids } = body;

    if (!service_ids || !Array.isArray(service_ids)) {
      return NextResponse.json(
        { error: 'Se requiere un array de service_ids' },
        { status: 400 }
      );
    }

    console.log(`🗑️ Eliminando ${service_ids.length} services...`);

    const { data, error } = await supabase
      .from('services')
      .delete()
      .in('id', service_ids)
      .select();

    if (error) {
      console.error('❌ Error al eliminar services:', error);
      return NextResponse.json(
        { error: 'Error al eliminar services', details: error.message },
        { status: 500 }
      );
    }

    console.log(`✅ ${data?.length || 0} services eliminados`);

    return NextResponse.json({
      success: true,
      message: `${data?.length || 0} services eliminados correctamente`,
      deleted_count: data?.length || 0,
    });
  } catch (error: any) {
    console.error('❌ Error inesperado DELETE services:', error?.message);
    return NextResponse.json(
      { error: 'Error interno del servidor', details: error.message },
      { status: 500 }
    );
  }
}
