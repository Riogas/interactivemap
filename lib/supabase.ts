import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/supabase';

// Variables de entorno
// En el browser, usar el proxy de nginx para evitar problemas de certificado auto-firmado
// En el servidor (Node.js), conectar directo a Supabase (NODE_TLS_REJECT_UNAUTHORIZED=0)
const supabaseDirectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseProxyUrl = process.env.NEXT_PUBLIC_SUPABASE_PROXY_URL;
const supabaseUrl = typeof window !== 'undefined' && supabaseProxyUrl 
  ? supabaseProxyUrl 
  : supabaseDirectUrl;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Faltan las variables de entorno de Supabase. Verifica NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY en .env.local');
}

// Cliente de Supabase para el lado del cliente (browser)
export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: false, // No necesitamos autenticación de usuarios en este caso
  },
  realtime: {
    params: {
      eventsPerSecond: 10, // Limitar eventos para optimizar performance
    },
    // Configuración mejorada para conexiones más estables
    timeout: 20000, // 20 segundos de timeout (por defecto es 10s)
    heartbeatIntervalMs: 15000, // Enviar heartbeat cada 15 segundos para mantener conexión viva
  },
  global: {
    headers: {
      'x-client-info': 'trackmovil-realtime',
    },
    // 🔧 TIMEOUT AUMENTADO: 30 segundos para requests HTTP
    fetch: (url, options = {}) => {
      return fetch(url, {
        ...options,
        signal: options.signal || AbortSignal.timeout(30000), // 30 segundos
      });
    },
  },
  db: {
    schema: 'public',
  },
});

// Cliente de Supabase para el lado del servidor (API routes)
// Usa service_role_key solo en backend para bypass RLS si es necesario
export function getServerSupabaseClient() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  
  if (serviceRoleKey) {
    // Servidor siempre usa URL directa (NODE_TLS_REJECT_UNAUTHORIZED=0 en PM2)
    return createClient<Database>(supabaseDirectUrl, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
      global: {
        headers: {
          'x-client-info': 'trackmovil-server',
        },
        // 🔧 TIMEOUT AUMENTADO: 30 segundos para requests HTTP del servidor
        fetch: (url, options = {}) => {
          return fetch(url, {
            ...options,
            signal: options.signal || AbortSignal.timeout(30000), // 30 segundos
          });
        },
      },
      db: {
        schema: 'public',
      },
    });
  }
  
  // Si no hay service role, usar anon key
  return supabase;
}
