-- ============================================================
-- Tabla: email_settings (singleton)
-- Configuración GLOBAL ÚNICA de notificación de incidentes por
-- correo (SMTP + plantillas de asunto/cuerpo + destinatarios).
--
-- Al cargar un incidente (app/api/incidents/route.ts) la app envía
-- un mail fire-and-forget usando esta configuración (lib/email.ts).
-- Nunca bloquea el guardado del incidente si el envío falla.
--
-- smtp_password se guarda en texto plano (decisión de la spec) y
-- NUNCA se devuelve por el GET de /api/email-config.
--
-- Solo puede existir una fila (id = 1).
-- Se modifica via PUT /api/email-config (gate root/admin, misma
-- funcionalidad "Preferencias Globales" que abre el modal).
--
-- Correr en Supabase self-hosted una sola vez.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.email_settings (
  id                integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled           boolean NOT NULL DEFAULT false,
  smtp_host         text NOT NULL DEFAULT '',
  smtp_port         integer NOT NULL DEFAULT 587,
  smtp_secure       boolean NOT NULL DEFAULT false,
  smtp_user         text NOT NULL DEFAULT '',
  smtp_password     text NOT NULL DEFAULT '',
  from_email        text NOT NULL DEFAULT '',
  to_emails         text NOT NULL DEFAULT '',
  subject_template  text NOT NULL DEFAULT 'Nuevo incidente #{{id}} en TrackMovil',
  body_template      text NOT NULL DEFAULT E'Se reportó un incidente el {{fecha}}.\n\nUsuario: {{usuario}}\nReporta: {{reporter}}\nCelular: {{celular}}\nEmail: {{email}}\n\nDescripción:\n{{descripcion}}\n\nVer detalle: {{link}}',
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        text
);

-- Fila inicial con los defaults (envío desactivado hasta configurar SMTP).
INSERT INTO public.email_settings (id, updated_at, updated_by)
VALUES (1, now(), 'system')
ON CONFLICT (id) DO NOTHING;

-- Permisos: acceso solo via service_role (los endpoints usan el server client).
-- No exponer a anon ni authenticated directamente.
