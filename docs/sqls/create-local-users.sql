-- Tabla de usuarios autenticados via LDAP/AD
-- Correr en Supabase SQL Editor antes de usar el login LDAP

CREATE TABLE IF NOT EXISTS public.local_users (
  id          TEXT PRIMARY KEY,            -- 'ldap_{username}', ej: 'ldap_jgomez'
  username    TEXT NOT NULL UNIQUE,
  email       TEXT,
  nombre      TEXT,
  department  TEXT,
  title       TEXT,
  source      TEXT NOT NULL DEFAULT 'ldap', -- 'ldap' | futuro: 'saml', etc.
  roles       JSONB DEFAULT '[]',           -- [{RolId, RolNombre, RolTipo}]
  ad_groups   JSONB DEFAULT '[]',           -- lista de CNs de grupos AD
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- Índice para búsqueda por username
CREATE UNIQUE INDEX IF NOT EXISTS uq_local_users_username ON public.local_users (username);

-- RLS: solo el service role puede escribir; la app lee via service role en el login
ALTER TABLE public.local_users ENABLE ROW LEVEL SECURITY;

-- Política: lectura pública (para que el join con user_preferences funcione si se necesita)
CREATE POLICY "local_users_read" ON public.local_users
  FOR SELECT USING (true);

-- Política: escritura solo via service role (el token de servicio bypass RLS)
-- No se necesita política adicional: service role ignora RLS por defecto.
