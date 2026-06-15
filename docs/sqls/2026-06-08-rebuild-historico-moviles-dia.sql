-- ============================================================
-- Migración: rebuild de moviles_dia para fechas históricas
-- Fecha: 2026-06-08
-- Aplicar manualmente en Supabase SQL Editor si NEXT_PUBLIC_USE_MOVILES_DIA=true
-- ============================================================
--
-- CONTEXTO:
--   La pantalla histórica del dashboard depende de que existan filas en
--   moviles_dia para la fecha consultada.
--
--   fn_moviles_dia_rebuild(p_desde, p_hasta, p_escenario) — CASO B (fecha pasada):
--     · Inserta un registro por cada móvil que ese día tuvo pedido, service o GPS.
--     · activo = false, oculto_operativo = false, inactivo_del_dia = true (siempre).
--     · Idempotente: se puede correr varias veces sin riesgo de duplicados.
--
--   Si no se corrió el rebuild para una fecha histórica, el dashboard bajo
--   USE_NEW no mostrará ningún móvil para esa fecha.
--
-- INSTRUCCIONES:
--   1. Ajustar p_desde y p_hasta al rango de fechas que se quiere reconstruir.
--   2. Ajustar p_escenario al escenario de producción (ej: 1000).
--   3. Ejecutar en el SQL Editor de Supabase.
--   4. El rebuild puede tardar varios minutos para rangos de semanas.
--
-- NOTA: el rebuild solo toca moviles_dia, no pedidos ni services.
--       Es seguro de correr en producción con el dashboard activo.
-- ============================================================

-- Ejemplo: reconstruir los últimos 30 días para el escenario 1000
SELECT fn_moviles_dia_rebuild(
  (current_date - interval '30 days')::date,   -- p_desde
  (current_date - interval '1 day')::date,     -- p_hasta (ayer; hoy lo maneja CASO A)
  1000                                          -- p_escenario (ajustar al escenario real)
);

-- Para verificar que el rebuild generó filas (debe ser > 0):
SELECT fecha, COUNT(*) AS moviles
FROM moviles_dia
WHERE fecha BETWEEN (current_date - interval '30 days')::date
                AND (current_date - interval '1 day')::date
  AND escenario_id = 1000
GROUP BY fecha
ORDER BY fecha DESC
LIMIT 10;

-- ============================================================
-- Si se quiere reconstruir un rango más largo (máx 180 días por llamada):
-- ============================================================
-- SELECT fn_moviles_dia_rebuild('2026-01-01'::date, '2026-05-31'::date, 1000);
-- SELECT fn_moviles_dia_rebuild('2026-04-01'::date, '2026-06-07'::date, 1000);
