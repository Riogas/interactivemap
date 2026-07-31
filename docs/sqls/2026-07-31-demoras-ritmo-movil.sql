-- =====================================================================
-- demoras_ritmo_movil — el ritmo PROPIO de cada movil
-- Fecha: 2026-07-31 | Idempotente
--
-- demoras_ritmo devuelve un ritmo por (zona, tipo): sus niveles CHOFER y
-- MOVIL vienen ya mezclados en un promedio ponderado por el aporte de cada
-- movil a la zona. Eso alcanza para el modelo viejo, que multiplica un solo
-- ritmo por la cola de la zona.
--
-- El modelo del proximo hueco necesita otra cosa: cuanto tarda CADA movil,
-- porque libre_en = carga x ritmo y el pedido nuevo va al que se libera
-- primero. Con un ritmo compartido, dos moviles solo se diferencian por
-- cuantos pedidos llevan -- y se pierde justo lo que hace al modelo.
--
-- Cascada de dos niveles, en el orden configurado en
-- demoras_config.ritmo_cascada -- POR TIPO, la MISMA columna y la MISMA
-- fuente que usa demoras_ritmo (docs/sqls/2026-07-31-demoras-ritmo-v2.sql).
-- Un UPDATE sobre demoras_config.ritmo_cascada cambia el reparto de los
-- dos lugares a la vez: es lo que hace que "saltear CHOFER"
-- (DEMORA_INFORMADA.md #5) tenga el mismo efecto sobre el ritmo de zona y
-- sobre el ritmo propio del movil. demoras_modelo.ritmo_cascada NO
-- alimenta esta cascada (ver su COMMENT ON COLUMN: no se lee en ningun
-- lado). Se leen solo las entradas CHOFER y MOVIL de la lista (ZONA y
-- GLOBAL no aplican a un movil suelto y las resuelve el llamador cayendo
-- a demoras_ritmo):
--
--   CHOFER  el historial propio del chofer que mas veces manejo ese movil
--           en la ventana. Un chofer rapido lo es en cualquier camion.
--   MOVIL   el historial del movil en si.
--
-- Un movil sin muestras suficientes en ningun nivel NO devuelve fila: el
-- llamador (demoras_servidores) cae al ritmo de la zona, y si tampoco hay,
-- al piso configurado. Devolver una fila con las cuatro estadisticas en
-- NULL obligaria a cada consumidor a distinguir "no hay dato" de "hay dato
-- nulo", que es exactamente el tipo de ambiguedad que ya rompio este motor.
-- =====================================================================
CREATE OR REPLACE FUNCTION demoras_ritmo_movil(p_escenario integer, p_hasta date)
RETURNS TABLE (
  movil          integer,
  tipo_servicio  text,
  ritmo_media    numeric,
  ritmo_mediana  numeric,
  ritmo_p75      numeric,
  ritmo_p90      numeric,
  ritmo_origen   text,
  ritmo_muestras integer
)
LANGUAGE sql
STABLE
AS $fn$
  WITH cfg AS (
    -- Subconsulta escalar y no FROM: si falta la fila del escenario, un FROM
    -- deja este CTE vacio y los CROSS JOIN de abajo colapsan la funcion a
    -- cero filas. Mismo patron defensivo que demoras_cola y demoras_ritmo v2.
    SELECT coalesce((SELECT dm.ritmo_dias_ventana      FROM demoras_modelo dm WHERE dm.escenario_id = p_escenario), 7)                AS dias,
           coalesce((SELECT dm.ritmo_min_muestras      FROM demoras_modelo dm WHERE dm.escenario_id = p_escenario), 5)                AS min_muestras,
           coalesce((SELECT dm.ritmo_metrica           FROM demoras_modelo dm WHERE dm.escenario_id = p_escenario), 'ENTRE_ENTREGAS') AS metrica,
           coalesce((SELECT dm.ritmo_hueco_max_minutos FROM demoras_modelo dm WHERE dm.escenario_id = p_escenario), 90)               AS hueco_max,
           coalesce((SELECT dm.ritmo_solo_con_cola     FROM demoras_modelo dm WHERE dm.escenario_id = p_escenario), false)            AS solo_con_cola
  ),
  base AS (
    SELECT m.tipo, m.movil, m.chofer, m.v
    FROM cfg c,
         LATERAL demoras_ritmo_muestras(
           p_escenario, p_hasta, c.dias, c.metrica, c.hueco_max, c.solo_con_cola
         ) m
    WHERE m.movil IS NOT NULL
  ),
  -- Estadisticas propias del movil.
  por_movil AS (
    SELECT b.movil, b.tipo,
           round(avg(b.v), 2) AS media,
           round(percentile_cont(0.5)  WITHIN GROUP (ORDER BY b.v)::numeric, 2) AS mediana,
           round(percentile_cont(0.75) WITHIN GROUP (ORDER BY b.v)::numeric, 2) AS p75,
           round(percentile_cont(0.9)  WITHIN GROUP (ORDER BY b.v)::numeric, 2) AS p90,
           count(*)::integer AS n
    FROM base b
    GROUP BY b.movil, b.tipo
  ),
  -- El chofer que mas veces manejo cada movil en la ventana. Empate:
  -- alfabetico, para que el resultado sea reproducible.
  chofer_top AS (
    SELECT DISTINCT ON (movil, tipo) movil, tipo, chofer
    FROM (
      SELECT b.movil, b.tipo, b.chofer, count(*) AS n
      FROM base b WHERE b.chofer IS NOT NULL
      GROUP BY b.movil, b.tipo, b.chofer
    ) c
    ORDER BY movil, tipo, n DESC, chofer
  ),
  -- Estadisticas propias del chofer, sin importar que movil manejo.
  por_chofer AS (
    SELECT b.chofer, b.tipo,
           round(avg(b.v), 2) AS media,
           round(percentile_cont(0.5)  WITHIN GROUP (ORDER BY b.v)::numeric, 2) AS mediana,
           round(percentile_cont(0.75) WITHIN GROUP (ORDER BY b.v)::numeric, 2) AS p75,
           round(percentile_cont(0.9)  WITHIN GROUP (ORDER BY b.v)::numeric, 2) AS p90,
           count(*)::integer AS n
    FROM base b WHERE b.chofer IS NOT NULL
    GROUP BY b.chofer, b.tipo
  ),
  -- Cascada por TIPO, leida de demoras_config.ritmo_cascada -- la MISMA
  -- fuente que demoras_ritmo (ver el header de este archivo). Se filtra a
  -- CHOFER/MOVIL (los unicos niveles que aplican a un movil suelto); si
  -- para ese tipo no queda ninguno valido (falta la fila, lista vacia o
  -- basura), cae al default CHOFER,MOVIL.
  cascada_cruda AS (
    SELECT dc.tipo_servicio AS tipo, trim(u.lvl) AS lvl, u.ord
    FROM demoras_config dc,
         LATERAL unnest(string_to_array(upper(coalesce(dc.ritmo_cascada,'')), ',')) WITH ORDINALITY AS u(lvl, ord)
    WHERE dc.escenario_id = p_escenario
  ),
  niveles AS (
    SELECT t.tipo,
           coalesce(
             nullif(array_agg(cc.lvl ORDER BY cc.ord) FILTER (WHERE cc.lvl IN ('CHOFER','MOVIL')), '{}'),
             ARRAY['CHOFER','MOVIL']) AS lista
    FROM (SELECT unnest(ARRAY['URGENTE','NOCTURNO','SERVICE']) AS tipo) t
    LEFT JOIN cascada_cruda cc ON cc.tipo = t.tipo
    GROUP BY t.tipo
  ),
  candidatos AS (
    SELECT pm.movil, pm.tipo, lv.ord, lv.nivel,
           CASE lv.nivel WHEN 'CHOFER' THEN pc.media   ELSE pm.media   END AS media,
           CASE lv.nivel WHEN 'CHOFER' THEN pc.mediana ELSE pm.mediana END AS mediana,
           CASE lv.nivel WHEN 'CHOFER' THEN pc.p75     ELSE pm.p75     END AS p75,
           CASE lv.nivel WHEN 'CHOFER' THEN pc.p90     ELSE pm.p90     END AS p90,
           coalesce(CASE lv.nivel WHEN 'CHOFER' THEN pc.n ELSE pm.n END, 0) AS n
    FROM por_movil pm
    JOIN niveles nv ON nv.tipo = pm.tipo
    CROSS JOIN LATERAL unnest(nv.lista) WITH ORDINALITY AS lv(nivel, ord)
    LEFT JOIN chofer_top ct ON ct.movil = pm.movil AND ct.tipo = pm.tipo
    LEFT JOIN por_chofer pc ON pc.chofer = ct.chofer AND pc.tipo = pm.tipo
  )
  -- Gana el primer nivel que llegue al minimo. Si NINGUNO llega, el movil no
  -- devuelve fila y el llamador cae al ritmo de la zona.
  SELECT DISTINCT ON (movil, tipo)
         movil, tipo, media, mediana, p75, p90, nivel, n
  FROM candidatos c, cfg
  WHERE c.n >= cfg.min_muestras
  ORDER BY movil, tipo, ord;
$fn$;

COMMENT ON FUNCTION demoras_ritmo_movil(integer, date) IS
  'Ritmo propio de cada movil por tipo de servicio, con cascada CHOFER -> MOVIL en el orden configurado en demoras_config.ritmo_cascada (por tipo -- la misma columna y fuente que demoras_ritmo; demoras_modelo.ritmo_cascada no alimenta nada, ver su COMMENT ON COLUMN). Existe porque demoras_ritmo devuelve un ritmo por ZONA (los niveles CHOFER y MOVIL ya vienen mezclados en un promedio ponderado), y el modelo del proximo hueco necesita cuanto tarda CADA movil: libre_en = carga x ritmo, y el pedido nuevo va al que se libera primero. Un movil sin muestras suficientes en ningun nivel NO devuelve fila, para que el llamador pueda distinguir "no hay dato" de "hay dato nulo" y caer al ritmo de la zona.';

-- ─── Grants: solo service_role ───────────────────────────────────────
-- Postgres otorga EXECUTE a PUBLIC en cada CREATE FUNCTION por defecto
-- (a diferencia de las tablas): sin este REVOKE, anon/authenticated -las
-- claves que viajan al browser- pueden invocar esta funcion via RPC.
-- Mismo patron que las tablas de docs/sqls/2026-07-31-demoras-modelo-tabla.sql
-- y que docs/sqls/2026-07-24-metricas-dashboard-rpc.sql.
REVOKE EXECUTE ON FUNCTION demoras_ritmo_movil(integer, date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION demoras_ritmo_movil(integer, date) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION demoras_ritmo_movil(integer, date) TO service_role;
