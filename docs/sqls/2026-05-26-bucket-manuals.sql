-- Setup del bucket 'manuals' en Supabase Storage.
-- Ejecutar UNA SOLA VEZ en el SQL Editor de Supabase (run-once setup).
--
-- El bucket es PÚBLICO: los PDFs son manuales de uso interno, no son datos sensibles.
-- Esto permite que el botón "?" del dashboard descargue sin auth ni signed URLs.
--
-- El INSERT/UPDATE del bucket solo lo hace el backend con SERVICE_ROLE_KEY
-- (bypasea RLS — no se necesitan policies adicionales para escritura).

INSERT INTO storage.buckets (id, name, public)
VALUES ('manuals', 'manuals', true)
ON CONFLICT (id) DO NOTHING;

-- Policy de lectura pública para los objetos del bucket.
-- Necesaria cuando el bucket está marcado como público (lectura libre).
CREATE POLICY "manuals_public_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'manuals');
