import { NextRequest, NextResponse } from 'next/server';
import { API_BASE_URL } from '@/lib/api/config';
import { fetchExternalAPI } from '@/lib/fetch-with-timeout';
import https from 'https';

export const dynamic = 'force-dynamic';

// Agente HTTPS que ignora errores de certificado SSL (certificados internos)
const httpsAgent = new https.Agent({
  rejectUnauthorized: false
});

/**
 * POST /api/user-atributos
 * 
 * Proxy al endpoint SecuritySuite/getAtributos de GeneXus.
 * Devuelve los atributos del usuario logueado (empresas fleteras permitidas, etc.)
 * 
 * Body: { User: string }
 * Headers: Authorization: Bearer <token>
 * 
 * Respuesta parseada:
 * {
 *   success: true,
 *   allowedEmpresas: [{ id: number, nombre: string }] | null,
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const authHeader = request.headers.get('Authorization');

    if (!body.User) {
      return NextResponse.json(
        { success: false, error: 'User es requerido' },
        { status: 400 }
      );
    }

    if (!authHeader) {
      return NextResponse.json(
        { success: false, error: 'Authorization header es requerido' },
        { status: 401 }
      );
    }

    const url = `${API_BASE_URL}/servicios/SecuritySuite/getAtributos`;
    console.log(`🔑 Fetching atributos para usuario: ${body.User}`);

    const response = await fetchExternalAPI(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authHeader,
      },
      body: JSON.stringify({ User: body.User }),
      // @ts-expect-error - Node.js fetch acepta agent
      agent: url.startsWith('https:') ? httpsAgent : undefined,
    });

    if (!response.ok) {
      console.error(`❌ getAtributos respondió con status: ${response.status}`);
      return NextResponse.json(
        { success: false, error: `Error del servidor: ${response.status}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    console.log('📥 getAtributos response:', JSON.stringify(data));

    // Parsear la respuesta para extraer empresas fleteras
    const allowedEmpresas = parseEmpresasFromAtributos(data);

    console.log(`✅ Empresas permitidas para ${body.User}:`, allowedEmpresas);

    return NextResponse.json({
      success: true,
      allowedEmpresas,
      raw: data, // Para debug
    });
  } catch (error) {
    console.error('❌ Error en /api/user-atributos:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : 'Error al obtener atributos' 
      },
      { status: 500 }
    );
  }
}

/**
 * Parsea la respuesta de getAtributos y extrae las empresas fleteras permitidas.
 * 
 * Formato esperado:
 * {
 *   "sdtAtributos": [{
 *     "UserPreferenceAtributo": "EmpFletera",
 *     "UserPreferenceValor": "{\"340\": \"SOFIZEN S.A. - BUCEO\", \"48\": \"SOFIZEN S.A. - POCITOS\"}"
 *   }]
 * }
 * 
 * Retorna: [{ id: 340, nombre: "SOFIZEN S.A. - BUCEO" }, ...] o null si no hay restricción
 */
function parseEmpresasFromAtributos(data: any): { id: number; nombre: string }[] | null {
  try {
    const atributos = data?.sdtAtributos;
    if (!Array.isArray(atributos) || atributos.length === 0) {
      console.warn('⚠️ No hay atributos en la respuesta');
      return null;
    }

    // Buscar el atributo de empresas fleteras
    const empFleteraAttr = atributos.find(
      (a: any) => a.UserPreferenceAtributo === 'EmpFletera'
    );

    if (!empFleteraAttr || !empFleteraAttr.UserPreferenceValor) {
      console.warn('⚠️ No se encontró atributo EmpFletera');
      return null;
    }

    // Parsear el JSON de empresas
    const empresasJson = JSON.parse(empFleteraAttr.UserPreferenceValor);
    
    // Convertir de { "340": "nombre", "48": "nombre" } a array
    const empresas = Object.entries(empresasJson).map(([id, nombre]) => ({
      id: parseInt(id, 10),
      nombre: nombre as string,
    }));

    return empresas.length > 0 ? empresas : null;
  } catch (e) {
    console.error('❌ Error parseando atributos de empresas:', e);
    return null;
  }
}
