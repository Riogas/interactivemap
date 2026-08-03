-- =====================================================================
-- demoras_ritmo + demoras_ritmo_movil — pasan el piso a demoras_ritmo_muestras
-- Fecha: 2026-08-01 | Idempotente
--
-- Fix round 1 sobre la Task 2 (piso del ritmo). El cambio de firma de
-- docs/sqls/2026-08-01-demoras-ritmo-muestras-v2.sql agrega p_hueco_min en
-- la sexta posicion y DROPEA la version de 6 argumentos. Estos dos
-- llamadores (los UNICOS del repo fuera de esta tanda, ver
-- docs/sqls/2026-07-31-demoras-ritmo-v2.sql y
-- docs/sqls/2026-07-31-demoras-ritmo-movil.sql) siguen invocandola con 6
-- argumentos -- rotos en runtime apenas se ejecuten de verdad.
--
-- Hoy eso no explota: con motor_activo=false (la precondicion de toda esta
-- tanda) el universo de zonas activas de demoras_calcular_run queda vacio y
-- el LEFT JOIN nunca llega a evaluar el lado que dispara la llamada
-- (verificado con Docker + EXPLAIN + un marcador de efecto de lado durante
-- el reporte de la Task 2). Pero NINGUNA task del plan actualiza estos dos
-- archivos -- la arquitectura los declara "sin cambios de fondo" para las
-- siete tasks completas -- asi que si el motor se prende al final de la
-- tanda sin este fix, el cron vuelve a fallar cada 10 minutos, esta vez
-- PARA SIEMPRE. Un cambio de firma no esta terminado hasta que sus
-- llamadores compilan; eso es lo que hace este archivo.
--
-- Dos cambios, IDENTICOS en las dos funciones: leer
-- demoras_modelo.ritmo_hueco_min_minutos (Task 1, default 5) en la CTE
-- `cfg` con el mismo patron defensivo que ya usa cada archivo para el resto
-- de los parametros, y pasarlo en la sexta posicion de la llamada a
-- demoras_ritmo_muestras. Ninguna de las dos cambia de firma propia
-- (siguen siendo (integer, date)): es un cambio de CUERPO, CREATE OR
-- REPLACE alcanza, no hace falta DROP FUNCTION.
--
-- El resto de cada funcion -- el blend ponderado, el colapso de muestras
-- por chofer compartido, el filtro de peso real (alpha=0), el orden
-- configurable de la cascada, todo con sus comentarios de fixes anteriores
-- -- se copia TEXTUAL de los archivos de origen. No se reescribe de
-- memoria.
-- =====================================================================

