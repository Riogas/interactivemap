import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/supabase';

// Variables de entorno
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
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
  },
});

// Cliente de Supabase para el lado del servidor (API routes)
// Usa service_role_key solo en backend para bypass RLS si es necesario
export function getServerSupabaseClient() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  
  if (serviceRoleKey) {
    return createClient<Database>(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }
  
  // Si no hay service role, usar anon key
  return supabase;
}
