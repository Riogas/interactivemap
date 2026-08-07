-- =====================================================================
-- LABORATORIO DE VARIANTES (champion-challenger en vivo)
-- Fecha: 2026-08-07 | Idempotente | Pedido de Diego (audio 7/8):
-- "que cuando haga los calculos grabe MAS valores: mediana y promedio,
--  zona y chofer, redondeo a 10 y a 15, otro suavizado... y que despues
--  el sistema nos diga solo cual fue la mejor combinacion, sin tener
--  que hacer todos los calculos para atras".
--
-- ─── Decision de diseno: EL MOTOR NO SE TOCA ─────────────────────────
-- La v1 de este archivo llamaba al laboratorio DENTRO de
-- demoras_calcular_run, blindado con BEGIN/EXCEPTION. La revision
-- adversarial (3 revisores, 2026-08-07) encontro que ese blindaje es
-- insuficiente: `EXCEPTION WHEN OTHERS` NO atrapa query_canceled ni
-- ASSERT_FAILURE, asi que un statement_timeout / pg_cancel_backend /
-- pg_terminate_backend que cayera durante el laboratorio abortaria la
-- transaccion ENTERA -- incluido el INSERT de la corrida real ya hecho.
-- Ademas el laboratorio multiplicaba ~x4 los escaneos del historico
-- DENTRO del advisory lock del motor, y contra lentitud (a diferencia
-- de contra errores) ningun blindaje protege.
--
-- Por eso el laboratorio corre en su PROPIO job de pg_cron
-- (`demoras-variantes`, cada 5 minutos), sobre corridas YA COMMITEADAS:
--   * demoras_calcular_run queda EXACTAMENTE como esta hoy (v6). Cero
--     riesgo para la corrida real: otro proceso, otra transaccion, otro
--     advisory lock.
--   * el backfill procesa las corridas pendientes EN ORDEN, asi que la
--     escalera propia de cada variante se construye bien y un hueco
--     corto (una pasada perdida) se rellena en la siguiente.
--   * pero SOLO corridas RECIENTES (ventana en minutos, default 15). Y
--     esto no es prolijidad: MEDIDO el 7/8, rellenar hacia atras las
--     corridas de ayer daba a las variantes re-simuladas ~105' de
--     promesa promedio contra ~84' del campeon -- casi todas contra el
--     techo. La causa es que la re-simulacion necesita el ESTADO DEL
--     MUNDO del momento (moviles_dia del dia, pedidos pendientes,
--     cola), y ese estado ya no existe: el rollover de moviles_dia
--     corre a las 02:05 y los pendientes de ayer hoy estan entregados.
--     Las variantes DERIVADAS (factor, escalon, piso, escalera) si
--     serian validas hacia atras porque salen de la cruda grabada, pero
--     mezclar unas validas con otras basura es peor que no tener el
--     dato: una corrida vieja no se rellena, y se ve en calculado_at.
--     Es, textualmente, el motivo por el que Diego pidio grabar esto en
--     el momento en vez de calcularlo despues.
--   * solo procesa corridas cuya modelo_version coincide con la
--     parametria vigente: si alguien edita el modelo a media manana, las
--     corridas viejas de la version anterior se saltean en vez de
--     medirse contra perillas que no eran las suyas.
--
-- Otros principios:
--  * Cada variante arrastra SU PROPIA escalera: el suavizado se aplica
--    contra la corrida anterior DE ESA VARIANTE. Esa dependencia del
--    camino es exactamente lo que un retro-backtest sobre las crudas
--    guardadas no puede reconstruir fiel.
--  * Las fases del arranque se derivan EXACTO de la cruda ya grabada:
--    el motor calculo `espera + (cola+1) x ritmo`, asi que la variante
--    es `cruda_motor + (cola+1) x (ritmo_var - ritmo_motor)` -- sin
--    reconstruir la espera (que en demoras_calculadas quedo redondeada
--    a 0,1') y sin error para toda variante que no toque el ritmo.
--  * Variantes de factor / escalon / suavizado / piso: se derivan de la
--    cruda grabada (el factor es un multiplicador final en
--    demoras_consumo_tramos, asi que cruda_prefactor = demora_cruda /
--    factor_del_modelo), salvo el techo, donde el motor NO aplica
--    factor -- se detecta con capacidad_final <= 0 y se respeta.
--  * Variantes de estadistico / nivel: RE-SIMULAN los tramos con clones
--    parametrizados del pipeline (seccion 3).
--  * El catalogo es DATA-DRIVEN: probar una idea nueva = un INSERT en
--    demoras_variantes. Cero ALTER, cero deploy.
--  * Campo NULL en el catalogo = "como el campeon" (lo que diga
--    demoras_modelo). Una variante define SOLO lo que cambia -- eso da
--    atribucion limpia por perilla.
--  * La variante CAMPEON (todo NULL) es el CONTROL: debe publicar lo
--    mismo que el motor corrida a corrida. Si no coincide, el
--    laboratorio esta mal, no el motor -- el scoreboard lo vigila
--    (campeon_ok) y la card lo muestra.
--
-- Secciones:
--  1. Catalogo demoras_variantes + seed (13 variantes)
--  2. Tabla demoras_calculadas_variantes + indices
--  3. Clones parametrizados: demoras_ritmo_zona_lab, demoras_aportes_lab,
--     demoras_consumo_tramos_lab
--  4. demoras_variantes_snapshot (una corrida)
--  5. demoras_variantes_backfill (las corridas pendientes, en orden)
--  6. pg_cron: job del laboratorio (cada 5') + retencion 30 dias
--  7. Scoreboard: ver docs/sqls/2026-08-07-variantes-scoreboard.sql
--
-- Aplicacion en prod EN DOS PASOS (asi se verifico el 7/8):
--   paso 1: secciones 1-5, y correr a mano
--           SELECT demoras_variantes_snapshot(<ultima corrida>, 1000);
--           => verificar CAMPEON == motor y medir el tiempo.
--   paso 2: recien ahi la seccion 6 (los jobs de pg_cron).
-- =====================================================================

-- ─── 1. Catalogo ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS demoras_variantes (
  id               smallint PRIMARY KEY,
  codigo           text NOT NULL UNIQUE,
  nombre           text NOT NULL,
  descripcion      text NOT NULL,
  -- NULL = "como el campeon" (demoras_modelo vigente en cada corrida).
  estadistico      text     CHECK (estadistico IN ('MEDIA','MEDIANA','P75','P90')),
  nivel_ritmo      text     CHECK (nivel_ritmo IN ('CASCADA','ZONA')),
  factor           numeric  CHECK (factor > 0 AND factor <= 2),
  escalon_minutos  smallint CHECK (escalon_minutos IN (5,10,15)),
  suavizado        boolean NOT NULL DEFAULT true,
  suavizado_paso   smallint CHECK (suavizado_paso BETWEEN 5 AND 60),
  min_minutos      smallint CHECK (min_minutos BETWEEN 0 AND 60),
  activa           boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE demoras_variantes IS
  'Catalogo del laboratorio de variantes (champion-challenger). Cada fila es una configuracion alternativa que se calcula EN PARALELO al motor, sin publicarse. NULL en un campo = usar lo del modelo vigente. Probar una idea nueva = un INSERT aca. Ver docs/sqls/2026-08-07-laboratorio-variantes.sql.';

INSERT INTO demoras_variantes (id, codigo, nombre, descripcion, estadistico, nivel_ritmo, factor, escalon_minutos, suavizado, suavizado_paso, min_minutos) VALUES
  ( 1, 'CAMPEON',      'Campeón (control)',   'Espejo exacto del motor con la parametría vigente. Es el control de sanidad del laboratorio: si no coincide con lo publicado, el laboratorio está mal (no el motor).', NULL, NULL, NULL, NULL, true, NULL, NULL),
  ( 2, 'EST_MEDIA',    'Promedio',            'El ritmo se estima con el PROMEDIO en vez de la mediana. En el barrido del 6/8 dio peor (~×1,30 sobre la mediana), acá queda midiéndose todos los días.', 'MEDIA', NULL, NULL, NULL, true, NULL, NULL),
  ( 3, 'EST_P75',      'Percentil 75',        'El ritmo se estima con el P75 (más conservador que la mediana: promete más).', 'P75', NULL, NULL, NULL, true, NULL, NULL),
  ( 4, 'EST_P90',      'Percentil 90',        'El ritmo se estima con el P90 (muy conservador: casi nunca se queda corto, a costa de prometer demoras altas).', 'P90', NULL, NULL, NULL, true, NULL, NULL),
  ( 5, 'NIVEL_ZONA',   'Ritmo de zona',       'Cada móvil usa el ritmo histórico de SU ZONA (con la red global cuando la zona no tiene muestras suficientes) en vez del propio o el de su chofer: hoy la cascada resuelve el 99% a nivel CHOFER. Mide si esa personalización aporta o mete ruido.', NULL, 'ZONA', NULL, NULL, true, NULL, NULL),
  ( 6, 'FACTOR_100',   'Sin calibración',     'Factor de calibración 1,00: el modelo puro, sin el ajuste ×0,85 activado el 6/8. Es el contrafáctico de esa perilla.', NULL, NULL, 1.00, NULL, true, NULL, NULL),
  ( 7, 'FACTOR_080',   'Calibración ×0,80',   'Encoge la cruda un 20%. En el barrido del 6/8 dio mejor que 0,85 en las dos muestras; quedó para el re-barrido del viernes — acá se mide solo.', NULL, NULL, 0.80, NULL, true, NULL, NULL),
  ( 8, 'FACTOR_075',   'Calibración ×0,75',   'Encoge la cruda un 25%. El borde de lo razonable antes de subestimar sistemáticamente.', NULL, NULL, 0.75, NULL, true, NULL, NULL),
  ( 9, 'ESCALON_10',   'Escalón de 10′',      'Publica redondeando hacia arriba de a 10 minutos en vez de 15 (lo que Diego llamó "redondeo a 10"): promesas más finas, menos colchón por redondeo.', NULL, NULL, NULL, 10, true, NULL, NULL),
  (10, 'SIN_ESCALERA', 'Sin suavizado',       'Publica la cruda acotada y redondeada, SIN la escalera de 15′ contra la corrida anterior. Mide cuánto acierto cuesta (o regala) la suavidad.', NULL, NULL, NULL, NULL, false, NULL, NULL),
  (11, 'PASO_30',      'Escalera ágil (30′)', 'La escalera puede subir/bajar hasta 30′ por corrida en vez de 15′: reacciona el doble de rápido a los cambios reales. Ataca la causa ESCALERA de los perdidos.', NULL, NULL, NULL, NULL, true, 30, NULL),
  (12, 'PISO_20',      'Piso de 20′',         'El mínimo publicable baja de 30′ a 20′. Mide honestamente cuánto del acierto actual lo regala el piso en zonas rápidas.', NULL, NULL, NULL, NULL, true, NULL, 20),
  (13, 'COMBO_FINO',   'Combo fino',          'La mejor apuesta combinada: calibración ×0,80 + escalón de 10′. Las variantes de una sola perilla dan la atribución; ésta prueba la interacción.', NULL, NULL, 0.80, 10, true, NULL, NULL)
ON CONFLICT (id) DO NOTHING;

-- ─── 2. Los calculos de cada variante, corrida a corrida ─────────────

CREATE TABLE IF NOT EXISTS demoras_calculadas_variantes (
  corrida_at       timestamptz NOT NULL,
  escenario        integer  NOT NULL,
  zona_id          integer  NOT NULL,
  tipo_servicio    text     NOT NULL,
  variante_id      smallint NOT NULL REFERENCES demoras_variantes(id),
  demora_cruda     numeric,
  demora_suavizada numeric,          -- pre-redondeo, la que arrastra la escalera propia
  demora_informada integer,          -- lo que ESTA variante hubiera publicado
  ritmo_usado      numeric,          -- el ritmo con el que esta variante miro la zona
  -- Cuando se calculo. Contra corrida_at da el DESFASE: las variantes
  -- que re-simulan el ritmo necesitan el estado del mundo del momento,
  -- asi que un desfase grande invalida la fila. El backfill no deja que
  -- pase de la ventana, y esta columna lo deja auditable.
  calculado_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (corrida_at, escenario, zona_id, tipo_servicio, variante_id)
);

ALTER TABLE demoras_calculadas_variantes
  ADD COLUMN IF NOT EXISTS calculado_at timestamptz NOT NULL DEFAULT now();

COMMENT ON TABLE demoras_calculadas_variantes IS
  'Lo que cada variante del laboratorio HUBIERA publicado en cada corrida. La escribe demoras_variantes_snapshot(), disparada por el job demoras-variantes sobre corridas ya commiteadas. demora_suavizada arrastra la escalera PROPIA de la variante (dependencia del camino que un retro no puede reconstruir). Retencion 30 dias (cron demoras-variantes-limpieza).';

-- Para el "prev" de la escalera propia y para el scoreboard.
CREATE INDEX IF NOT EXISTS idx_dcv_zona_variante_at
  ON demoras_calculadas_variantes (escenario, zona_id, tipo_servicio, variante_id, corrida_at DESC);

-- Para el "que corridas faltan" del backfill (anti-join por corrida).
CREATE INDEX IF NOT EXISTS idx_dcv_esc_at
  ON demoras_calculadas_variantes (escenario, corrida_at);

-- ─── 3. Clones parametrizados del pipeline ───────────────────────────
-- ATENCION deriva: son clones de demoras_ritmo / demoras_aportes /
-- demoras_consumo_tramos con (estadistico, nivel) como PARAMETROS en
-- lugar de leerlos de demoras_modelo, y SIN factor de calibracion (la
-- cruda sale PREFACTOR; el snapshot multiplica por el factor de cada
-- variante). Si se toca la logica de los originales hay que tocar estos
-- -- el assert del harness (assert-variantes.sql) compara clon vs
-- original con la parametria del modelo y revienta si driftean, y el
-- control CAMPEON del scoreboard lo vigila en prod todos los dias.

-- 3a. Ritmo a nivel ZONA, con la MISMA disciplina que la cascada real:
--     si la zona no llega a ritmo_min_muestras se cae a la red global,
--     igual que hace demoras_ritmo cuando ningun nivel alcanza el
--     minimo. Es la definicion UNICA de "ritmo de zona" del
--     laboratorio: la usan tanto la re-simulacion de tramos (via
--     demoras_aportes_lab) como las formulas de arranque del snapshot
--     -- que las dos mitades hablen la misma definicion es lo que hace
--     interpretable a la variante NIVEL_ZONA.
CREATE OR REPLACE FUNCTION demoras_ritmo_zona_lab(p_escenario integer, p_hasta date)
RETURNS TABLE(zona_id integer, tipo_servicio text, ritmo_media numeric, ritmo_mediana numeric, ritmo_p75 numeric, ritmo_p90 numeric)
LANGUAGE sql
STABLE
AS $function$
  WITH cfg AS (
    SELECT coalesce(dm.ritmo_dias_ventana, 7)           AS dias,
           coalesce(dm.ritmo_min_muestras, 5)           AS min_muestras,
           coalesce(dm.ritmo_metrica, 'ENTRE_ENTREGAS') AS metrica,
           coalesce(dm.ritmo_hueco_max_minutos, 90)     AS hueco_max,
           coalesce(dm.ritmo_hueco_min_minutos, 5)      AS hueco_min,
           coalesce(dm.ritmo_solo_con_cola, false)      AS solo_con_cola
      FROM (SELECT p_escenario AS e) x
      LEFT JOIN demoras_modelo dm ON dm.escenario_id = x.e
  ),
  base AS (
    SELECT m.zona_nro, m.tipo, m.v
    FROM cfg c,
         LATERAL demoras_ritmo_muestras(
           p_escenario, p_hasta, c.dias, c.metrica, c.hueco_max, c.hueco_min, c.solo_con_cola
         ) m
  ),
  por_zona AS (
    SELECT b.zona_nro, b.tipo,
           round(avg(b.v), 2) AS media,
           round(percentile_cont(0.5)  WITHIN GROUP (ORDER BY b.v)::numeric, 2) AS mediana,
           round(percentile_cont(0.75) WITHIN GROUP (ORDER BY b.v)::numeric, 2) AS p75,
           round(percentile_cont(0.9)  WITHIN GROUP (ORDER BY b.v)::numeric, 2) AS p90,
           count(*)::integer AS n
    FROM base b GROUP BY b.zona_nro, b.tipo
  ),
  global AS (
    SELECT b.tipo,
           round(avg(b.v), 2) AS media,
           round(percentile_cont(0.5)  WITHIN GROUP (ORDER BY b.v)::numeric, 2) AS mediana,
           round(percentile_cont(0.75) WITHIN GROUP (ORDER BY b.v)::numeric, 2) AS p75,
           round(percentile_cont(0.9)  WITHIN GROUP (ORDER BY b.v)::numeric, 2) AS p90
    FROM base b GROUP BY b.tipo
  ),
  -- El universo es el mismo que el de demoras_ritmo: las zonas x tipo
  -- con oferta activa. Una zona sin muestras propias igual devuelve
  -- fila, con el global.
  universo AS (
    SELECT DISTINCT mz.zona_id AS z, mz.tipo_de_servicio AS t
    FROM moviles_zonas mz
    WHERE mz.escenario_id = p_escenario
      AND coalesce(mz.activa, true)
      AND mz.tipo_de_servicio IN ('URGENTE','NOCTURNO','SERVICE')
  )
  SELECT u.z, u.t,
         CASE WHEN coalesce(pz.n, 0) >= c.min_muestras THEN pz.media   ELSE g.media   END,
         CASE WHEN coalesce(pz.n, 0) >= c.min_muestras THEN pz.mediana ELSE g.mediana END,
         CASE WHEN coalesce(pz.n, 0) >= c.min_muestras THEN pz.p75     ELSE g.p75     END,
         CASE WHEN coalesce(pz.n, 0) >= c.min_muestras THEN pz.p90     ELSE g.p90     END
  FROM universo u
  CROSS JOIN cfg c
  LEFT JOIN por_zona pz ON pz.zona_nro = u.z AND pz.tipo = u.t
  LEFT JOIN global   g  ON g.tipo = u.t;
$function$;

-- 3b. Aportes con estadistico y nivel como parametros. Clon de
--     demoras_aportes; diferencias EXACTAS:
--       * cfg.estadistico := p_estadistico (no demoras_modelo)
--       * p_nivel = 'ZONA': rit_movil NO se calcula (asi cada movil cae
--         al ritmo de su zona) y rit_zona sale de demoras_ritmo_zona_lab
--         en vez de demoras_ritmo -- si saliera de demoras_ritmo, el
--         "ritmo de zona" seria en verdad la cascada, que hoy resuelve
--         el 99% a nivel CHOFER: la variante mediria justo lo que dice
--         eliminar (hallazgo de la revision del 7/8).
--     Los gates por p_nivel van en un generador vacio
--     (SELECT 1 WHERE ...) y no como filtro adentro de la CTE
--     MATERIALIZED: asi la funcion cara ni se invoca, tambien con plan
--     generico.
CREATE OR REPLACE FUNCTION demoras_aportes_lab(p_escenario integer, p_fecha date, p_estadistico text, p_nivel text)
RETURNS TABLE(zona_id integer, tipo_servicio text, movil integer, es_transito boolean, p_j numeric, ritmo numeric, ritmo_origen text, carga_fuera integer, r_j numeric, mu_j numeric)
LANGUAGE sql
STABLE
AS $function$
  WITH cfg AS (
    SELECT coalesce((SELECT dm.dedicacion_transito           FROM demoras_modelo dm WHERE dm.escenario_id = p_escenario), 0.20) AS ded,
           coalesce((SELECT dm.transito_dedicacion_max_total FROM demoras_modelo dm WHERE dm.escenario_id = p_escenario), 0.60) AS tope,
           coalesce((SELECT dm.traslado_fuera_zona_minutos   FROM demoras_modelo dm WHERE dm.escenario_id = p_escenario), 15)   AS traslado,
           p_estadistico                                                                                                        AS estadistico,
           coalesce((SELECT dm.ritmo_default_minutos         FROM demoras_modelo dm WHERE dm.escenario_id = p_escenario), 30)::numeric AS ritmo_defecto
  ),
  asign AS (
    SELECT mz.zona_id, mz.tipo_de_servicio AS tipo, mz.movil_id::integer AS movil,
           (mz.prioridad_o_transito <> 1) AS es_transito
    FROM moviles_zonas mz
    JOIN moviles_dia md
      ON md.movil_id = mz.movil_id::integer AND md.escenario_id = mz.escenario_id AND md.fecha = p_fecha
    WHERE mz.escenario_id = p_escenario
      AND coalesce(mz.activa, true) AND md.activo
      AND mz.tipo_de_servicio IN ('URGENTE','NOCTURNO','SERVICE')
  ),
  conteo AS (
    SELECT a.movil, a.tipo,
           count(*) FILTER (WHERE a.es_transito)::numeric     AS n_tra,
           count(*) FILTER (WHERE NOT a.es_transito)::numeric AS n_pri
    FROM asign a GROUP BY a.movil, a.tipo
  ),
  reparto AS (
    SELECT c.movil, c.tipo, c.n_tra, c.n_pri,
           least(c.n_tra * cf.ded, cf.tope) AS suma_tra
    FROM conteo c CROSS JOIN cfg cf
  ),
  pj AS (
    SELECT a.zona_id, a.tipo, a.movil, a.es_transito,
           CASE
             WHEN a.es_transito THEN
               CASE WHEN r.n_tra > 0 THEN round(r.suma_tra / r.n_tra, 4) ELSE 0 END
             ELSE
               CASE WHEN r.n_pri > 0 THEN round((1 - r.suma_tra) / r.n_pri, 4) ELSE 0 END
           END AS p_j
    FROM asign a
    JOIN reparto r ON r.movil = a.movil AND r.tipo = a.tipo
  ),
  -- MATERIALIZED en las tres CTEs de abajo por el mismo motivo medido en
  -- demoras_aportes (2m13s -> 605ms): se leen desde LATERALs correlacionados
  -- y sin MATERIALIZED se re-evaluan una vez por fila.
  carga_total AS MATERIALIZED (
    SELECT p.movil, p.zona_nro, p.tipo, count(*)::integer AS n
    FROM (
      SELECT movil, zona_nro,
             CASE upper(trim(coalesce(servicio_nombre,'')))
               WHEN 'NOCTURNO' THEN 'NOCTURNO'
               WHEN 'URGENTE'  THEN 'URGENTE'
               ELSE 'OTRO'
             END AS tipo
        FROM pedidos
       WHERE escenario = p_escenario AND estado_nro = 1
         AND movil IS NOT NULL AND movil <> 0 AND zona_nro IS NOT NULL
         AND COALESCE(fch_para, (fch_hora_para AT TIME ZONE 'America/Montevideo')::date) = p_fecha
      UNION ALL
      SELECT movil, zona_nro, 'SERVICE' AS tipo
        FROM services
       WHERE escenario = p_escenario AND estado_nro = 1
         AND movil IS NOT NULL AND movil <> 0 AND zona_nro IS NOT NULL
         AND COALESCE(fch_para, (fch_hora_para AT TIME ZONE 'America/Montevideo')::date) = p_fecha
    ) p
    GROUP BY p.movil, p.zona_nro, p.tipo
  ),
  rit_zona AS MATERIALIZED (
    SELECT r.zona_id AS z, r.tipo_servicio AS t, r.ritmo_media AS media, r.ritmo_mediana AS mediana, r.ritmo_p75 AS p75, r.ritmo_p90 AS p90
    FROM (SELECT 1 WHERE p_nivel IS DISTINCT FROM 'ZONA') g
    CROSS JOIN LATERAL demoras_ritmo(p_escenario, p_fecha) r
    UNION ALL
    SELECT z.zona_id, z.tipo_servicio, z.ritmo_media, z.ritmo_mediana, z.ritmo_p75, z.ritmo_p90
    FROM (SELECT 1 WHERE p_nivel = 'ZONA') g
    CROSS JOIN LATERAL demoras_ritmo_zona_lab(p_escenario, p_fecha) z
  ),
  -- Con p_nivel = 'ZONA' el generador esta vacio y demoras_ritmo_movil
  -- ni se invoca: cada movil cae al ritmo de su zona.
  rit_movil AS MATERIALIZED (
    SELECT m.movil AS mv, m.tipo_servicio AS t, m.ritmo_media AS media, m.ritmo_mediana AS mediana, m.ritmo_p75 AS p75, m.ritmo_p90 AS p90
    FROM (SELECT 1 WHERE p_nivel IS DISTINCT FROM 'ZONA') g
    CROSS JOIN LATERAL demoras_ritmo_movil(p_escenario, p_fecha) m
  )
  SELECT
    pj.zona_id, pj.tipo, pj.movil, pj.es_transito, pj.p_j,
    rr.ritmo, rr.origen,
    coalesce(cf_out.n, 0)::integer AS carga_fuera,
    CASE WHEN coalesce(cf_out.n, 0) = 0 THEN 0
         ELSE round(coalesce(cf_out.n,0) * rr.ritmo + c.traslado, 2) END AS r_j,
    CASE WHEN rr.ritmo > 0 THEN round(pj.p_j / rr.ritmo, 6) ELSE 0 END AS mu_j
  FROM pj
  CROSS JOIN cfg c
  LEFT JOIN LATERAL (
    SELECT coalesce(sum(ct.n), 0) AS n
    FROM carga_total ct
    WHERE ct.movil = pj.movil
      AND NOT (
        ct.zona_nro = pj.zona_id
        AND ct.tipo = ANY (
          CASE pj.tipo
            WHEN 'URGENTE'  THEN ARRAY['URGENTE','NOCTURNO']
            WHEN 'NOCTURNO' THEN ARRAY['URGENTE','NOCTURNO']
            WHEN 'SERVICE'  THEN ARRAY['SERVICE']
            ELSE ARRAY[]::text[]
          END
        )
      )
  ) cf_out ON true
  CROSS JOIN LATERAL (
    SELECT
      coalesce(
        CASE c.estadistico WHEN 'MEDIA' THEN rm.media WHEN 'P75' THEN rm.p75
                           WHEN 'P90'  THEN rm.p90    ELSE rm.mediana END,
        CASE c.estadistico WHEN 'MEDIA' THEN rz.media WHEN 'P75' THEN rz.p75
                           WHEN 'P90'  THEN rz.p90    ELSE rz.mediana END,
        c.ritmo_defecto) AS ritmo,
      CASE
        WHEN (CASE c.estadistico WHEN 'MEDIA' THEN rm.media WHEN 'P75' THEN rm.p75
                                 WHEN 'P90'  THEN rm.p90    ELSE rm.mediana END) IS NOT NULL THEN 'MOVIL'
        WHEN (CASE c.estadistico WHEN 'MEDIA' THEN rz.media WHEN 'P75' THEN rz.p75
                                 WHEN 'P90'  THEN rz.p90    ELSE rz.mediana END) IS NOT NULL THEN 'ZONA'
        ELSE 'DEFECTO'
      END AS origen
    FROM (SELECT 1) x
    LEFT JOIN rit_movil rm ON rm.mv = pj.movil   AND rm.t = pj.tipo
    LEFT JOIN rit_zona  rz ON rz.z  = pj.zona_id AND rz.t = pj.tipo
  ) AS rr;
$function$;

-- 3c. Consumo de tramos con aportes_lab y SIN factor (cruda PREFACTOR).
--     Clon de demoras_consumo_tramos; diferencias EXACTAS:
--       * ap sale de demoras_aportes_lab(p_estadistico, p_nivel)
--       * el `* c.factor` NO se aplica (dos apariciones) -- el snapshot
--         multiplica por el factor de cada variante, salvo techo.
--       * la cruda sale SIN round(): el snapshot redondea UNA vez al
--         final, evitando el doble redondeo (round(round(x,2)*f,2)).
CREATE OR REPLACE FUNCTION demoras_consumo_tramos_lab(p_escenario integer, p_fecha date, p_corrida_at timestamptz, p_estadistico text, p_nivel text)
RETURNS TABLE(zona_id integer, tipo_servicio text, demora_cruda numeric, moviles_considerados integer, cola_por_delante numeric, capacidad_inicial numeric, capacidad_final numeric, tramos integer, sin_capacidad boolean)
LANGUAGE plpgsql
STABLE
AS $function$
DECLARE
  c        record;
  z        record;
  v_q      numeric;
  v_t      numeric;
  v_mu     numeric;
  v_proc   numeric;
  v_tramo  numeric;
  v_listo  boolean;
  v_i      integer;
BEGIN
  SELECT coalesce(dm.max_minutos, 120)::numeric AS max_min
    INTO c
    FROM (SELECT p_escenario AS e) x
    LEFT JOIN demoras_modelo dm ON dm.escenario_id = x.e;

  -- Mismos MATERIALIZED y columnas CALIFICADAS que el original: la
  -- funcion es plpgsql y sus OUT params se llaman zona_id/tipo_servicio,
  -- asi que una referencia sin calificar es ambigua y revienta en
  -- RUNTIME (el CREATE pasa sin ruido). Ver el comentario extenso del
  -- original.
  FOR z IN
    WITH ap AS MATERIALIZED (
      SELECT a.zona_id, a.tipo_servicio, a.r_j, a.mu_j
      FROM demoras_aportes_lab(p_escenario, p_fecha, p_estadistico, p_nivel) a
    ),
    ini AS (
      SELECT ap.zona_id, ap.tipo_servicio, sum(ap.mu_j) AS mu
      FROM ap WHERE ap.r_j <= 0
      GROUP BY ap.zona_id, ap.tipo_servicio
    ),
    tot AS (
      SELECT ap.zona_id, ap.tipo_servicio, count(*) AS n
      FROM ap GROUP BY ap.zona_id, ap.tipo_servicio
    ),
    ev AS (
      SELECT g.zona_id, g.tipo_servicio,
             array_agg(g.r  ORDER BY g.r) AS rs,
             array_agg(g.mu ORDER BY g.r) AS mus
      FROM (
        SELECT ap.zona_id, ap.tipo_servicio, ap.r_j AS r, sum(ap.mu_j) AS mu
        FROM ap WHERE ap.r_j > 0
        GROUP BY ap.zona_id, ap.tipo_servicio, ap.r_j
      ) g
      GROUP BY g.zona_id, g.tipo_servicio
    )
    SELECT u.zona_id, u.tipo,
           coalesce(q.cola_efectiva, 0)             AS cola,
           coalesce(ini.mu, 0)                      AS mu_inicial,
           coalesce(tot.n, 0)                       AS n_moviles,
           coalesce(ev.rs,  ARRAY[]::numeric[])     AS rs,
           coalesce(ev.mus, ARRAY[]::numeric[])     AS mus
    FROM (
      SELECT DISTINCT mz.zona_id, mz.tipo_de_servicio AS tipo
      FROM moviles_zonas mz
      WHERE mz.escenario_id = p_escenario
        AND coalesce(mz.activa, true)
        AND mz.tipo_de_servicio IN ('URGENTE','NOCTURNO','SERVICE')
    ) u
    LEFT JOIN demoras_cola(p_escenario, p_fecha, p_corrida_at) q
           ON q.zona_id = u.zona_id AND q.tipo_servicio = u.tipo
    LEFT JOIN ini ON ini.zona_id = u.zona_id AND ini.tipo_servicio = u.tipo
    LEFT JOIN tot ON tot.zona_id = u.zona_id AND tot.tipo_servicio = u.tipo
    LEFT JOIN ev  ON ev.zona_id  = u.zona_id AND ev.tipo_servicio  = u.tipo
  LOOP
    v_q     := z.cola + 1;
    v_t     := 0;
    v_listo := false;
    tramos  := 0;
    v_mu    := z.mu_inicial;

    moviles_considerados := z.n_moviles;
    capacidad_inicial    := round(v_mu, 6);

    FOR v_i IN 1 .. coalesce(array_length(z.rs, 1), 0) LOOP
      v_tramo := z.rs[v_i] - v_t;
      v_proc  := v_tramo * v_mu;

      IF v_mu > 0 AND v_q <= v_proc THEN
        demora_cruda := v_t + v_q / v_mu;
        tramos  := tramos + 1;
        v_listo := true;
        EXIT;
      END IF;

      v_q     := v_q - v_proc;
      v_t     := z.rs[v_i];
      v_mu    := v_mu + z.mus[v_i];
      tramos  := tramos + 1;
    END LOOP;

    capacidad_final := round(v_mu, 6);

    IF NOT v_listo THEN
      IF v_mu <= 0 THEN
        demora_cruda  := c.max_min;
        sin_capacidad := true;
      ELSE
        demora_cruda  := v_t + v_q / v_mu;
        tramos        := tramos + 1;
        sin_capacidad := false;
      END IF;
    ELSE
      sin_capacidad := false;
    END IF;

    zona_id          := z.zona_id;
    tipo_servicio    := z.tipo;
    cola_por_delante := z.cola;
    RETURN NEXT;
  END LOOP;
END;
$function$;

-- ─── 4. El corazon: la foto de TODAS las variantes de una corrida ────
-- Lee las filas que el motor YA escribio (commiteadas) y calcula que
-- hubiera publicado cada variante:
--   * fases de arranque: se DERIVAN de la cruda grabada. El motor
--     calculo `espera + (cola+1) x ritmo_motor`, asi que la variante es
--     `cruda_motor + (cola+1) x (ritmo_var - ritmo_motor)` -- exacto, y
--     sin tocar el espera_minutos persistido (redondeado a 0,1'). Toda
--     variante que no cambia el ritmo reproduce el numero del motor bit
--     a bit.
--   * modelo normal: cruda prefactor (derivada o re-simulada) x factor
--     de la variante; el techo queda en el techo (sin factor), igual
--     que en el motor.
--   * acabado: demoras_acabado con el piso/escalon/paso de la variante
--     y el prev DE LA PROPIA variante (su escalera), con los mismos
--     bypass del motor (cambio de moviles activos / entrada a TRANSITO).
--     Si la variante no tiene fila previa hoy (primer dia, o un hueco
--     por un job caido) se cae al prev DEL MOTOR: asi la escalera se
--     re-sincroniza en vez de quedar anclada.
CREATE OR REPLACE FUNCTION demoras_variantes_snapshot(p_corrida_at timestamptz, p_escenario integer)
RETURNS integer
LANGUAGE plpgsql
AS $function$
DECLARE
  m       demoras_modelo%ROWTYPE;
  v_fecha date;
  v_ini   timestamptz;
  v_n     integer := 0;
BEGIN
  SELECT * INTO m FROM demoras_modelo WHERE escenario_id = p_escenario;
  IF NOT FOUND OR m.modelo <> 'CONSUMO_TRAMOS' THEN
    RETURN 0;  -- el laboratorio solo sabe hablar el modelo nuevo
  END IF;
  IF NOT EXISTS (SELECT 1 FROM demoras_variantes WHERE activa) THEN
    RETURN 0;
  END IF;
  -- Guarda de version: si la corrida se calculo con OTRA parametria, el
  -- laboratorio no puede espejarla (leeria las perillas de hoy contra un
  -- calculo de ayer). Se saltea; el backfill tampoco la vuelve a ofrecer.
  IF NOT EXISTS (
    SELECT 1 FROM demoras_calculadas
     WHERE corrida_at = p_corrida_at AND escenario = p_escenario
       AND modelo_version = m.version
  ) THEN
    RETURN 0;
  END IF;

  v_fecha := (p_corrida_at AT TIME ZONE 'America/Montevideo')::date;
  v_ini   := v_fecha::timestamp AT TIME ZONE 'America/Montevideo';

  WITH vs AS (
    SELECT * FROM demoras_variantes WHERE activa
  ),
  base AS (
    SELECT dc.*
    FROM demoras_calculadas dc
    WHERE dc.corrida_at = p_corrida_at AND dc.escenario = p_escenario
  ),
  -- Que combinaciones (estadistico, nivel) hay que RE-SIMULAR: las que
  -- difieren de lo que el motor ya calculo. Todo lo demas se deriva.
  needs AS (
    SELECT DISTINCT coalesce(v.estadistico, m.estadistico) AS est,
                    coalesce(v.nivel_ritmo, 'CASCADA')     AS niv
    FROM vs v
    WHERE ROW(coalesce(v.estadistico, m.estadistico), coalesce(v.nivel_ritmo, 'CASCADA'))
          IS DISTINCT FROM ROW(m.estadistico, 'CASCADA')
  ),
  lab AS (
    SELECT n.est, n.niv, t.zona_id AS z, t.tipo_servicio AS t_srv,
           t.demora_cruda  AS cruda_prefactor,
           t.sin_capacidad AS techo
    FROM needs n
    CROSS JOIN LATERAL demoras_consumo_tramos_lab(p_escenario, v_fecha, p_corrida_at, n.est, n.niv) t
  ),
  -- El ritmo a nivel zona, SOLO si alguna variante lo pide (el generador
  -- vacio garantiza que la funcion ni se llama).
  zrit AS (
    SELECT z.zona_id AS z, z.tipo_servicio AS t_srv, z.ritmo_media, z.ritmo_mediana, z.ritmo_p75, z.ritmo_p90
    FROM (SELECT 1 FROM needs WHERE niv = 'ZONA' LIMIT 1) g
    CROSS JOIN LATERAL demoras_ritmo_zona_lab(p_escenario, v_fecha) z
  ),
  -- La corrida anterior DEL MOTOR: para los bypass del suavizado (son
  -- condiciones sobre el estado del mundo, no sobre la variante) y como
  -- prev de respaldo cuando la variante no tiene fila previa hoy.
  prev_motor AS (
    SELECT DISTINCT ON (zona_id, tipo_servicio)
           zona_id AS z, tipo_servicio AS t_srv,
           moviles_activos AS prev_mov, arranque_fase AS prev_fase,
           demora_suavizada AS prev_suav_motor
    FROM demoras_calculadas
    WHERE escenario = p_escenario
      AND corrida_at >= v_ini AND corrida_at < p_corrida_at
    ORDER BY zona_id, tipo_servicio, corrida_at DESC
  ),
  armado AS (
    SELECT b.zona_id, b.tipo_servicio, b.arranque_fase,
           b.moviles_activos, b.demora_as400, b.demora_cruda AS cruda_motor,
           b.ritmo_usado AS ritmo_motor,
           b.pendientes_asignados, b.pendientes_sin_asignar,
           coalesce(b.cola_por_delante,
                    b.pendientes_asignados + b.pendientes_sin_asignar, 0) AS cola_delante,
           v.id        AS variante_id,
           v.suavizado AS suav_on,
           coalesce(v.factor,          m.factor_calibracion, 1.0) AS factor_eff,
           coalesce(v.escalon_minutos, m.escalon_minutos)         AS escalon_eff,
           coalesce(v.min_minutos,     m.min_minutos)             AS min_eff,
           coalesce(v.suavizado_paso,  m.subida_max)              AS subida_eff,
           coalesce(v.suavizado_paso,  m.bajada_max)              AS bajada_eff,
           -- El ritmo con el que ESTA variante mira la zona (formulas de
           -- arranque y respaldo). Fallback: el que uso el motor.
           CASE WHEN coalesce(v.nivel_ritmo, 'CASCADA') = 'ZONA' THEN
             coalesce(CASE coalesce(v.estadistico, m.estadistico)
                        WHEN 'MEDIA' THEN z.ritmo_media
                        WHEN 'P75'   THEN z.ritmo_p75
                        WHEN 'P90'   THEN z.ritmo_p90
                        ELSE z.ritmo_mediana END, b.ritmo_usado)
           ELSE
             coalesce(CASE coalesce(v.estadistico, m.estadistico)
                        WHEN 'MEDIA' THEN b.ritmo_media
                        WHEN 'P75'   THEN b.ritmo_p75
                        WHEN 'P90'   THEN b.ritmo_p90
                        ELSE b.ritmo_mediana END, b.ritmo_usado)
           END AS ritmo_var,
           -- Cruda PREFACTOR del modelo normal para el combo de la
           -- variante + si era el techo interno (factor NO aplica ahi).
           CASE WHEN ROW(coalesce(v.estadistico, m.estadistico), coalesce(v.nivel_ritmo, 'CASCADA'))
                     IS NOT DISTINCT FROM ROW(m.estadistico, 'CASCADA')
                THEN coalesce(b.capacidad_final, 0) <= 0
                ELSE coalesce(l.techo, true)
           END AS es_techo,
           CASE WHEN ROW(coalesce(v.estadistico, m.estadistico), coalesce(v.nivel_ritmo, 'CASCADA'))
                     IS NOT DISTINCT FROM ROW(m.estadistico, 'CASCADA')
                THEN b.demora_cruda / nullif(coalesce(m.factor_calibracion, 1.0), 0)
                ELSE l.cruda_prefactor
           END AS cruda_pre,
           pm.prev_mov, pm.prev_fase, pm.prev_suav_motor
    FROM base b
    CROSS JOIN vs v
    LEFT JOIN lab l  ON l.est = coalesce(v.estadistico, m.estadistico)
                    AND l.niv = coalesce(v.nivel_ritmo, 'CASCADA')
                    AND l.z = b.zona_id AND l.t_srv = b.tipo_servicio
    LEFT JOIN zrit z ON z.z = b.zona_id AND z.t_srv = b.tipo_servicio
    LEFT JOIN prev_motor pm ON pm.z = b.zona_id AND pm.t_srv = b.tipo_servicio
  ),
  -- La cruda de cada variante. Las ramas del arranque se DERIVAN de la
  -- cruda del motor mas el delta del ritmo: para toda variante que no
  -- toca el ritmo el delta es 0 y el numero es el del motor, exacto.
  calc AS (
    SELECT a.*,
           CASE
             WHEN a.arranque_fase = 'PREDICTIVO'
               THEN a.cruda_motor + (a.cola_delante + 1) * (a.ritmo_var - a.ritmo_motor)
             WHEN a.arranque_fase = 'GRACIA_VENCIDA'
               THEN a.cruda_motor          -- el techo, invariante a las perillas
             WHEN a.arranque_fase IS NULL
                  AND m.arranque_sin_movil_modo IN ('DESPACHO', 'DESPACHO_MAS_COLA', 'PREDICTIVO')
                  AND a.moviles_activos <= 0
                  AND a.demora_as400 IS NOT NULL
                  AND (m.arranque_sin_movil_modo IN ('DESPACHO_MAS_COLA', 'PREDICTIVO')
                       OR (a.pendientes_asignados + a.pendientes_sin_asignar) = 0)
               THEN a.cruda_motor
                    + CASE WHEN m.arranque_sin_movil_modo IN ('DESPACHO_MAS_COLA', 'PREDICTIVO')
                           THEN a.cola_delante * (a.ritmo_var - a.ritmo_motor)
                           ELSE 0 END
             WHEN a.es_techo THEN m.max_minutos::numeric
             ELSE a.cruda_pre * a.factor_eff
           END AS cruda_var
    FROM armado a
  ),
  -- La corrida anterior DE ESTA VARIANTE hoy: su propia escalera. Si no
  -- la hay (primer dia, hueco del job), se usa la del motor.
  con_prev AS (
    SELECT c.*, coalesce(pv.demora_suavizada, c.prev_suav_motor) AS prev_suav
    FROM calc c
    LEFT JOIN LATERAL (
      SELECT dv.demora_suavizada
      FROM demoras_calculadas_variantes dv
      WHERE dv.escenario = p_escenario
        AND dv.zona_id = c.zona_id AND dv.tipo_servicio = c.tipo_servicio
        AND dv.variante_id = c.variante_id
        AND dv.corrida_at >= v_ini AND dv.corrida_at < p_corrida_at
      ORDER BY dv.corrida_at DESC LIMIT 1
    ) pv ON true
  ),
  final AS (
    SELECT c.*, f.suavizada, f.informada
    FROM con_prev c
    CROSS JOIN LATERAL demoras_acabado(
      round(c.cruda_var, 2),
      CASE WHEN NOT c.suav_on THEN NULL
           WHEN (m.suavizado_bypass_cambio_capacidad
                 AND c.prev_mov IS DISTINCT FROM c.moviles_activos)
             OR (c.arranque_fase = 'TRANSITO'
                 AND c.prev_fase IS DISTINCT FROM 'TRANSITO')
           THEN NULL
           ELSE c.prev_suav END,
      c.min_eff, m.max_minutos, c.subida_eff, c.bajada_eff, c.escalon_eff
    ) f
  )
  INSERT INTO demoras_calculadas_variantes (
    corrida_at, escenario, zona_id, tipo_servicio, variante_id,
    demora_cruda, demora_suavizada, demora_informada, ritmo_usado, calculado_at
  )
  SELECT p_corrida_at, p_escenario, x.zona_id, x.tipo_servicio, x.variante_id,
         round(x.cruda_var, 2), x.suavizada, x.informada, x.ritmo_var, now()
  FROM final x
  ON CONFLICT (corrida_at, escenario, zona_id, tipo_servicio, variante_id) DO UPDATE SET
    demora_cruda     = EXCLUDED.demora_cruda,
    demora_suavizada = EXCLUDED.demora_suavizada,
    demora_informada = EXCLUDED.demora_informada,
    ritmo_usado      = EXCLUDED.ritmo_usado,
    calculado_at     = EXCLUDED.calculado_at;

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$function$;

COMMENT ON FUNCTION demoras_variantes_snapshot(timestamptz, integer) IS
  'Calcula que hubiera publicado CADA variante del laboratorio en la corrida dada (ya commiteada) y lo persiste en demoras_calculadas_variantes. La dispara demoras_variantes_backfill desde el job demoras-variantes; el motor NO la llama. Ver docs/sqls/2026-08-07-laboratorio-variantes.sql.';

-- ─── 5. El backfill: las corridas RECIENTES pendientes, EN ORDEN ─────
-- Procesa las corridas de los ultimos p_minutos_max que todavia no
-- tienen variantes, de la mas vieja a la mas nueva (la escalera propia
-- de cada variante depende de la corrida anterior, asi que el orden
-- importa). Toma un advisory lock PROPIO -- distinto del que serializa
-- el motor: dos pasadas del laboratorio no se pisan, y el motor nunca
-- espera al laboratorio.
--
-- La ventana en MINUTOS (no en dias) es deliberada: ver el comentario
-- del encabezado sobre por que una corrida vieja no se puede re-simular
-- (el estado del mundo ya no existe). Con el job cada minuto, el
-- desfase tipico es de segundos; 15 minutos de ventana cubren una o dos
-- pasadas perdidas sin llegar nunca a inventar.
DROP FUNCTION IF EXISTS demoras_variantes_backfill(integer, integer);

CREATE OR REPLACE FUNCTION demoras_variantes_backfill(p_minutos_max integer DEFAULT 15, p_max_corridas integer DEFAULT 6)
RETURNS integer
LANGUAGE plpgsql
AS $function$
DECLARE
  r          record;
  v_corridas integer := 0;
BEGIN
  IF NOT pg_try_advisory_xact_lock(2180637406::bigint) THEN
    RAISE NOTICE 'demoras_variantes_backfill: ya hay una pasada en curso, salteando';
    RETURN 0;
  END IF;

  FOR r IN
    SELECT dc.escenario, dc.corrida_at
    FROM (
      SELECT DISTINCT d.escenario, d.corrida_at
      FROM demoras_calculadas d
      JOIN demoras_modelo dm ON dm.escenario_id = d.escenario
                            AND dm.version = d.modelo_version
                            AND dm.modelo = 'CONSUMO_TRAMOS'
      WHERE d.corrida_at >= now() - make_interval(mins => p_minutos_max)
        AND NOT EXISTS (
          SELECT 1 FROM demoras_calculadas_variantes v
          WHERE v.escenario = d.escenario AND v.corrida_at = d.corrida_at
        )
    ) dc
    ORDER BY dc.corrida_at, dc.escenario
    LIMIT p_max_corridas
  LOOP
    PERFORM demoras_variantes_snapshot(r.corrida_at, r.escenario);
    v_corridas := v_corridas + 1;
  END LOOP;

  RETURN v_corridas;
END;
$function$;

COMMENT ON FUNCTION demoras_variantes_backfill(integer, integer) IS
  'Procesa las corridas de los ultimos p_minutos_max que todavia no tienen variantes, de la mas vieja a la mas nueva (la escalera propia depende de la corrida anterior). La ventana es en MINUTOS a proposito: una corrida vieja no se puede re-simular porque el estado del mundo ya no existe (medido 7/8: rellenar ayer daba a las variantes re-simuladas ~105 minutos de promesa contra 84 del campeon). Lock propio: nunca espera ni bloquea al motor. La llama el job demoras-variantes cada minuto.';

-- ─── 6. pg_cron: el job del laboratorio + la retencion ───────────────

DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- El laboratorio: cada minuto agarra lo que el motor acaba de dejar.
    -- Cada minuto y no cada 5 porque las variantes que re-simulan el
    -- ritmo necesitan el estado del mundo del momento: cuanto menor el
    -- desfase, mas fiel el espejo. Una pasada sin trabajo cuesta una
    -- consulta con anti-join sobre indice.
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'demoras-variantes';
    PERFORM cron.schedule(
      'demoras-variantes',
      '* * * * *',
      $job$SELECT demoras_variantes_backfill(15, 6)$job$
    );

    -- Retencion: 30 dias.
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'demoras-variantes-limpieza';
    PERFORM cron.schedule(
      'demoras-variantes-limpieza',
      '50 6 * * *',  -- 03:50 Montevideo, despues del snapshot de activaciones
      $job$DELETE FROM demoras_calculadas_variantes WHERE corrida_at < now() - interval '30 days'$job$
    );
  END IF;
END
$do$;
