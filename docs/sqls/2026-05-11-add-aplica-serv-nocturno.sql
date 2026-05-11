-- Migracion: agregar columna aplica_serv_nocturno a escenario_settings
-- Fecha: 2026-05-11
-- Feature: default automatico de capa diurno/nocturno segun horario del servidor (item #32)
-- Depende de: 2026-05-11-create-escenario-settings.sql

ALTER TABLE escenario_settings
  ADD COLUMN IF NOT EXISTS aplica_serv_nocturno boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN escenario_settings.aplica_serv_nocturno IS
  'Si el escenario cubre servicio nocturno. false = siempre se muestran zonas diurnas (URGENTE). true = se cambia automaticamente segun horario del servidor.';
