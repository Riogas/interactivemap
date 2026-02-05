-- ═══════════════════════════════════════════════════════════════════════════════
-- 🏢 Crear Empresa Fletera por Defecto (ID 999 "Sin Empresa")
-- ═══════════════════════════════════════════════════════════════════════════════
-- 
-- Propósito: Proporcionar una empresa genérica para móviles sin empresa asignada
-- Uso: Cuando SGM envía móviles sin el campo EFleteraId
-- 
-- ═══════════════════════════════════════════════════════════════════════════════

-- Insertar empresa fletera por defecto
INSERT INTO empresas_fleteras (
  empresa_fletera_id,
  escenario_id,
  nombre,
  razon_social,
  rut,
  direccion,
  telefono,
  email,
  contacto_nombre,
  contacto_telefono,
  estado,
  observaciones,
  created_at,
  updated_at
) VALUES (
  999,                           -- ID fijo para empresa genérica
  1000,                          -- Escenario por defecto
  'Sin Empresa',                 -- Nombre descriptivo
  'Sin Razón Social',            -- Razón social genérica
  '999999999',                   -- RUT genérico
  'Sin Dirección',               -- Dirección genérica
  'Sin Teléfono',                -- Teléfono genérico
  'sin-empresa@track.local',     -- Email genérico
  'Sin Contacto',                -- Contacto genérico
  'Sin Teléfono',                -- Teléfono contacto genérico
  1,                             -- Estado: Activo
  'Empresa genérica para móviles sin asignación. Creada automáticamente por el sistema.', -- Observaciones
  NOW(),                         -- Fecha creación
  NOW()                          -- Fecha actualización
)
ON CONFLICT (empresa_fletera_id, escenario_id) 
DO UPDATE SET 
  nombre = EXCLUDED.nombre,
  razon_social = EXCLUDED.razon_social,
  estado = 1,  -- Asegurar que está activa
  updated_at = NOW();

-- ═══════════════════════════════════════════════════════════════════════════════
-- 📊 Verificación
-- ═══════════════════════════════════════════════════════════════════════════════

-- Ver empresa creada
SELECT 
  empresa_fletera_id,
  escenario_id,
  nombre,
  razon_social,
  estado,
  observaciones,
  created_at
FROM empresas_fleteras
WHERE empresa_fletera_id = 999
  AND escenario_id = 1000;

-- Contar móviles sin empresa (antes del fix)
SELECT COUNT(*) AS moviles_sin_empresa
FROM moviles
WHERE empresa_fletera_id IS NULL
   OR empresa_fletera_id = 0;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 🔧 Opcional: Actualizar móviles existentes sin empresa
-- ═══════════════════════════════════════════════════════════════════════════════
-- 
-- Descomentar si quieres migrar móviles existentes con empresa_fletera_id NULL o 0
-- 

-- UPDATE moviles
-- SET empresa_fletera_id = 999,
--     updated_at = NOW()
-- WHERE (empresa_fletera_id IS NULL OR empresa_fletera_id = 0)
--   AND escenario_id = 1000;

-- ═══════════════════════════════════════════════════════════════════════════════
-- ✅ Resultado Esperado
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- Empresa creada:
-- ┌──────────────────────┬──────────────┬─────────────┬─────────────────────┐
-- │ empresa_fletera_id   │ escenario_id │ nombre      │ estado              │
-- ├──────────────────────┼──────────────┼─────────────┼─────────────────────┤
-- │ 999                  │ 1000         │ Sin Empresa │ 1 (Activo)          │
-- └──────────────────────┴──────────────┴─────────────┴─────────────────────┘
--
-- ═══════════════════════════════════════════════════════════════════════════════