-- ─── demoras_ritmo — copiado de docs/sqls/2026-07-31-demoras-ritmo-v2.sql ──
CREATE OR REPLACE FUNCTION demoras_ritmo(p_escenario integer, p_hasta date)
RETURNS TABLE (
  zona_id        integer,
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
    -- Defaults defensivos: si falta la fila del escenario, la funcion tiene
    -- que seguir devolviendo algo razonable en vez de colapsar a cero filas.
    SELECT coalesce(dm.ritmo_dias_ventana, 7)          AS dias,
           coalesce(dm.ritmo_min_muestras, 5)          AS min_muestras,
           coalesce(dm.ritmo_metrica, 'ENTRE_ENTREGAS') AS metrica,
           coalesce(dm.ritmo_hueco_max_minutos, 90)    AS hueco_max,
           coalesce(dm.ritmo_hueco_min_minutos, 5)     AS hueco_min,
           coalesce(dm.ritmo_solo_con_cola, false)     AS solo_con_cola
      FROM (SELECT p_escenario AS e) x
      LEFT JOIN demoras_modelo dm ON dm.escenario_id = x.e
  ),
  universo AS (
    SELECT DISTINCT mz.zona_id, mz.tipo_de_servicio AS tipo
    FROM moviles_zonas mz
    WHERE mz.escenario_id = p_escenario
      AND coalesce(mz.activa, true)
      AND mz.tipo_de_servicio IN ('URGENTE','NOCTURNO','SERVICE')
  ),
  base AS (
    SELECT m.zona_nro, m.tipo, m.movil, m.chofer, m.v
    FROM cfg c,
         LATERAL demoras_ritmo_muestras(
           p_escenario, p_hasta, c.dias, c.metrica, c.hueco_max, c.hueco_min, c.solo_con_cola
         ) m
  ),
  -- ↓↓↓ COPIADO TEXTUAL desde `por_zona AS (` hasta el cierre de
  --     `elegido AS (...)` de docs/sqls/2026-07-30-demoras-ritmo-cascada.sql
  --     (lineas 121-363). Unico cambio: en `elegido`, las dos apariciones
  --     de `p_min_muestras` en el ORDER BY pasan a
  --     `(SELECT min_muestras FROM cfg)`. El resto, comentarios incluidos,
  --     es identico al original.
  por_zona AS (
    SELECT zona_nro AS zona_id, tipo,
           round(avg(v),2) AS media,
           round(percentile_cont(0.5)  WITHIN GROUP (ORDER BY v)::numeric, 2) AS mediana,
           round(percentile_cont(0.75) WITHIN GROUP (ORDER BY v)::numeric, 2) AS p75,
           round(percentile_cont(0.9)  WITHIN GROUP (ORDER BY v)::numeric, 2) AS p90,
           count(*)::integer AS n
    FROM base GROUP BY zona_nro, tipo
  ),
  global AS (
    SELECT tipo,
           round(avg(v),2) AS media,
           round(percentile_cont(0.5)  WITHIN GROUP (ORDER BY v)::numeric, 2) AS mediana,
           round(percentile_cont(0.75) WITHIN GROUP (ORDER BY v)::numeric, 2) AS p75,
           round(percentile_cont(0.9)  WITHIN GROUP (ORDER BY v)::numeric, 2) AS p90,
           count(*)::integer AS n
    FROM base GROUP BY tipo
  ),
  por_movil AS (
    -- Ritmo propio de un movil: estadisticas de demora_efectiva_mins de
    -- los pedidos que llevo, sin importar la zona.
    SELECT movil, tipo,
           round(avg(v),2) AS media,
           round(percentile_cont(0.5)  WITHIN GROUP (ORDER BY v)::numeric, 2) AS mediana,
           round(percentile_cont(0.75) WITHIN GROUP (ORDER BY v)::numeric, 2) AS p75,
           round(percentile_cont(0.9)  WITHIN GROUP (ORDER BY v)::numeric, 2) AS p90,
           count(*)::integer AS n
    FROM base
    WHERE movil IS NOT NULL
    GROUP BY movil, tipo
  ),
  chofer_top_por_movil AS (
    -- El chofer que mas veces manejo cada movil en la ventana. Empate:
    -- orden alfabetico, determinista.
    SELECT DISTINCT ON (movil) movil, chofer
    FROM (
      SELECT movil, chofer, count(*) AS n
      FROM base
      WHERE movil IS NOT NULL AND chofer IS NOT NULL
      GROUP BY movil, chofer
    ) c
    ORDER BY movil, n DESC, chofer
  ),
  por_chofer AS (
    -- Ritmo propio de un chofer: no depende de la zona ni del movil que
    -- este manejando en el momento de la consulta.
    SELECT chofer, tipo,
           round(avg(v),2) AS media,
           round(percentile_cont(0.5)  WITHIN GROUP (ORDER BY v)::numeric, 2) AS mediana,
           round(percentile_cont(0.75) WITHIN GROUP (ORDER BY v)::numeric, 2) AS p75,
           round(percentile_cont(0.9)  WITHIN GROUP (ORDER BY v)::numeric, 2) AS p90,
           count(*)::integer AS n
    FROM base
    WHERE chofer IS NOT NULL
    GROUP BY chofer, tipo
  ),
  -- ─── Aporte de cada movil a cada (zona, tipo) ────────────────────────
  -- Replica el prorrateo de demoras_capacidad (peso 1 prioridad / alpha
  -- transito, normalizado por movil dentro de cada tipo).
  alpha AS (
    SELECT coalesce((SELECT es.peso_transito_alpha FROM escenario_settings es
                      WHERE es.escenario_id = p_escenario), 0.3) AS a
  ),
  asign AS (
    SELECT mz.movil_id::integer AS movil,
           mz.zona_id,
           mz.tipo_de_servicio  AS tipo,
           CASE WHEN mz.prioridad_o_transito = 1 THEN 1::numeric ELSE (SELECT a FROM alpha) END AS peso
    FROM moviles_zonas mz
    JOIN moviles_dia md
      ON md.movil_id     = mz.movil_id::integer
     AND md.escenario_id = mz.escenario_id
     AND md.fecha        = p_hasta
    WHERE mz.escenario_id = p_escenario
      AND coalesce(mz.activa, true)
      AND md.activo
      AND mz.tipo_de_servicio IN ('URGENTE','NOCTURNO','SERVICE')
  ),
  aporte AS (
    -- peso_norm puede dar 0 (alpha=0 y el movil es transito puro): el
    -- movil sigue "presente" en la zona pero sin aportar peso real. Los
    -- niveles CHOFER/MOVIL de abajo excluyen expresamente estas filas de
    -- `n`, no solo de las estadisticas (Important 4).
    SELECT movil, zona_id, tipo,
           CASE WHEN w > 0 THEN peso / w ELSE 0 END AS peso_norm
    FROM (
      SELECT a.*, sum(a.peso) OVER (PARTITION BY a.movil, a.tipo) AS w
      FROM asign a
    ) p
  ),
  -- ─── Nivel MOVIL: promedio ponderado del ritmo propio de cada movil ──
  -- El FILTER exige peso_norm>0 (aporte real, no solo "esta asignado") Y
  -- pm.n>0 (el movil tiene ritmo propio calculable). Sin el primero,
  -- un movil con peso 0 puede inflar `n` sin aportar nada al blend
  -- (Important 4).
  por_zona_movil AS (
    SELECT ap.zona_id, ap.tipo,
           CASE WHEN sum(ap.peso_norm) FILTER (WHERE ap.peso_norm > 0 AND pm.n > 0) > 0
                THEN round(sum(ap.peso_norm * pm.media)   FILTER (WHERE ap.peso_norm > 0 AND pm.n > 0) / sum(ap.peso_norm) FILTER (WHERE ap.peso_norm > 0 AND pm.n > 0), 2) END AS media,
           CASE WHEN sum(ap.peso_norm) FILTER (WHERE ap.peso_norm > 0 AND pm.n > 0) > 0
                THEN round(sum(ap.peso_norm * pm.mediana) FILTER (WHERE ap.peso_norm > 0 AND pm.n > 0) / sum(ap.peso_norm) FILTER (WHERE ap.peso_norm > 0 AND pm.n > 0), 2) END AS mediana,
           CASE WHEN sum(ap.peso_norm) FILTER (WHERE ap.peso_norm > 0 AND pm.n > 0) > 0
                THEN round(sum(ap.peso_norm * pm.p75)     FILTER (WHERE ap.peso_norm > 0 AND pm.n > 0) / sum(ap.peso_norm) FILTER (WHERE ap.peso_norm > 0 AND pm.n > 0), 2) END AS p75,
           CASE WHEN sum(ap.peso_norm) FILTER (WHERE ap.peso_norm > 0 AND pm.n > 0) > 0
                THEN round(sum(ap.peso_norm * pm.p90)     FILTER (WHERE ap.peso_norm > 0 AND pm.n > 0) / sum(ap.peso_norm) FILTER (WHERE ap.peso_norm > 0 AND pm.n > 0), 2) END AS p90,
           coalesce(sum(pm.n) FILTER (WHERE ap.peso_norm > 0 AND pm.n > 0), 0)::integer AS n
    FROM aporte ap
    LEFT JOIN por_movil pm ON pm.movil = ap.movil AND pm.tipo = ap.tipo
    GROUP BY ap.zona_id, ap.tipo
  ),
  -- ─── Nivel CHOFER: promedio ponderado del ritmo propio del chofer de
  -- cada movil ───────────────────────────────────────────────────────
  movil_chofer AS (
    -- Cada movil de la zona x tipo, resuelto a su chofer top y al ritmo
    -- propio de ese chofer.
    SELECT ap.zona_id, ap.tipo, ap.movil, ap.peso_norm,
           ctm.chofer,
           pc.media   AS chofer_media,
           pc.mediana AS chofer_mediana,
           pc.p75     AS chofer_p75,
           pc.p90     AS chofer_p90,
           pc.n       AS chofer_n
    FROM aporte ap
    LEFT JOIN chofer_top_por_movil ctm ON ctm.movil = ap.movil
    LEFT JOIN por_chofer pc ON pc.chofer = ctm.chofer AND pc.tipo = ap.tipo
  ),
  zona_chofer AS (
    -- Un mismo chofer puede manejar mas de un movil de la zona (flota
    -- tercerizada: metricas_cumplimiento.chofer es texto libre del
    -- AS400, se repite entre camiones de la misma fletera). Se suman
    -- los pesos que le corresponden a traves de los moviles que lo
    -- referencian (aportes reales, distintos), pero sus MUESTRAS
    -- (chofer_n) se cuentan UNA sola vez: es el mismo historial del
    -- chofer, no uno distinto por cada movil (Important 3).
    SELECT zona_id, tipo, chofer,
           sum(peso_norm)             AS peso_chofer,
           max(chofer_media)          AS media,
           max(chofer_mediana)        AS mediana,
           max(chofer_p75)            AS p75,
           max(chofer_p90)            AS p90,
           max(coalesce(chofer_n,0))  AS n
    FROM movil_chofer
    WHERE chofer IS NOT NULL AND chofer_n > 0
    GROUP BY zona_id, tipo, chofer
  ),
  por_zona_chofer AS (
    -- Mismo FILTER por peso_chofer>0 que MOVIL: un chofer cuyos moviles
    -- aportaron peso 0 (alpha=0, transito puro) no debe ganar la
    -- cascada con estadisticas NULL (Important 4).
    SELECT zona_id, tipo,
           CASE WHEN sum(peso_chofer) FILTER (WHERE peso_chofer > 0) > 0
                THEN round(sum(peso_chofer * media)   FILTER (WHERE peso_chofer > 0) / sum(peso_chofer) FILTER (WHERE peso_chofer > 0), 2) END AS media,
           CASE WHEN sum(peso_chofer) FILTER (WHERE peso_chofer > 0) > 0
                THEN round(sum(peso_chofer * mediana) FILTER (WHERE peso_chofer > 0) / sum(peso_chofer) FILTER (WHERE peso_chofer > 0), 2) END AS mediana,
           CASE WHEN sum(peso_chofer) FILTER (WHERE peso_chofer > 0) > 0
                THEN round(sum(peso_chofer * p75)     FILTER (WHERE peso_chofer > 0) / sum(peso_chofer) FILTER (WHERE peso_chofer > 0), 2) END AS p75,
           CASE WHEN sum(peso_chofer) FILTER (WHERE peso_chofer > 0) > 0
                THEN round(sum(peso_chofer * p90)     FILTER (WHERE peso_chofer > 0) / sum(peso_chofer) FILTER (WHERE peso_chofer > 0), 2) END AS p90,
           coalesce(sum(n) FILTER (WHERE peso_chofer > 0), 0)::integer AS n
    FROM zona_chofer
    GROUP BY zona_id, tipo
  ),
  -- ─── Orden de la cascada por (escenario, tipo) ───────────────────────
  -- Se parsea, se filtra a niveles validos (CHOFER, MOVIL, ZONA, GLOBAL)
  -- preservando el orden de aparicion; si no queda NINGUNO valido (falta
  -- la fila de config, lista vacia, o basura como 'FRUTA,,XX') cae al
  -- default completo. GLOBAL se saca de la posicion en que haya venido
  -- (si vino) y se reagrega UNA sola vez al final: es la red final,
  -- nunca se pierde ni se cuenta dos veces, y una lista de solo 'GLOBAL'
  -- es una configuracion valida en si misma (no dispara el fallback a
  -- default: 'GLOBAL' no es una lista vacia/mal formada).
  cascada_cruda AS (
    SELECT dc.tipo_servicio AS tipo, trim(u.lvl) AS lvl, u.ord
    FROM demoras_config dc,
         LATERAL unnest(string_to_array(upper(coalesce(dc.ritmo_cascada,'')), ',')) WITH ORDINALITY AS u(lvl, ord)
    WHERE dc.escenario_id = p_escenario
  ),
  cascada_valida AS (
    SELECT tipo, array_agg(lvl ORDER BY ord) AS niveles
    FROM cascada_cruda
    WHERE lvl IN ('CHOFER','MOVIL','ZONA','GLOBAL')
    GROUP BY tipo
  ),
  cascada AS (
    SELECT t.tipo,
           array_remove(coalesce(cv.niveles, ARRAY['CHOFER','MOVIL','ZONA','GLOBAL']), 'GLOBAL')
             || ARRAY['GLOBAL'] AS niveles
    FROM (SELECT unnest(ARRAY['URGENTE','NOCTURNO','SERVICE']) AS tipo) t
    LEFT JOIN cascada_valida cv ON cv.tipo = t.tipo
  ),
  -- ─── Expandir universo x niveles y elegir el primero que alcance
  -- p_min_muestras (GLOBAL, siempre presente al final, es la red final
  -- aunque tampoco llegue al minimo) ─────────────────────────────────
  candidatos AS (
    SELECT u.zona_id, u.tipo, lv.ord, lv.nivel,
           CASE lv.nivel
             WHEN 'CHOFER' THEN pzc.media
             WHEN 'MOVIL'  THEN pzm.media
             WHEN 'ZONA'   THEN pz.media
             ELSE g.media
           END AS media,
           CASE lv.nivel
             WHEN 'CHOFER' THEN pzc.mediana
             WHEN 'MOVIL'  THEN pzm.mediana
             WHEN 'ZONA'   THEN pz.mediana
             ELSE g.mediana
           END AS mediana,
           CASE lv.nivel
             WHEN 'CHOFER' THEN pzc.p75
             WHEN 'MOVIL'  THEN pzm.p75
             WHEN 'ZONA'   THEN pz.p75
             ELSE g.p75
           END AS p75,
           CASE lv.nivel
             WHEN 'CHOFER' THEN pzc.p90
             WHEN 'MOVIL'  THEN pzm.p90
             WHEN 'ZONA'   THEN pz.p90
             ELSE g.p90
           END AS p90,
           coalesce(CASE lv.nivel
             WHEN 'CHOFER' THEN pzc.n
             WHEN 'MOVIL'  THEN pzm.n
             WHEN 'ZONA'   THEN pz.n
             ELSE g.n
           END, 0) AS n
    FROM universo u
    JOIN cascada c ON c.tipo = u.tipo
    CROSS JOIN LATERAL unnest(c.niveles) WITH ORDINALITY AS lv(nivel, ord)
    LEFT JOIN por_zona_chofer pzc ON pzc.zona_id = u.zona_id AND pzc.tipo = u.tipo
    LEFT JOIN por_zona_movil  pzm ON pzm.zona_id = u.zona_id AND pzm.tipo = u.tipo
    LEFT JOIN por_zona        pz  ON pz.zona_id  = u.zona_id AND pz.tipo  = u.tipo
    LEFT JOIN global          g   ON g.tipo      = u.tipo
  ),
  elegido AS (
    -- Gana el de menor ord entre los que llegan al minimo; si ninguno
    -- llega, gana el de mayor ord (GLOBAL, siempre el ultimo).
    SELECT DISTINCT ON (zona_id, tipo)
           zona_id, tipo, nivel, media, mediana, p75, p90, n
    FROM candidatos
    ORDER BY zona_id, tipo,
             (n >= (SELECT min_muestras FROM cfg)) DESC,
             CASE WHEN n >= (SELECT min_muestras FROM cfg) THEN ord ELSE -ord END ASC
  )
  SELECT zona_id, tipo, media, mediana, p75, p90, nivel, n
  FROM elegido;
