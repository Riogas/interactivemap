-- ===================================================================
-- PRUEBA: MÓVIL EXISTENTE QUE EMPIEZA A ENVIAR GPS
-- ===================================================================
-- 
-- Este script simula el caso de un móvil que YA EXISTE en la base de 
-- datos pero nunca había enviado GPS (o no estaba en la carga inicial).
-- Cuando envía su primer GPS, debe aparecer automáticamente en el mapa.
--
-- INSTRUCCIONES:
-- 1. Abre la aplicación en http://localhost:3000
-- 2. Abre Supabase SQL Editor en otra pestaña
-- 3. Ejecuta este script PASO A PASO
-- 4. Observa la aplicación después de cada paso
-- ===================================================================


-- PASO 0: Ver móviles actuales en la aplicación
-- ==============================================
-- Antes de empezar, verifica qué móviles se muestran en la lista lateral


-- PASO 1: Insertar un móvil SIN GPS (aún no aparecerá en el mapa)
-- ================================================================
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
  777,                     -- Móvil que vemos en la imagen
  1000,                    -- escenario_id
  1,                       -- MONDELLI SRL
  1,                       -- Estado activo
  'QUIETO',                -- Matrícula como aparece en la tabla
  true,                    -- Mostrar en mapa
  NOW(),
  NOW()
)
ON CONFLICT (movil, escenario_id, empresa_fletera_id) 
DO UPDATE SET
  matricula = EXCLUDED.matricula,
  estado = EXCLUDED.estado,
  mostrar_en_mapa = EXCLUDED.mostrar_en_mapa,
  updated_at = NOW();

-- ⚠️ NOTA: Este móvil AÚN NO APARECE en la lista porque:
-- 1. No disparó evento INSERT (puede que ya existiera)
-- 2. No tiene GPS todavía
-- 3. La carga inicial puede no haberlo incluido


-- PASO 2: Verificar que el móvil existe en la base de datos
-- ==========================================================
SELECT 
  movil,
  matricula,
  empresa_fletera_id,
  estado,
  mostrar_en_mapa
FROM moviles 
WHERE movil = 777 
  AND escenario_id = 1000;

-- Resultado esperado:
-- movil | matricula | empresa_fletera_id | estado | mostrar_en_mapa
-- ------|-----------|-------------------|--------|----------------
-- 777   | QUIETO    | 1                 | 1      | true


-- PASO 3: Insertar GPS para el móvil 777
-- =======================================
-- 🔥 ESTE ES EL MOMENTO CRÍTICO
-- Al insertar el GPS, el móvil debe aparecer AUTOMÁTICAMENTE

INSERT INTO gps_tracking_extended (
  movil,
  latitud,
  longitud,
  fecha_hora,
  escenario_id,
  velocidad,
  distancia_recorrida
) VALUES (
  '777',                   -- Móvil (VARCHAR)
  -34.8934669,             -- Latitud (de tu captura)
  -56.1290177,             -- Longitud (de tu captura)
  NOW(),                   -- Timestamp
  1000,                    -- escenario_id
  0.00,                    -- Velocidad: 0 km/h (QUIETO)
  6196.91                  -- Distancia recorrida (de tu captura)
);

-- ⏳ ESPERA 2 SEGUNDOS y observa:
-- ✅ En la consola del navegador:
--    "🔔 Actualización Realtime para móvil 777"
--    "🔍 Móvil 777 no existe en lista, cargándolo desde API..."
--    "✅ Móvil 777 cargado y agregado a la lista"
--
-- ✅ En la lista lateral:
--    Aparece "Móvil-777 | QUIETO"
--
-- ✅ En el mapa:
--    Aparece un marcador 🚗 en la posición (-34.8934669, -56.1290177)


-- PASO 4: Insertar otro GPS para el móvil 777 (actualización)
-- ============================================================
-- Ahora el móvil YA ESTÁ en la lista, entonces solo se moverá

INSERT INTO gps_tracking_extended (
  movil,
  latitud,
  longitud,
  fecha_hora,
  escenario_id,
  velocidad,
  distancia_recorrida
) VALUES (
  '777',
  -34.8934668,             -- Pequeño cambio en latitud
  -56.1290176,             -- Pequeño cambio en longitud
  NOW(),
  1000,
  0.03,                    -- Velocidad baja
  6196.81                  -- Distancia actualizada
);

-- ⏳ ESPERA 2 SEGUNDOS
-- ✅ El marcador se mueve ligeramente
-- ✅ En la consola: "🔔 Actualización Realtime para móvil 777"
-- ✅ NO aparece mensaje de "cargándolo desde API" (ya existe)


