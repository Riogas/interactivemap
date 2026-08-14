-- ====================================================================
-- PROMOCION: calibracion x0,75 al motor (v9 -> v10)
-- Fecha: 2026-08-14 | Decision de Diego tras el veredicto de 7 dias.
-- ====================================================================
--
-- La regla de promocion (7 dias medidos, 5 ganados al motor, margen
-- >=1,5 pts) se completo el 14/8 con la ventana 7-13 de agosto, solo
-- URGENTE, 21.530 pedidos de poblacion comun. FACTOR_075 la cumplio
-- con 7 dias ganados de 7 y +2,9 puntos ponderados:
--
--                      x0,85 (saliente)   x0,75 (entrante)
--   acierto <=25'           65,8%             68,8%
--   promesa media           47,1'             43,8'
--   llega 25'+ antes        19,6%             14,8%
--   llega 25'+ tarde        14,6%             16,4%   <- la contra
--   sesgo                   -3,5'             -0,2'   (centrada)
--
-- El intercambio explicitado a Diego y aceptado: por cada pedido que
-- pasa al lado del "tarde", casi tres dejan de recibir promesa
-- inflada. Las variantes agresivas (familia AUTO, +8' de sesgo) NO se
-- promueven: siguen en sombra hasta definir el KPI asimetrico.
--
-- Orden de este archivo (importa):
--   1. Alta de FACTOR_085, el espejo de la parametria SALIENTE, para
--      que lo viejo quede midiendose en sombra y en unos dias se pueda
--      demostrar con datos que el cambio pago (o volver con evidencia).
--      El truco de siempre: las perillas NULL heredan del modelo
--      CAPTURADO de cada corrida (meta.modelo), asi que el factor va
--      EXPLICITO; el resto hereda.
--   2. El UPDATE de la parametria viva + bump de version (9 -> 10).
--      El motor lee demoras_modelo en cada corrida: efecto en la
--      siguiente (<=10 min).
--
-- Consecuencias automaticas (nada mas que tocar):
--   * CAMPEON (todo NULL) re-espeja al motor nuevo solo.
--   * FACTOR_075 pasa a ser identica al campeon (queda como control
--     redundante, se puede desactivar mas adelante).
--   * El contador de la regla de promocion arranca de cero contra el
--     campeon nuevo (demoras_variantes_resultados compara cada dia
--     contra lo que el motor publico ESE dia).
--   * El optimizador nocturno parte del campeon nuevo ('{}' = modelo
--     capturado de cada dia de entrenamiento).
--
-- ROLLBACK: UPDATE demoras_modelo SET factor_calibracion = 0.85,
-- version = version + 1; -- efecto en <=10 minutos. FACTOR_085 en
-- sombra da la evidencia para decidirlo.
-- ====================================================================

-- --- 1. La parametria saliente queda en sombra -----------------------
INSERT INTO demoras_variantes (id, codigo, nombre, descripcion, factor, suavizado, activa)
VALUES
  (24, 'FACTOR_085', 'Calibración ×0,85 (la saliente)',
   'La parametría que el motor publicó del 1 al 14 de agosto, congelada en sombra el día de la promoción de la ×0,75 (14/8, v10). Sirve de contraprueba: si en unos días le gana al campeón nuevo, la promoción no pagó y hay evidencia para volver.',
   0.85, true, true)
ON CONFLICT (id) DO NOTHING;

-- --- 2. La promocion -------------------------------------------------
UPDATE demoras_modelo
   SET factor_calibracion = 0.75,
       version = 10
 WHERE escenario_id = 1000
   AND factor_calibracion = 0.85;  -- guarda: no re-pisa un rollback posterior
