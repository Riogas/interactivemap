-- =====================================================================
-- demoras_ritmo — cascada de cuatro niveles, orden configurable
-- Fecha: 2026-07-30 | Idempotente
--
-- Sube de zona->global a CHOFER -> MOVIL -> ZONA -> GLOBAL. El orden se
-- lee de demoras_config.ritmo_cascada por (escenario, tipo) (CSV,
-- default 'CHOFER,MOVIL,ZONA,GLOBAL'). Gana el primer nivel que llegue a
-- p_min_muestras; niveles desconocidos se ignoran; lista vacia o mal
-- formada cae al default completo. GLOBAL se evalua SIEMPRE ultimo
-- aunque no figure en la lista o este en otra posicion: es la red
-- final, para que sea imposible configurar el motor de forma que se
-- quede sin ritmo.
--
-- Fix round 1 (2026-07-29), sobre 2 Critical + 5 Important de la revision:
--   - Critical 1: 'GLOBAL' sola es una configuracion VALIDA (linea base
--     estable cuando los datos de chofer no son confiables), no una
--     lista vacia/mal formada. El filtro de niveles validos ahora
--     incluye GLOBAL; se le saca GLOBAL a la lista resultante y se
--     reagrega una sola vez al final (array_remove + append), asi
--     'GLOBAL' da cascada=[GLOBAL] (nada mas) en vez de expandirse al
--     default completo, y una lista con GLOBAL en el medio no la
--     duplica ni la deja fuera de lugar.
--   - Critical 2 (numerico, sin cambio de codigo): el fix round agrego
--     un assert que verifica el VALOR del blend ponderado (no solo el
--     origen), con dos moviles de pesos distintos y choferes con
--     ritmos distintos. Ver scripts/sql-harness/assert-ritmo.sql.
--   - Important 3: un mismo chofer puede manejar mas de un movil de la
--     zona (metricas_cumplimiento.chofer es texto libre del AS400, se
--     repite entre camiones de la misma fletera tercerizada). Antes se
--     sumaban sus muestras una vez POR MOVIL que lo referenciaba
--     (duplicando). Ahora se colapsa por chofer (CTE zona_chofer,
--     GROUP BY chofer) antes de sumar: el peso se acumula (son
--     aportes reales de moviles distintos) pero las muestras del
--     chofer se cuentan una sola vez.
--   - Important 4: con peso_transito_alpha=0 (soportado por el CHECK y
--     documentado), un movil de transito puede terminar con
--     peso_norm=0. Antes las ESTADISTICAS se filtraban por "hay dato
--     del chofer/movil" pero las MUESTRAS (n) se sumaban sin mirar el
--     peso: un nivel podia ganar la cascada (n >= minimo) con las
--     cuatro estadisticas en NULL, y demoras_calcular_run terminaba
--     informando el DEFECTO (ritmo_default_minutos) habiendo
--     descartado una estadistica de un nivel inferior con datos reales.
--     Ahora `n`, al igual que las estadisticas, solo cuenta el peso
--     efectivamente aportado (peso_chofer > 0 / peso_norm > 0): un
--     nivel sin peso real no gana la cascada, cae al siguiente.
--
-- CHOFER y MOVIL no son un valor unico por zona: una zona tiene varios
-- moviles activos, cada uno con su chofer. Se resuelven como PROMEDIO
-- PONDERADO por el aporte de cada movil a esa zona -- el mismo aporte
-- que ya calcula demoras_capacidad (peso 1 prioridad / alpha transito,
-- normalizado por movil dentro de cada tipo). Se replica ese prorrateo
-- ACA ADENTRO (CTEs alpha/asign/aporte) en vez de llamar a
-- demoras_capacidad porque esa funcion solo devuelve el agregado por
-- zona: este nivel necesita el aporte POR MOVIL para ponderar. Usa
-- p_hasta como fecha de referencia de moviles_dia, igual que
-- demoras_calcular_run llama a demoras_capacidad(v_esc, v_fecha) y
-- demoras_ritmo(v_esc, v_fecha) con la misma fecha.
--
-- El chofer de un movil es el que mas veces aparece en
-- metricas_cumplimiento.chofer para ese movil en la ventana (nombre-
-- texto, no hay id estable). El ritmo de CHOFER y de MOVIL son
-- estadisticas propias (no dependen de la zona): el ritmo del chofer es
-- su propio historial de demora_efectiva_mins para ese tipo, sin
-- importar en que zona haya andado.
--
-- OJO auditoria: en CHOFER/MOVIL las cuatro columnas (media, mediana,
-- p75, p90) son BLENDS PONDERADOS de las estadisticas propias de cada
-- chofer/movil, no percentiles recalculados sobre el pool de valores
-- crudos. Promediar medianas no es la mediana del pool combinado, y en
-- P75/P90 el sesgo es asimetrico (aplasta la cola, justo el estadistico
-- que se elige para ser conservador). Se acepta a proposito: es la
-- lectura simple que pide el brief, y el blend esta acotado entre el
-- minimo y el maximo de lo que combina (no puede "inventar" un numero
-- fuera de rango), asi que no es peligroso para el uso que le da
-- demoras_calcular_run. Documentado aca para que quien lo audite sepa
-- que no es una poblacion real.
-- =====================================================================
CREATE OR REPLACE FUNCTION demoras_ritmo(
  p_escenario    integer,
  p_hasta        date,
  p_dias         integer DEFAULT 7,
  p_min_muestras integer DEFAULT 5
)
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
  WITH universo AS (
    -- Pares (zona, tipo) que tienen moviles asignados en moviles_zonas.
    -- Es el universo de referencia: incluso zonas sin hechos en la ventana
    -- deben devolver una fila (con fallback a global).
    SELECT DISTINCT mz.zona_id, mz.tipo_de_servicio AS tipo
    FROM moviles_zonas mz
    WHERE mz.escenario_id = p_escenario
      AND coalesce(mz.activa, true)
      AND mz.tipo_de_servicio IN ('URGENTE','NOCTURNO','SERVICE')
  ),
  base AS (
    SELECT m.zona_nro,
           m.tipo_servicio AS tipo,
           m.movil,
           m.chofer,
           m.demora_efectiva_mins AS v
    FROM metricas_cumplimiento m
    WHERE m.escenario = p_escenario
      AND m.fecha BETWEEN (p_hasta - p_dias) AND (p_hasta - 1)
      AND m.zona_nro IS NOT NULL
      -- ESPECIAL y OTROS se excluyen del motor de demora por decision del
      -- usuario (2026-07-28): no tienen oferta propia en moviles_zonas.
      AND m.tipo_servicio IN ('URGENTE','NOCTURNO','SERVICE')
  ),
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
             (n >= p_min_muestras) DESC,
             CASE WHEN n >= p_min_muestras THEN ord ELSE -ord END ASC
  )
  SELECT zona_id, tipo, media, mediana, p75, p90, nivel, n
  FROM elegido;
