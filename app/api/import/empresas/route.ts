import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { successResponse, errorResponse, logRequest } from '@/lib/api-response';
import { requireApiKey } from '@/lib/auth-middleware';

/**
 * Lee el body del request respetando el charset del Content-Type.
 */
async function readRequestBody(request: NextRequest): Promise<string> {
  const contentType = request.headers.get('content-type') || '';
  const charsetMatch = contentType.match(/charset=([\w-]+)/i);
  const charset = charsetMatch ? charsetMatch[1].toLowerCase() : 'iso-8859-1'; // GeneXus/AS400 raramente especifica charset
  
  if (charset === 'utf-8' || charset === 'utf8') {
    return await request.text();
  }
  
  const buffer = await request.arrayBuffer();
  const decoder = new TextDecoder(charset);
  const decoded = decoder.decode(buffer);
  console.log(`Body decodificado con charset: ${charset}`);
  return decoded;
}

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
 * Importar UNA empresa fletera desde fuente externa (GeneXus/AS400)
 * 
 * Body: un solo objeto {...} con los campos de la empresa
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
 * @returns 200 - Empresa importada correctamente
 * @returns 400 - Datos de entrada invalidos
 * @returns 500 - Error del servidor o base de datos
 */
export async function POST(request: NextRequest) {
  const keyValidation = requireApiKey(request);
  if (keyValidation instanceof NextResponse) return keyValidation;

  const timestamp = new Date().toISOString();
  console.log('\n' + '='.repeat(80));
  console.log(`[${timestamp}] POST /api/import/empresas - INICIO`);
  console.log('='.repeat(80));

  try {
    // PASO 1: Parsear body
    console.log('\nPASO 1: Parseando body JSON');
    let empresa;
    let rawBody = '';
    try {
      rawBody = await readRequestBody(request);
      console.log('Body raw (primeros 500 chars):', rawBody.substring(0, 500));
      empresa = JSON.parse(rawBody);
      console.log('JSON parseado correctamente');
    } catch (parseError: any) {
      console.error('ERROR al parsear JSON:', parseError.message);
      return errorResponse(
        'JSON invalido en el body de la peticion',
        400,
        { originalError: parseError.message }
      );
    }

    logRequest('POST', '/api/import/empresas', empresa);

    // PASO 2: Validar campos requeridos
    console.log('\nPASO 2: Validando empresa');
    const id = empresa.EFleteraId ?? empresa.empresa_fletera_id;
    const nombre = empresa.Nombre ?? empresa.nombre;

    if (!id || !nombre) {
      console.error('Empresa invalida: falta EFleteraId o Nombre', empresa);
      return errorResponse(
        'Empresa invalida: falta EFleteraId (empresa_fletera_id) o Nombre',
        400
      );
    }

    // PASO 3: Transformar datos
    console.log('\nPASO 3: Transformando datos a formato Supabase');
    const transformed = transformEmpresaToSupabase(empresa);
    console.log(`Empresa: ${transformed.nombre} (ID: ${transformed.empresa_fletera_id})`);

    // PASO 4: UPSERT en Supabase
    console.log('\nPASO 4: Insertando/Actualizando en Supabase (UPSERT)');
    const { data, error } = await supabase
      .from('empresas_fleteras')
      .upsert(transformed as any, {
        onConflict: 'empresa_fletera_id',
        ignoreDuplicates: false,
      })
      .select();

    if (error) {
      console.error('ERROR DE SUPABASE:', error.message, error.code, error.details);
      return errorResponse(
        'Error al importar empresa en Supabase',
        500,
        { supabaseError: error.message, code: error.code, details: error.details }
      );
    }

    // PASO 5: Resultado
    console.log('\nEmpresa importada correctamente');

    return successResponse(
      data?.[0] || transformed,
      `Empresa fletera "${transformed.nombre}" importada correctamente`
    );

  } catch (error: any) {
    console.error('Error inesperado:', error);
    return errorResponse(
      'Error interno del servidor',
      500,
      { details: error.message }
    );
  }
}