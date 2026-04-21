import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';

/**
 * POST /api/auth/login
 *
 * Flujo de autenticación:
 * 1. Intenta login contra GeneXus (secapi.riogas.com.uy)
 * 2. Si GeneXus falla → intenta autenticación LDAP via AS400 API
 * 3. Si LDAP tiene éxito → crea/actualiza usuario en tabla local_users de Supabase
 *    y devuelve la misma forma de respuesta que GeneXus para que el resto del
 *    frontend funcione sin cambios.
 */

const LOGIN_API_URL = process.env.LOGIN_API_URL || 'https://secapi.riogas.com.uy/api/db/login';
const SISTEMA = process.env.LOGIN_SISTEMA || 'GOYA';
const AS400_API_URL = process.env.AS400_API_URL || '';
const LDAP_ROLE_DESPACHO_ID = process.env.LDAP_ROLE_DESPACHO_ID || 'DESPACHO';

// ─── Supabase service client (solo server-side) ───────────────────────────────
function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

// ─── Upsert del usuario LDAP en Supabase ─────────────────────────────────────
async function upsertLdapUser(user: {
  username: string;
  email: string;
  nombre: string;
  department: string;
  title: string;
  groups: string[];
  isDespacho: boolean;
}, roles: Array<{ RolId: string; RolNombre: string; RolTipo: string }>) {
  try {
    const supabase = getServiceClient();
    const { error } = await supabase
      .from('local_users')
      .upsert({
        id: `ldap_${user.username}`,
        username: user.username,
        email: user.email,
        nombre: user.nombre,
        department: user.department,
        title: user.title,
        source: 'ldap',
        roles,
        ad_groups: user.groups,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'id' });

    if (error) console.error('⚠️ [LDAP] Error upsert local_users:', error.message);
    else console.log(`✅ [LDAP] Usuario ${user.username} guardado en local_users`);
  } catch (err) {
    console.error('⚠️ [LDAP] upsertLdapUser falló (no crítico):', err);
  }
}

// ─── Fallback: autenticación LDAP via AS400 API ───────────────────────────────
async function tryLDAPLogin(username: string, password: string) {
  if (!AS400_API_URL) return null;

  try {
    console.log(`🔄 [LDAP] Intentando autenticación LDAP para: ${username}`);
    const res = await fetch(`${AS400_API_URL}/api/auth/ldap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) return null;

    const ldapData = await res.json();
    if (!ldapData.success) {
      console.log(`❌ [LDAP] Credenciales inválidas para: ${username}`);
      return null;
    }

    const { user } = ldapData;

    const roles: Array<{ RolId: string; RolNombre: string; RolTipo: string }> = [];
    if (user.isDespacho) {
      roles.push({ RolId: LDAP_ROLE_DESPACHO_ID, RolNombre: 'Despacho', RolTipo: 'APP' });
    }

    // Guardar/actualizar usuario en Supabase (no bloquea la respuesta)
    upsertLdapUser(user, roles).catch(() => {});

    const token = randomUUID();

    return {
      success: true,
      token,
      source: 'ldap',
      message: 'Login exitoso via LDAP',
      user: {
        id: `ldap_${user.username}`,
        username: user.username,
        email: user.email,
        nombre: user.nombre,
        isRoot: 'N',
        roles,
      },
    };
  } catch (err) {
    console.error('❌ [LDAP] Error en fallback LDAP:', err instanceof Error ? err.message : err);
    return null;
  }
}

// ─── Handler principal ────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  console.log('🔐 [/api/auth/login] Iniciando login...');

  try {
    const body = await request.json();
    const { UserName, Password } = body;

    if (!UserName || !Password) {
      return NextResponse.json(
        { success: false, message: 'UserName y Password son requeridos' },
        { status: 400 }
      );
    }

    console.log(`🔐 [/api/auth/login] Usuario: ${UserName}`);

    // ── Paso 1: GeneXus ──────────────────────────────────────────────────────
    let genexusOk = false;
    try {
      const response = await fetch(LOGIN_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ UserName, Password, Sistema: SISTEMA }),
        signal: AbortSignal.timeout(10000),
      });

      const contentType = response.headers.get('content-type');
      let data: any;

      if (contentType?.includes('application/json')) {
        data = await response.json();
      } else {
        const text = await response.text();
        try { data = JSON.parse(text); } catch {
          console.error('❌ [GeneXus] Respuesta no es JSON:', text.substring(0, 200));
          data = { success: false };
        }
      }

      // Formato GeneXus legacy: RespuestaLogin como string
      if (data.RespuestaLogin && typeof data.RespuestaLogin === 'string') {
        try {
          let raw = data.RespuestaLogin;
          const lastBrace = raw.lastIndexOf('}');
          if (lastBrace !== -1 && lastBrace < raw.length - 1) raw = raw.substring(0, lastBrace + 1);
          data = JSON.parse(raw);
        } catch (e) {
          console.error('❌ [GeneXus] Error parseando RespuestaLogin:', e);
        }
      }

      if (data.success && data.user?.id && data.user?.username) {
        console.log(`✅ [GeneXus] Login exitoso para: ${UserName}`);
        genexusOk = true;
        return NextResponse.json(data, { status: response.status });
      }

      console.log(`⚠️ [GeneXus] Login falló para ${UserName}: ${data.message || 'sin mensaje'}`);
    } catch (err) {
      console.error('⚠️ [GeneXus] Error o timeout:', err instanceof Error ? err.message : err);
    }

    // ── Paso 2: Fallback LDAP ────────────────────────────────────────────────
    if (!genexusOk) {
      const ldapResult = await tryLDAPLogin(UserName, Password);
      if (ldapResult) {
        return NextResponse.json(ldapResult);
      }
    }

    // ── Paso 3: Ambos fallaron ───────────────────────────────────────────────
    return NextResponse.json(
      { success: false, message: 'Credenciales inválidas' },
      { status: 401 }
    );
  } catch (error) {
    console.error('❌ [/api/auth/login] Error:', error);
    return NextResponse.json(
      {
        success: false,
        message: 'Error al conectar con el servidor de autenticación',
        details: error instanceof Error ? error.message : 'Error desconocido',
      },
      { status: 500 }
    );
  }
}
