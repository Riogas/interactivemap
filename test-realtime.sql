-- =====================================================
-- TEST REALTIME: Insertar posiciones GPS en tiempo real
-- =====================================================
-- Ejecuta este script LÍNEA POR LÍNEA para simular movimiento
-- Cada INSERT debería aparecer INSTANTÁNEAMENTE en tu mapa
-- =====================================================

-- Verificar móviles disponibles
SELECT movil, matricula 
FROM moviles 
WHERE escenario_id = 1000 
AND mostrar_en_mapa = true
LIMIT 10;

-- =====================================================
-- TEST 1: Mover SBQ 3254 (o cualquier móvil que tengas)
-- =====================================================
-- IMPORTANTE: Cambia '58' por el número de móvil que veas en tu mapa

-- Movimiento 1: Plaza Independencia
INSERT INTO gps_tracking_extended (
  movil, escenario_id, latitud, longitud, 
  fecha_hora, velocidad, bearing, accuracy, battery_level
) VALUES (
  '58', 1000, -34.9058, -56.2012, 
  NOW(), 35.0, 90, 10, 85
);

-- Espera 5 segundos y ejecuta el siguiente...

-- Movimiento 2: Avanza hacia el este
INSERT INTO gps_tracking_extended (
  movil, escenario_id, latitud, longitud, 
  fecha_hora, velocidad, bearing, accuracy, battery_level
) VALUES (
  '58', 1000, -34.9061, -56.2003, 
  NOW(), 40.0, 95, 8, 84
);

-- Espera 5 segundos y ejecuta el siguiente...

-- Movimiento 3: Continúa hacia el este
INSERT INTO gps_tracking_extended (
  movil, escenario_id, latitud, longitud, 
  fecha_hora, velocidad, bearing, accuracy, battery_level
) VALUES (
  '58', 1000, -34.9065, -56.1995, 
  NOW(), 42.5, 92, 12, 83
);

-- =====================================================
-- TEST 2: Probar con múltiples móviles simultáneos
-- =====================================================

-- Móvil 7555 - Pocitos
INSERT INTO gps_tracking_extended (
  movil, escenario_id, latitud, longitud, 
  fecha_hora, velocidad, bearing, accuracy, battery_level
) VALUES (
  '7555', 1000, -34.9088, -56.1538, 
  NOW(), 50.0, 180, 15, 92
);

-- Móvil 58 - Plaza Independencia (movimiento 4)
INSERT INTO gps_tracking_extended (
  movil, escenario_id, latitud, longitud, 
  fecha_hora, velocidad, bearing, accuracy, battery_level
) VALUES (
  '58', 1000, -34.9068, -56.1987, 
  NOW(), 45.0, 88, 9, 82
);

-- =====================================================
-- TEST 3: Movimiento rápido (simular actualización frecuente)
-- =====================================================

-- Ejecuta estos 5 INSERT uno tras otro rápidamente
INSERT INTO gps_tracking_extended (movil, escenario_id, latitud, longitud, fecha_hora, velocidad, bearing, accuracy, battery_level) 
VALUES ('58', 1000, -34.9070, -56.1980, NOW(), 50.0, 85, 8, 81);

INSERT INTO gps_tracking_extended (movil, escenario_id, latitud, longitud, fecha_hora, velocidad, bearing, accuracy, battery_level) 
VALUES ('58', 1000, -34.9072, -56.1973, NOW(), 52.0, 83, 7, 80);

INSERT INTO gps_tracking_extended (movil, escenario_id, latitud, longitud, fecha_hora, velocidad, bearing, accuracy, battery_level) 
VALUES ('58', 1000, -34.9074, -56.1966, NOW(), 54.0, 81, 9, 79);

INSERT INTO gps_tracking_extended (movil, escenario_id, latitud, longitud, fecha_hora, velocidad, bearing, accuracy, battery_level) 
VALUES ('58', 1000, -34.9076, -56.1959, NOW(), 56.0, 80, 10, 78);

INSERT INTO gps_tracking_extended (movil, escenario_id, latitud, longitud, fecha_hora, velocidad, bearing, accuracy, battery_level) 
VALUES ('58', 1000, -34.9078, -56.1952, NOW(), 58.0, 78, 11, 77);

-- =====================================================
-- VERIFICACIÓN
-- =====================================================

-- Ver últimas 10 posiciones insertadas
SELECT 
  movil,
  latitud,
  longitud,
  fecha_hora,
  velocidad
FROM gps_tracking_extended
WHERE escenario_id = 1000
ORDER BY fecha_hora DESC
LIMIT 10;

-- =====================================================
-- ¿QUÉ DEBERÍAS VER EN TU APP?
-- =====================================================
-- 1. Indicador "Tiempo Real Activo" en verde (esquina superior derecha)
-- 2. El punto del móvil se MUEVE AUTOMÁTICAMENTE en el mapa
-- 3. En la consola del navegador: "🔔 Actualización Realtime para móvil X"
-- 4. La lista de móviles muestra la última posición
-- =====================================================
