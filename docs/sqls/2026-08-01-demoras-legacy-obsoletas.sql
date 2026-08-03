-- =====================================================================
-- demoras_servidores / demoras_proximo_hueco -- marcadas OBSOLETAS
-- Fecha: 2026-08-01 | Idempotente | Aplicar en: Supabase SQL Editor.
--
-- Task 7 (tanda CONSUMO_TRAMOS), triage de pendientes. Las dos funciones
-- del modelo PROXIMO_HUECO quedaron SIN NINGUN CONSUMIDOR desde que
-- 2026-08-01-demoras-calcular-run-v3.sql dejo de llamarlas (usa
-- demoras_aportes + demoras_consumo_tramos en su lugar). Verificado con
-- grep sobre docs/sqls/*.sql, app/ y lib/: ningun archivo del repo las
-- invoca (T4 y T6 ya lo habian confirmado por separado).
--
-- NO SE DROPEAN. Es una decision deliberada, no un olvido:
--   1. DROP FUNCTION es un cambio de mayor alcance que un comentario --
--      alguien podria estar llamandolas desde AFUERA del repo (un script
--      ad-hoc en produccion, una consulta manual desde el SQL Editor).
--      Dropearlas sin ese chequeo es una decision para una task de
--      limpieza explicita, no un efecto colateral de esta.
--   2. Hay un riesgo real y especifico que ESTE comentario sí cierra:
--      demoras_proximo_hueco lee demoras_cola.cola_efectiva asumiendo el
--      significado VIEJO ("los asignados NO cuentan, ya estan en
--      libre_en" -- comentario textual en su propio header). Desde
--      2026-08-01-demoras-cola-v2.sql (Task 3 de esta tanda),
--      cola_efectiva SI incluye los asignados en zona. Si alguien invoca
--      demoras_proximo_hueco a mano hoy (fuera del orquestador, que ya no
--      la llama), el numero que devuelve DOBLE-CUENTA esos pedidos: una
--      vez via cola_efectiva, otra via demoras_servidores.libre_en. No es
--      un bug que se vaya a notar solo: es un numero que se ve razonable
--      y esta mal.
--
-- Por eso el tratamiento es "documentar como obsoletas", no "dejar
-- silenciosas": el COMMENT ON FUNCTION es lo primero que ve cualquiera
-- que las inspeccione (\df+, pg_get_functiondef, el panel de Supabase).
-- =====================================================================
COMMENT ON FUNCTION demoras_servidores(integer, date) IS
  'OBSOLETA desde 2026-08-01: sin consumidor. demoras_calcular_run (v3) ya no la llama -- usa demoras_aportes en su lugar (docs/sqls/2026-08-01-demoras-aportes.sql), que separa r_j (cuando entra) de mu_j (cuanto aporta) en vez de un unico libre_en. No se dropea: puede haber invocaciones manuales/externas al repo; ver docs/sqls/2026-08-01-demoras-legacy-obsoletas.sql para el detalle.';

COMMENT ON FUNCTION demoras_proximo_hueco(integer, date, timestamptz) IS
  'OBSOLETA desde 2026-08-01: sin consumidor. demoras_calcular_run (v3) ya no la llama -- usa demoras_consumo_tramos en su lugar (docs/sqls/2026-08-01-demoras-consumo-tramos.sql). ADEMAS DE OBSOLETA, ESTA FUNCION QUEDO SEMANTICAMENTE ROTA: lee demoras_cola.cola_efectiva asumiendo que los pedidos asignados NO cuentan ("ya estan en libre_en", su propio comentario original) -- pero desde 2026-08-01-demoras-cola-v2.sql cola_efectiva SI los incluye, para que sean demanda de la zona y no del movil. Invocarla manualmente hoy DOBLE-CUENTA esos pedidos (via cola_efectiva y via demoras_servidores.libre_en). No usar para nada nuevo. Ver docs/sqls/2026-08-01-demoras-legacy-obsoletas.sql para el detalle.';
