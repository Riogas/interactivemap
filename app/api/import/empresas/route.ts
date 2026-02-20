import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { successResponse, errorResponse, logRequest } from '@/lib/api-response';
import { requireApiKey } from '@/lib/auth-middleware';

/**
 * Transforma campos de PascalCase a snake_case para Supabase
 * 
 * Acepta campos en PascalCase (GeneXus) o snake_case (directo)
 */
function transformEmpresaToSupabase(empresa: any) {
  return {
    empresa_fletera_id: empresa.EFleteraId ?? empresa.empresa_fletera_id,
    escenario_id: empresa.EscenarioId ?? empresa.escenario_id ?? 1000,
    nombre: empresa.Nombre ?? empresa.nombre ?? '',
    razon_social: empresa.RazonSocial ?? empresa.razon_social ?? null,
    rut: empresa.Rut ?? empresa.rut ?? null,
    direccion: empresa.Direccion ?? empresa.direccion ?? null,
    telefono: empresa.Telefono ?? empresa.telefono ?? null,
    email: empresa.Email ?? empresa.email ?? null,
    contacto_nombre: empresa.ContactoNombre ?? empresa.contacto_nombre ?? null,
    contacto_telefono: empresa.ContactoTelefono ?? empresa.contacto_telefono ?? null,
    estado: empresa.Estado ?? empresa.estado ?? 1,
    observaciones: empresa.Observaciones ?? empresa.observaciones ?? null,
  };
}

/**
 * POST /api/import/empresas
 * Importar empresas fleteras desde fuente externa (GeneXus/AS400)
 * 
 * Body: { empresas: [...] } o un array directo [...] o un solo objeto {...}
 * 
 * Campos aceptados (PascalCase o snake_case):
 * - EFleteraId / empresa_fletera_id (requerido)
 * - EscenarioId / escenario_id (default: 1000)
 * - Nombre / nombre (requerido)
 * - RazonSocial / razon_social
 * - Rut / rut
 * - Direccion / direccion
 * - Telefono / telefono
 * - Email / email
 * - ContactoNombre / contacto_nombre
 * - ContactoTelefono / contacto_telefono
 * - Estado / estado (default: 1)
 * - Observaciones / observaciones
 * 
 * @returns 200 - Empresas importadas correctamente
 * @returns 400 - Datos de entrada inválidos
 * @returns 500 - Error del servidor o base de datos
 */
export async function POST(request: NextRequest) {
  // 🔒 VALIDAR API KEY
  const keyValidation = requireApiKey(request);
  if (keyValidation instanceof NextResponse) return keyValidation;

  const timestamp = new Date().toISOString();
  console.log('\n' + '='.repeat(80));
  console.log(`🚀 [${timestamp}] POST /api/import/empresas - INICIO`);
  console.log('='.repeat(80));

  try {
    // PASO 1: Parsear body
    console.log('\n📦 PASO 1: Parseando body JSON');
    let body;
    let rawBody = '';
    try {
      rawBody = await request.text();
      console.log('Body raw (primeros 500 chars):', rawBody.substring(0, 500));
      body = JSON.parse(rawBody);
      console.log('✅ JSON parseado correctamente');
    } catch (parseError: any) {
      console.error('❌ ERROR al parsear JSON:', parseError.message);
      return errorResponse(
        'JSON inválido en el body de la petición',
        400,
        { originalError: parseError.message }
      );
    }

    logRequest('POST', '/api/import/empresas', body);

    // PASO 2: Extraer empresas del body
    console.log('\n🔍 PASO 2: Extrayendo empresas del body');
    let { empresas } = body;

    // Si no viene "empresas", intentar con "empresas_fleteras" o asumir que el body ES la empresa
    if (!empresas) {
      empresas = body.empresas_fleteras || body;
      console.log('⚠️  No se encontró clave "empresas", usando fallback');
    }

    // Normalizar a array
    const empresasArray = Array.isArray(empresas) ? empresas : [empresas];
    console.log(`📊 Cantidad de empresas a procesar: ${empresasArray.length}`);

    // PASO 3: Validación
    if (empresasArray.length === 0) {
      return errorResponse('Se requiere al menos una empresa en el body', 400);
    }

    // Validar que cada empresa tenga empresa_fletera_id y nombre
    const invalidas = empresasArray.filter((e: any, i: number) => {
      const id = e.EFleteraId ?? e.empresa_fletera_id;
      const nombre = e.Nombre ?? e.nombre;
      if (!id || !nombre) {
        console.error(`❌ Empresa #${i + 1} inválida: falta empresa_fletera_id o nombre`, e);
        return true;
      }
      return false;
    });

    if (invalidas.length > 0) {
      return errorResponse(
        `${invalidas.length} empresa(s) inválida(s): falta empresa_fletera_id o nombre`,
        400,
        { invalidas }
      );
    }

    // PASO 4: Transformar datos
    console.log('\n🔄 PASO 4: Transformando datos a formato Supabase');
    const transformedEmpresas = empresasArray.map((empresa: any, index: number) => {
      const transformed = transformEmpresaToSupabase(empresa);
      console.log(`Empresa #${index + 1}: ${transformed.nombre} (ID: ${transformed.empresa_fletera_id})`);
      return transformed;
    });

    // PASO 5: UPSERT en Supabase
    console.log('\n💾 PASO 5: Insertando/Actualizando en Supabase (UPSERT)');
    const { data, error } = await supabase
      .from('empresas_fleteras')
      .upsert(transformedEmpresas as any, {
        onConflict: 'empresa_fletera_id',
        ignoreDuplicates: false,
      })
      .select();

    if (error) {
      console.error('❌ ERROR DE SUPABASE:', error.message, error.code, error.details);
      return errorResponse(
        'Error al importar empresas en Supabase',
        500,
        { supabaseError: error.message, code: error.code, details: error.details }
      );
    }

    // PASO 6: Resultado
    const resultado = {
      importadas: data?.length || 0,
      total_recibidas: empresasArray.length,
      timestamp,
    };

    console.log('\n✅ RESULTADO FINAL:');
    console.log(`   Recibidas: ${resultado.total_recibidas}`);
    console.log(`   Importadas: ${resultado.importadas}`);

    return successResponse(
      data || [],
      `${resultado.importadas} empresas fleteras importadas correctamente`
    );

  } catch (error: any) {
    console.error('❌ Error inesperado:', error);
    return errorResponse(
      'Error interno del servidor',
      500,
      { details: error.message }
    );
  }
}
