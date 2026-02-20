-- ===================================================================
-- PRUEBA: AGREGAR MÓVIL NUEVO EN TIEMPO REAL
-- ===================================================================
-- 
-- Este script demuestra cómo agregar un móvil nuevo y ver que aparece
-- automáticamente en la lista de la aplicación sin refresh.
--
-- INSTRUCCIONES:
-- 1. Abre la aplicación en http://localhost:3000
-- 2. Abre Supabase SQL Editor en otra pestaña
-- 3. Ejecuta este script LÍNEA POR LÍNEA
-- 4. Observa en la aplicación:
--    ✅ El nuevo móvil aparece automáticamente en la lista lateral
--    ✅ Consola muestra: "🚗 Nuevo móvil detectado en tiempo real"
--    ✅ Después del INSERT de GPS, el marcador aparece en el mapa
-- ===================================================================

-- PASO 1: Verificar móviles existentes
-- ====================================
SELECT 
  movil,
  matricula,
  empresa_fletera_id,
  estado,
  mostrar_en_mapa
FROM moviles 
WHERE escenario_id = 1000
ORDER BY movil;

-- Resultado esperado:
-- movil | matricula | empresa_fletera_id | estado | mostrar_en_mapa
-- ------|-----------|-------------------|--------|----------------
-- 1001  | SBQ 3254  | 1                 | 1      | true
-- 1002  | ABC 1234  | 1                 | 1      | true
-- 1003  | XYZ 5678  | 2                 | 1      | true
-- 1004  | DEF 9012  | 2                 | 1      | true


-- PASO 2: Insertar un móvil NUEVO (ID 1005)
-- ==========================================
-- ⚠️ IMPORTANTE: Ejecuta esta línea y observa la aplicación
-- La lista de móviles debe actualizarse AUTOMÁTICAMENTE

INSERT INTO moviles (
  movil, 
  escenario_id, 
  empresa_fletera_id, 
  estado, 
  matricula, 
  mostrar_en_mapa,
  created_at,
  updated_at
) VALUES (
  1005,                    -- ID del nuevo móvil
  1000,                    -- escenario_id
  1,                       -- MONDELLI SRL
  1,                       -- Estado activo
  'GHI 3456',              -- Matrícula
  true,                    -- Mostrar en mapa
  NOW(),
  NOW()
);

-- ⏳ ESPERA 2 SEGUNDOS y observa:
-- ✅ En la lista lateral debe aparecer "Móvil-1005 | GHI 3456"
-- ✅ En la consola: "🚗 Nuevo móvil detectado en tiempo real: { movil: 1005, ... }"


-- PASO 3: Darle una posición GPS al móvil nuevo
-- ==============================================
-- Esto hace que aparezca el marcador en el mapa

INSERT INTO gps_tracking_extended (
  movil,
  latitud,
  longitud,
  fecha_hora,
  escenario_id,
  velocidad,
  distancia_recorrida
) VALUES (
  '1005',                  -- Móvil nuevo (VARCHAR)
  -34.9040,                -- Latitud (Montevideo)
  -56.1640,                -- Longitud
  NOW(),                   -- Timestamp
  1000,                    -- escenario_id
  45,                      -- Velocidad: 45 km/h
  125.5                    -- Distancia recorrida
);

-- ⏳ ESPERA 2 SEGUNDOS y observa:
-- ✅ Aparece un marcador 🚗 en el mapa para el móvil 1005
-- ✅ En la consola: "🔔 Actualización Realtime para móvil 1005"


-- PASO 4: Insertar otro móvil nuevo (ID 1006)
-- ============================================
INSERT INTO moviles (
  movil, 
  escenario_id, 
  empresa_fletera_id, 
  estado, 
  matricula, 
  mostrar_en_mapa,
  created_at,
  updated_at
) VALUES (
  1006,                    -- ID del nuevo móvil
  1000,                    -- escenario_id
  2,                       -- TORCOR
  1,                       -- Estado activo
  'JKL 7890',              -- Matrícula
  true,                    -- Mostrar en mapa
  NOW(),
  NOW()
);

-- ⏳ ESPERA 2 SEGUNDOS
-- ✅ Aparece "Móvil-1006 | JKL 7890" en la lista


-- PASO 5: Darle GPS al móvil 1006
-- ================================
INSERT INTO gps_tracking_extended (
  movil,
  latitud,
  longitud,
  fecha_hora,
  escenario_id,
  velocidad,
  distancia_recorrida
) VALUES (
  '1006',
  -34.9050,
  -56.1650,
  NOW(),
  1000,
  52,
  89.3
);

-- ⏳ ESPERA 2 SEGUNDOS
-- ✅ Aparece marcador en el mapa


-- PASO 6: Verificar que los móviles nuevos están en la base de datos
-- ===================================================================
SELECT 
  movil,
  matricula,
  empresa_fletera_id,
  estado
FROM moviles 
WHERE escenario_id = 1000 
  AND movil IN (1005, 1006)
ORDER BY movil;

-- Resultado esperado:
-- movil | matricula | empresa_fletera_id | estado
-- ------|-----------|-------------------|--------
-- 1005  | GHI 3456  | 1                 | 1
-- 1006  | JKL 7890  | 2                 | 1


-- PASO 7: Verificar posiciones GPS de los móviles nuevos
-- =======================================================
SELECT 
  movil,
  latitud,
  longitud,
  fecha_hora,
  velocidad
FROM gps_tracking_extended 
WHERE escenario_id = 1000 
  AND movil IN ('1005', '1006')
ORDER BY movil, fecha_hora DESC;


-- ===================================================================
-- CLEANUP (Opcional): Eliminar móviles de prueba
-- ===================================================================
-- Ejecuta esto si quieres limpiar los datos de prueba:

-- DELETE FROM gps_tracking_extended WHERE movil IN ('1005', '1006') AND escenario_id = 1000;
-- DELETE FROM moviles WHERE movil IN (1005, 1006) AND escenario_id = 1000;


-- ===================================================================
-- RESUMEN DE COMPORTAMIENTO ESPERADO
-- ===================================================================
--
-- 1. INSERT en tabla `moviles`:
--    → WebSocket detecta el evento
--    → RealtimeProvider recibe el nuevo móvil
--    → page.tsx agrega el móvil a la lista automáticamente
--    → Aparece en la lista lateral sin refresh
--
-- 2. INSERT en tabla `gps_tracking_extended`:
--    → WebSocket detecta el evento
--    → RealtimeProvider actualiza latestPosition
--    → page.tsx actualiza el móvil con la nueva posición
--    → Aparece marcador en el mapa automáticamente
--
-- 3. TODO SIN POLLING, TODO EN TIEMPO REAL (<100ms latency)
--
-- ===================================================================
-- NOTAS TÉCNICAS
-- ===================================================================
--
-- - El móvil field es INTEGER en tabla `moviles`
-- - El móvil field es VARCHAR en tabla `gps_tracking_extended`
-- - La conversión se hace automáticamente en el código
-- - El color del móvil se genera con un algoritmo HSL basado en el ID
-- - Formula: hsl((movilId * 137.508) % 360, 70%, 50%)
--
-- ===================================================================

-- ✅ ¡LISTO! Ahora tienes la capacidad de agregar móviles nuevos en tiempo real