$fn$;

COMMENT ON FUNCTION demoras_ritmo(integer, date) IS
  'Cascada de cuatro niveles (CHOFER, MOVIL, ZONA, GLOBAL) por (zona, tipo). Los parametros (ventana en dias, minimo de muestras, metrica, corte de huecos) salen de demoras_modelo, no de la firma, para poder cambiarlos sin tocar a los llamadores. Las muestras vienen de demoras_ritmo_muestras, que resuelve si el ritmo se mide entre cumplimientos consecutivos (ENTRE_ENTREGAS, lo correcto) o de asignacion a entrega (ASIGNADO_A_ENTREGA, la metrica vieja que doble-cuenta la cola). El resto del algoritmo es identico a la version del 2026-07-30: blend ponderado en CHOFER/MOVIL, chofer que maneja varios moviles no duplica muestras, nivel sin peso real no gana la cascada, GLOBAL siempre ultimo.';

-- ─── Grants: solo service_role (I3, review final de rama) ────────────
-- demoras_ritmo nunca habia tenido REVOKE/GRANT explicito en ningun
-- archivo (ni en la tanda PROXIMO_HUECO ni en la primera pasada de
-- CONSUMO_TRAMOS) -- gap preexistente que se cierra aca, en su ultimo
-- CREATE OR REPLACE. Mismo patron que demoras_ritmo_movil, mas abajo en
-- este mismo archivo, y que el resto de las funciones del motor.
REVOKE EXECUTE ON FUNCTION demoras_ritmo(integer, date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION demoras_ritmo(integer, date) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION demoras_ritmo(integer, date) TO service_role;


-- ─── demoras_ritmo_movil — copiado de docs/sqls/2026-07-31-demoras-ritmo-movil.sql ──
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
           coalesce((SELECT dm.ritmo_hueco_min_minutos FROM demoras_modelo dm WHERE dm.escenario_id = p_escenario), 5)                AS hueco_min,
           coalesce((SELECT dm.ritmo_solo_con_cola     FROM demoras_modelo dm WHERE dm.escenario_id = p_escenario), false)            AS solo_con_cola
  ),
  base AS (
    SELECT m.tipo, m.movil, m.chofer, m.v
    FROM cfg c,
         LATERAL demoras_ritmo_muestras(
           p_escenario, p_hasta, c.dias, c.metrica, c.hueco_max, c.hueco_min, c.solo_con_cola
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
-- y que docs/sqls/2026-07-24-metricas-dashboard-rpc.sql. CREATE OR REPLACE
-- no revoca privilegios existentes, asi que este REVOKE se re-aplica aca
-- tambien (idempotente, no hace nada si ya estaba revocado).
REVOKE EXECUTE ON FUNCTION demoras_ritmo_movil(integer, date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION demoras_ritmo_movil(integer, date) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION demoras_ritmo_movil(integer, date) TO service_role;
