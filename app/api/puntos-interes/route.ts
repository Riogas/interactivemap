import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase';
import { requireAuth } from '@/lib/auth-middleware';

/**
 * POST /api/puntos-interes
 * Crear o actualizar un punto de interés (UPSERT)
 * Body: { id?, nombre, descripcion, icono, latitud, longitud, tipo?, usuario_email }
 * Si se incluye 'id' y existe, se actualiza. Si no existe o no se incluye 'id', se crea uno nuevo.
 */
export async function POST(request: NextRequest) {
  // 🔒 AUTENTICACIÓN REQUERIDA
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const supabase = getServerSupabaseClient();
    const body = await request.json();
    const {
      nombre,
      descripcion,
      icono,
      latitud,
      longitud,
      tipo,
      usuario_email,
      escenario_id,
      empresa_fletera_id,
    } = body;

    // Validaciones
    if (!usuario_email) {
      return NextResponse.json(
        { error: 'usuario_email es requerido' },
        { status: 400 }
      );
    }

    if (!nombre || nombre.trim().length === 0) {
      return NextResponse.json(
        { error: 'El nombre es obligatorio' },
        { status: 400 }
      );
    }

    if (!icono) {
      return NextResponse.json(
        { error: 'El icono es obligatorio' },
        { status: 400 }
      );
    }

    if (typeof latitud !== 'number' || typeof longitud !== 'number') {
      return NextResponse.json(
        { error: 'Latitud y longitud deben ser números válidos' },
        { status: 400 }
      );
    }

    if (tipo && !['publico', 'privado', 'osm'].includes(tipo)) {
      return NextResponse.json(
        { error: 'El tipo debe ser "publico", "privado" o "osm"' },
        { status: 400 }
      );
    }

    console.log('📍 Creando/Actualizando punto de interés:', {
      nombre,
      icono,
      usuario_email,
      coords: [latitud, longitud],
    });

    // UPSERT: Insertar o actualizar si ya existe (basado en id si se proporciona)
    // Si el body incluye un 'id', se actualizará ese registro
    // Si no incluye 'id' o el id no existe, se insertará uno nuevo
    const upsertData: any = {
      nombre: nombre.trim(),
      descripcion: descripcion?.trim() || null,
      icono,
      latitud,
      longitud,
      tipo: tipo || 'privado',
      usuario_email,
      visible: true,
    };

    // Si se proporciona un ID, incluirlo para el upsert
    if (body.id) {
      upsertData.id = body.id;
    }

    if (escenario_id !== undefined) {
      upsertData.escenario_id = escenario_id;
    }
    if (empresa_fletera_id !== undefined) {
      upsertData.empresa_fletera_id = empresa_fletera_id;
    }

    const { data, error } = await supabase
      .from('puntos_interes')
      .upsert(upsertData, {
        onConflict: 'id',
        ignoreDuplicates: false,
      })
      .select()
      .single() as any;

    if (error) {
      console.error('❌ Error al hacer upsert del punto:', error);
      
      return NextResponse.json(
        { error: 'Error al guardar el punto de interés', details: error.message },
        { status: 500 }
      );
    }

    const wasUpdate = body.id !== undefined;
    console.log(`✅ Punto ${wasUpdate ? 'actualizado' : 'creado'} exitosamente:`, data.id);

    return NextResponse.json(
      { 
        success: true, 
        message: `Punto de interés ${wasUpdate ? 'actualizado' : 'creado'}`,
        data 
      },
      { status: wasUpdate ? 200 : 201 }
    );

  } catch (error) {
    console.error('❌ Error en POST /api/puntos-interes:', error);
    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/puntos-interes?usuario_email=xxx
 * Obtener puntos privados del usuario + todos los públicos
 */
export async function GET(request: NextRequest) {
  // 🔒 AUTENTICACIÓN REQUERIDA
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const supabase = getServerSupabaseClient();
    const { searchParams } = new URL(request.url);
    const usuario_email = searchParams.get('usuario_email');
    const scopeRole = searchParams.get('scope_role'); // 'distribuidor' | 'root' | 'despacho' | null
    const scopeEmpresasRaw = searchParams.get('scope_empresas'); // CSV de IDs

    if (!usuario_email) {
      return NextResponse.json(
        { error: 'usuario_email es requerido como query param' },
        { status: 400 }
      );
    }

    // Validar identificador: rechazar valores con caracteres que puedan
    // alterar el filtro PostgREST .or() (`,`, `(`, `)`, `"`, espacios).
    // Acepta tanto emails (foo@bar.com) como usernames simples (DEMO) — el
    // cliente cae a `user.username` cuando `user.email` está vacío.
    if (!/^[^\s,()"]+$/.test(usuario_email)) {
      return NextResponse.json(
        { error: 'usuario_email inválido' },
        { status: 400 }
      );
    }

    console.log('📍 Obteniendo puntos para:', usuario_email, 'scope:', scopeRole);

    let query = (supabase
      .from('puntos_interes')
      .select('*')
      .eq('visible', true) as any);

    if (scopeRole === 'distribuidor') {
      // Distribuidor: privados solo de sus empresas, + públicos + osm (siempre).
      const empresas = (scopeEmpresasRaw || '')
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
        .map((s) => Number(s))
        .filter((n) => Number.isFinite(n));

      if (empresas.length === 0) {
        // Fail-closed para privados: solo públicos y osm.
        query = query.in('tipo', ['publico', 'osm']);
      } else {
        const csv = empresas.join(',');
        query = query.or(
          `and(tipo.eq.privado,empresa_fletera_id.in.(${csv})),tipo.eq.publico,tipo.eq.osm`
        );
      }
    } else {
      // Root/despacho/sin scope: comportamiento legacy — privados del usuario + públicos.
      query = query.or(`usuario_email.eq.${usuario_email},tipo.eq.publico`);
    }

    const { data, error } = await query.order('created_at', { ascending: false });

    if (error) {
      console.error('❌ Error al obtener puntos:', error);
      return NextResponse.json(
        { error: 'Error al obtener los puntos de interés', details: error.message },
        { status: 500 }
      );
    }

    console.log(`✅ ${data?.length || 0} puntos encontrados`);

    return NextResponse.json({
      success: true,
      data: data || [],
    });

  } catch (error) {
    console.error('❌ Error en GET /api/puntos-interes:', error);
    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/puntos-interes?id=123&usuario_email=xxx
 * Eliminar un punto de interés
 */
export async function DELETE(request: NextRequest) {
  // 🔒 AUTENTICACIÓN REQUERIDA
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const supabase = getServerSupabaseClient();
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const usuario_email = searchParams.get('usuario_email');

    if (!id || !usuario_email) {
      return NextResponse.json(
        { error: 'id y usuario_email son requeridos' },
        { status: 400 }
      );
    }

    console.log('🗑️ Eliminando punto:', id, 'Usuario:', usuario_email);

    // Verificar que el punto pertenece al usuario
    const { data: punto, error: fetchError } = await supabase
      .from('puntos_interes')
      .select('usuario_email')
      .eq('id', id)
      .single() as any;

    if (fetchError || !punto) {
      console.error('❌ Punto no encontrado:', fetchError);
      return NextResponse.json(
        { error: 'Punto de interés no encontrado' },
        { status: 404 }
      );
    }

    if (punto.usuario_email !== usuario_email) {
      console.error('❌ Usuario no autorizado para eliminar este punto');
      return NextResponse.json(
        { error: 'No tienes permiso para eliminar este punto' },
        { status: 403 }
      );
    }

    // Eliminar el punto
    const { error: deleteError } = await supabase
      .from('puntos_interes')
      .delete()
      .eq('id', id)
      .eq('usuario_email', usuario_email);

    if (deleteError) {
      console.error('❌ Error al eliminar:', deleteError);
      return NextResponse.json(
        { error: 'Error al eliminar el punto de interés', details: deleteError.message },
        { status: 500 }
      );
    }

    console.log('✅ Punto eliminado exitosamente');

    return NextResponse.json({
      success: true,
      message: 'Punto de interés eliminado',
    });

  } catch (error) {
    console.error('❌ Error en DELETE /api/puntos-interes:', error);
    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/puntos-interes
 * Actualizar un punto de interés
 * Body: { id, usuario_email, nombre?, descripcion?, icono?, tipo?, visible? }
 */
export async function PATCH(request: NextRequest) {
  // 🔒 AUTENTICACIÓN REQUERIDA
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const supabase = getServerSupabaseClient();
    const body = await request.json();
    const { id, usuario_email, ...updates } = body;

    if (!id || !usuario_email) {
      return NextResponse.json(
        { error: 'id y usuario_email son requeridos' },
        { status: 400 }
      );
    }

    console.log('✏️ Actualizando punto:', id, 'Usuario:', usuario_email);

    // Verificar que el punto pertenece al usuario
    const { data: punto, error: fetchError } = await supabase
      .from('puntos_interes')
      .select('usuario_email')
      .eq('id', id)
      .single() as any;

    if (fetchError || !punto) {
      console.error('❌ Punto no encontrado:', fetchError);
      return NextResponse.json(
        { error: 'Punto de interés no encontrado' },
        { status: 404 }
      );
    }

    if (punto.usuario_email !== usuario_email) {
      console.error('❌ Usuario no autorizado para actualizar este punto');
      return NextResponse.json(
        { error: 'No tienes permiso para actualizar este punto' },
        { status: 403 }
      );
    }

    // Actualizar el punto
    const { data, error: updateError } = await (supabase as any)
      .from('puntos_interes')
      .update(updates)
      .eq('id', id)
      .eq('usuario_email', usuario_email)
      .select()
      .single();

    if (updateError) {
      console.error('❌ Error al actualizar:', updateError);
      return NextResponse.json(
        { error: 'Error al actualizar el punto de interés', details: updateError.message },
        { status: 500 }
      );
    }

    console.log('✅ Punto actualizado exitosamente');

    return NextResponse.json({
      success: true,
      message: 'Punto de interés actualizado',
      data,
    });

  } catch (error) {
    console.error('❌ Error en PATCH /api/puntos-interes:', error);
    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500 }
    );
  }
}
