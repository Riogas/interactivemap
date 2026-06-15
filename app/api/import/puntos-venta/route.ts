import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase';
import * as XLSX from 'xlsx';

/**
 * POST /api/import/puntos-venta
 * Importa o actualiza puntos de venta desde un archivo Excel (.xlsx).
 *
 * Body: multipart/form-data
 *   - file: archivo .xlsx
 *   - usuario: string (email o username del usuario que importa)
 *
 * Columnas esperadas en el Excel (header row + filas de datos):
 *   ID              (requerido, number)  -> punto_venta_id
 *   Nombre          (requerido, string)
 *   Direccion       (opcional, string)
 *   CoordX          (latitud, number)
 *   CoordY          (longitud, number)
 *   Telefono        (opcional, number)
 *   escenario_id    (opcional, number)
 *   empresa_fletera_id (opcional, number)
 *
 * Devuelve: { success: true, count: number, data: any[] }
 */
export async function POST(request: NextRequest) {
  try {
    // Parsear multipart/form-data con la API nativa de Next.js
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return NextResponse.json(
        { error: 'No se pudo parsear el formulario. Asegurate de enviar multipart/form-data.' },
        { status: 400 }
      );
    }

    const file = formData.get('file');
    const usuario = formData.get('usuario') ?? 'admin';

    if (!file || typeof file === 'string') {
      return NextResponse.json(
        { error: 'Se requiere un campo "file" con el archivo .xlsx' },
        { status: 400 }
      );
    }

    // Validar extension
    const fileName = (file as File).name ?? '';
    if (!fileName.toLowerCase().endsWith('.xlsx') && !fileName.toLowerCase().endsWith('.xls')) {
      return NextResponse.json(
        { error: 'El archivo debe ser .xlsx o .xls' },
        { status: 400 }
      );
    }

    // Leer el buffer del archivo
    const buffer = await (file as File).arrayBuffer();
    const workbook = XLSX.read(Buffer.from(buffer), { type: 'buffer' });

    if (!workbook.SheetNames.length) {
      return NextResponse.json(
        { error: 'El archivo no contiene hojas de calculo' },
        { status: 400 }
      );
    }

    const ws = workbook.Sheets[workbook.SheetNames[0]];
    const raw: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

    if (raw.length < 2) {
      return NextResponse.json(
        { error: 'El archivo no tiene filas de datos (solo encabezado o esta vacio)' },
        { status: 400 }
      );
    }

    // Mapear columnas por nombre (case-insensitive, incluye parciales)
    const headers: string[] = (raw[0] as any[]).map(h => String(h ?? '').trim());
    const idx = (name: string) =>
      headers.findIndex(h => h.toLowerCase().includes(name.toLowerCase()));

    const iId              = idx('ID');
    const iNombre          = idx('Nombre');
    const iDireccion       = idx('Direccion');
    const iCoordX          = idx('CoordX');
    const iCoordY          = idx('CoordY');
    const iTelefono        = idx('Telefono');
    const iEscenario       = idx('escenario');
    const iEmpresaFletera  = idx('empresa');

    if (iId < 0) {
      return NextResponse.json(
        { error: 'Columna "ID" no encontrada en el encabezado del archivo' },
        { status: 400 }
      );
    }
    if (iNombre < 0) {
      return NextResponse.json(
        { error: 'Columna "Nombre" no encontrada en el encabezado del archivo' },
        { status: 400 }
      );
    }

    // Mapear filas a objetos de la tabla puntoventa
    const rows = raw.slice(1).filter(r => r[iId] != null && r[iId] !== '').map(r => {
      const row: Record<string, any> = {
        punto_venta_id:     Number(r[iId]),
        nombre:             iNombre >= 0 ? String(r[iNombre] ?? '').trim() : null,
        direccion:          iDireccion >= 0 && r[iDireccion] != null ? String(r[iDireccion]).trim() || null : null,
        latitud:            iCoordX >= 0 && r[iCoordX] != null ? Number(r[iCoordX]) : null,
        longitud:           iCoordY >= 0 && r[iCoordY] != null ? Number(r[iCoordY]) : null,
        telefono:           iTelefono >= 0 && r[iTelefono] != null ? Number(r[iTelefono]) : null,
        escenario_id:       iEscenario >= 0 && r[iEscenario] != null ? Number(r[iEscenario]) : null,
        empresa_fletera_id: iEmpresaFletera >= 0 && r[iEmpresaFletera] != null ? Number(r[iEmpresaFletera]) : null,
      };
      return row;
    });

    if (rows.length === 0) {
      return NextResponse.json(
        { error: 'No se encontraron filas validas (la columna ID esta vacia en todas las filas)' },
        { status: 400 }
      );
    }

    console.log(`📦 Importando ${rows.length} punto(s) de venta (usuario: ${usuario})...`);

    const supabase = getServerSupabaseClient();
    const { data, error } = await (supabase as any)
      .from('puntoventa')
      .upsert(rows, { onConflict: 'punto_venta_id' })
      .select();

    if (error) {
      console.error('Error al upsert puntoventa:', error);
      return NextResponse.json(
        { error: error.message, details: error.details ?? null },
        { status: 500 }
      );
    }

    console.log(`Importados/actualizados ${data?.length ?? 0} punto(s) de venta`);
    return NextResponse.json({ success: true, count: data?.length ?? 0, data });
  } catch (err: any) {
    console.error('Error inesperado en POST /api/import/puntos-venta:', err);
    return NextResponse.json(
      { error: err.message || 'Error interno del servidor' },
      { status: 500 }
    );
  }
}
