import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase';
import { requireAuth } from '@/lib/auth-middleware';

// ─── GET /api/fleteras-zonas ──────────────────────────────────────────────────
// Query params opcionales:
//   escenario_id, empresa_fletera_id, tipo_de_zona, tipo_de_servicio
export async function GET(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const sp = request.nextUrl.searchParams;
    const supabase = getServerSupabaseClient();

    let query = (supabase as any)
      .from('fleteras_zonas')
      .select(`
        *,
        empresa:empresas_fleteras ( empresa_fletera_id, nombre, estado )
      `)
      .order('empresa_fletera_id', { ascending: true })
      .order('tipo_de_zona', { ascending: true })
      .order('tipo_de_servicio', { ascending: true });

    const escenario_id = sp.get('escenario_id');
    if (escenario_id) query = query.eq('escenario_id', parseInt(escenario_id));

    const empresa_fletera_id = sp.get('empresa_fletera_id');
    if (empresa_fletera_id) query = query.eq('empresa_fletera_id', parseInt(empresa_fletera_id));

    const tipo_de_zona = sp.get('tipo_de_zona');
    if (tipo_de_zona) query = query.ilike('tipo_de_zona', tipo_de_zona);

    const tipo_de_servicio = sp.get('tipo_de_servicio');
    if (tipo_de_servicio) query = query.ilike('tipo_de_servicio', tipo_de_servicio);

    const { data, error } = await query;

    if (error) {
      console.error('❌ GET /api/fleteras-zonas:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, count: data?.length ?? 0, data: data ?? [] });
  } catch (err: any) {
    console.error('❌ GET /api/fleteras-zonas unexpected:', err);
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
  }
}

// ─── POST /api/fleteras-zonas ─────────────────────────────────────────────────
// Body: { escenario_id, empresa_fletera_id, tipo_de_zona, tipo_de_servicio, zonas: number[] }
export async function POST(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const body = await request.json();
    const { escenario_id, empresa_fletera_id, tipo_de_zona, tipo_de_servicio, zonas } = body;

    if (!escenario_id || !empresa_fletera_id || !tipo_de_zona || !tipo_de_servicio) {
      return NextResponse.json(
        { error: 'Faltan campos requeridos: escenario_id, empresa_fletera_id, tipo_de_zona, tipo_de_servicio' },
        { status: 400 }
      );
    }

    const supabase = getServerSupabaseClient();

    const { data, error } = await (supabase as any)
      .from('fleteras_zonas')
      .insert({
        escenario_id: parseInt(String(escenario_id)),
        empresa_fletera_id: parseInt(String(empresa_fletera_id)),
        tipo_de_zona: String(tipo_de_zona).trim(),
        tipo_de_servicio: String(tipo_de_servicio).trim().toUpperCase(),
        zonas: Array.isArray(zonas) ? zonas.map(Number) : [],
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json(
          { error: 'Ya existe una asignación con esa combinación de empresa, tipo de zona y tipo de servicio' },
          { status: 409 }
        );
      }
      console.error('❌ POST /api/fleteras-zonas:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, data }, { status: 201 });
  } catch (err: any) {
    console.error('❌ POST /api/fleteras-zonas unexpected:', err);
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
  }
}

// ─── PUT /api/fleteras-zonas ──────────────────────────────────────────────────
// Actualiza (upsert) un registro por PK compuesta.
// Body: { escenario_id, empresa_fletera_id, tipo_de_zona, tipo_de_servicio, zonas: number[] }
export async function PUT(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const body = await request.json();
    const { escenario_id, empresa_fletera_id, tipo_de_zona, tipo_de_servicio, zonas } = body;

    if (!escenario_id || !empresa_fletera_id || !tipo_de_zona || !tipo_de_servicio) {
      return NextResponse.json(
        { error: 'Faltan campos requeridos: escenario_id, empresa_fletera_id, tipo_de_zona, tipo_de_servicio' },
        { status: 400 }
      );
    }

    const supabase = getServerSupabaseClient();

    const { data, error } = await (supabase as any)
      .from('fleteras_zonas')
      .upsert(
        {
          escenario_id: parseInt(String(escenario_id)),
          empresa_fletera_id: parseInt(String(empresa_fletera_id)),
          tipo_de_zona: String(tipo_de_zona).trim(),
          tipo_de_servicio: String(tipo_de_servicio).trim().toUpperCase(),
          zonas: Array.isArray(zonas) ? zonas.map(Number) : [],
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'escenario_id,tipo_de_zona,empresa_fletera_id,tipo_de_servicio' }
      )
      .select()
      .single();

    if (error) {
      console.error('❌ PUT /api/fleteras-zonas:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, data });
  } catch (err: any) {
    console.error('❌ PUT /api/fleteras-zonas unexpected:', err);
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
  }
}

// ─── DELETE /api/fleteras-zonas ───────────────────────────────────────────────
// Query params (PK compuesta):
//   escenario_id, empresa_fletera_id, tipo_de_zona, tipo_de_servicio
export async function DELETE(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const sp = request.nextUrl.searchParams;
    const escenario_id = sp.get('escenario_id');
    const empresa_fletera_id = sp.get('empresa_fletera_id');
    const tipo_de_zona = sp.get('tipo_de_zona');
    const tipo_de_servicio = sp.get('tipo_de_servicio');

    if (!escenario_id || !empresa_fletera_id || !tipo_de_zona || !tipo_de_servicio) {
      return NextResponse.json(
        { error: 'Faltan query params: escenario_id, empresa_fletera_id, tipo_de_zona, tipo_de_servicio' },
        { status: 400 }
      );
    }

    const supabase = getServerSupabaseClient();

    const { error } = await (supabase as any)
      .from('fleteras_zonas')
      .delete()
      .eq('escenario_id', parseInt(escenario_id))
      .eq('empresa_fletera_id', parseInt(empresa_fletera_id))
      .eq('tipo_de_zona', tipo_de_zona)
      .eq('tipo_de_servicio', tipo_de_servicio.toUpperCase());

    if (error) {
      console.error('❌ DELETE /api/fleteras-zonas:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('❌ DELETE /api/fleteras-zonas unexpected:', err);
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
  }
}
