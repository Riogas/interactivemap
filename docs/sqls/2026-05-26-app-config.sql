-- Tabla genérica key-value para configuración de la aplicación.
-- Usada actualmente para almacenar la URL del manual dinámico (manual_url).
-- Se puede extender a futuro para otros valores de config global (ej: url_tutorial, etc.).

CREATE TABLE IF NOT EXISTS app_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  description TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by TEXT
);

-- Seed inicial: apunta al PDF estático ya existente.
-- Después del primer upload desde PreferenciasGlobalesModal, este valor
-- se reemplaza por la URL de Supabase Storage.
INSERT INTO app_config (key, value, description)
VALUES (
  'manual_url',
  '/manual/InstructivoRiogasTracking.pdf',
  'URL del manual de uso descargable desde el botón ? del dashboard'
)
ON CONFLICT (key) DO NOTHING;
