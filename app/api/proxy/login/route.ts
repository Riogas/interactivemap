import { NextRequest } from 'next/server';
import { API_BASE_URL } from '@/lib/api/config';
import { fetchExternalAPI } from '@/lib/fetch-with-timeout';
import { runLoginSecurity } from '@/lib/login-security';
import https from 'https';

// Agente HTTPS que ignora errores de certificado SSL
// NOTA: Solo para certificados auto-firmados internos de la API de gestión
const httpsAgent = new https.Agent({
  rejectUnauthorized: process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0' ? false : true
});

export async function POST(request: NextRequest) {
  console.log('🔐 [/api/proxy/login] Iniciando login...');

  return runLoginSecurity(request, async (body) => {
    const loginUrl = `${API_BASE_URL}/gestion/login`;

    // 🔧 TIMEOUT + REINTENTOS: fetchExternalAPI usa 30s timeout y 2 reintentos
    const response = await fetchExternalAPI(loginUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(body),
      credentials: 'include',
      // @ts-expect-error - Node.js fetch acepta agent
      agent: loginUrl.startsWith('https:') ? httpsAgent : undefined,
    });

    console.log('📥 Login Response Status:', response.status);

    let data;
    const contentType = response.headers.get('content-type');

    if (contentType && contentType.includes('application/json')) {
      data = await response.json();

      // 🔧 FIX: GeneXus devuelve JSON anidado como string
      if (data.RespuestaLogin && typeof data.RespuestaLogin === 'string') {
        try {
          let rawLogin = data.RespuestaLogin;
          const lastBrace = rawLogin.lastIndexOf('}');
          if (lastBrace !== -1 && lastBrace < rawLogin.length - 1) {
            console.log('🔧 Truncando texto extra después del JSON:', rawLogin.substring(lastBrace + 1));
            rawLogin = rawLogin.substring(0, lastBrace + 1);
          }
          const parsedLogin = JSON.parse(rawLogin);
          data = parsedLogin;
        } catch (e) {
          console.error('❌ Error al parsear RespuestaLogin:', e);
        }
      }
    } else {
      const text = await response.text();
      console.log('📥 Login Response Text:', text);
      data = { response: text };
    }

    return { success: response.ok, ...data };
  });
}