-- PASO 5: Probar con otro móvil existente sin GPS
-- ================================================
-- Simular móvil 72 (también aparece en tu captura)

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
  72,
  1000,
  1,                       -- MONDELLI SRL
  1,
  'fused-weighted',        -- De tu captura
  true,
  NOW(),
  NOW()
)
ON CONFLICT (movil, escenario_id, empresa_fletera_id) 
DO UPDATE SET
  matricula = EXCLUDED.matricula,
  estado = EXCLUDED.estado,
  mostrar_en_mapa = EXCLUDED.mostrar_en_mapa,
  updated_at = NOW();


-- PASO 6: Darle GPS al móvil 72
-- ==============================
INSERT INTO gps_tracking_extended (
  movil,
  latitud,
  longitud,
  fecha_hora,
  escenario_id,
  velocidad,
  distancia_recorrida
) VALUES (
  '72',
  -34.8434643,             -- De tu captura
  -55.9970116,             -- De tu captura
  '2025-11-21 09:04:16',   -- Timestamp de tu captura
  1000,
  0.25,
  865.92
);

-- ⏳ ESPERA 2 SEGUNDOS
-- ✅ Aparece "Móvil-72 | fused-weighted" en la lista
-- ✅ Aparece marcador en el mapa


-- PASO 7: Verificar móviles con GPS en las últimas 24 horas
-- ==========================================================
SELECT 
  m.movil,
  m.matricula,
  g.latitud,
  g.longitud,
  g.fecha_hora,
  g.velocidad
FROM moviles m
INNER JOIN gps_tracking_extended g 
  ON m.movil::text = g.movil
WHERE m.escenario_id = 1000
  AND g.escenario_id = 1000
  AND g.fecha_hora >= NOW() - INTERVAL '24 hours'
ORDER BY g.fecha_hora DESC
LIMIT 20;


-- ===================================================================
-- RESUMEN DEL COMPORTAMIENTO
-- ===================================================================
--
-- ANTES (Sin el fix):
-- ❌ Móvil 777 envía GPS → No aparece en lista ni mapa
-- ❌ Usuario debe refrescar página (F5) para verlo
--
-- AHORA (Con el fix):
-- ✅ Móvil 777 envía GPS → Se detecta que no está en lista
-- ✅ Sistema llama API para obtener datos del móvil
-- ✅ Móvil se agrega automáticamente a la lista
-- ✅ Marcador aparece en el mapa
-- ✅ TODO EN TIEMPO REAL sin refresh
--
-- ===================================================================
-- FLUJO TÉCNICO
-- ===================================================================
--
-- 1. INSERT en gps_tracking_extended
--    ↓
-- 2. PostgreSQL NOTIFY 'supabase_realtime'
--    ↓
-- 3. WebSocket → useGPSTracking detecta evento
--    ↓
-- 4. page.tsx useEffect recibe latestPosition
--    ↓
-- 5. Verifica si móvil existe en lista
--    ↓
-- 6. NO EXISTE → fetch('/api/all-positions?movilId=777')
--    ↓
-- 7. API devuelve datos del móvil
--    ↓
-- 8. setMoviles([...prev, newMovil])
--    ↓
-- 9. React re-renderiza lista y mapa
--    ↓
-- 10. Móvil aparece automáticamente ✅
--
-- ===================================================================
-- CLEANUP (Opcional)
-- ===================================================================
-- Si quieres eliminar los móviles de prueba:

-- DELETE FROM gps_tracking_extended WHERE movil IN ('777', '72') AND escenario_id = 1000;
-- DELETE FROM moviles WHERE movil IN (777, 72) AND escenario_id = 1000;


-- ===================================================================
-- NOTAS IMPORTANTES
-- ===================================================================
--
-- 1. Este fix cubre el caso de móviles que:
--    - Ya existen en la base de datos
--    - No estaban en la carga inicial (fetchPositions)
--    - Empiezan a enviar GPS durante la sesión del usuario
--
-- 2. El móvil se carga LAZY (solo cuando envía GPS)
--    - No sobrecarga la carga inicial
--    - Eficiente para flotas grandes con móviles ocasionales
--
-- 3. La API /all-positions ahora soporta:
--    - Sin parámetros: Todos los móviles
--    - empresaIds: Filtrar por empresas
--    - movilId: Buscar un móvil específico (NUEVO)
--
-- ===================================================================

-- ✅ ¡FIX IMPLEMENTADO! Ahora los móviles aparecen automáticamente 🚀