$fn$;

COMMENT ON FUNCTION demoras_ritmo(integer, date, integer, integer) IS
  'Cascada de cuatro niveles (CHOFER, MOVIL, ZONA, GLOBAL) por (zona, tipo) sobre demora_efectiva_mins de los ultimos p_dias. El orden lo define demoras_config.ritmo_cascada por (escenario, tipo), CSV (default CHOFER,MOVIL,ZONA,GLOBAL); gana el primer nivel que llegue a p_min_muestras, niveles desconocidos se ignoran, lista vacia o mal formada cae al default completo. GLOBAL se evalua siempre ultimo (se saca de donde este y se reagrega una sola vez al final); una lista de solo GLOBAL es valida por si misma, NO dispara el fallback a default. CHOFER y MOVIL se resuelven como promedio ponderado por el aporte de cada movil activo a la zona (mismo prorrateo que demoras_capacidad, replicado aca porque esa funcion no expone el aporte por movil); un chofer que maneja mas de un movil de la zona no duplica sus muestras, y un nivel sin peso real (alpha=0 sobre transito puro) no cuenta esas muestras ni gana con estadisticas NULL. En CHOFER/MOVIL las cuatro columnas son BLENDS PONDERADOS de las estadisticas propias de cada chofer/movil (no percentiles recalculados sobre el pool de valores crudos): acotado entre el minimo y el maximo de lo que combina, pero promediar medianas no es la mediana del pool. ESPECIAL y OTROS se excluyen (no tienen oferta propia en moviles_zonas).';
