-- =====================================================================
-- LABORATORIO v2: las variantes pasan a calcularse con el SIMULADOR PURO
-- Fecha: 2026-08-07 | Idempotente
--
-- La v1 (misma manana) calculaba cada variante leyendo estado vivo
-- (demoras_consumo_tramos_lab -> demoras_aportes_lab -> pedidos,
-- moviles_dia, metricas_cumplimiento). Eso ataba el laboratorio a los
-- ultimos 15 minutos: una corrida vieja ya no se podia espejar porque
-- el mundo habia cambiado.
--
-- Con la caja negra + el simulador puro eso se termina:
--   * las variantes se calculan leyendo SOLO tablas persistidas;
--   * se puede reprocesar cualquier dia capturado, cuantas veces se
--     quiera, con cualquier combinacion -- que es exactamente lo que
--     se pidio ("no tener que hacer retro-backtest porque ya tendriamos
--     la situacion real de cada dia persistida");
--   * agregar una variante nueva no obliga a esperar dias: se la
--     reprocesa sobre toda la historia capturada y en minutos hay
--     veredicto.
--
-- Secciones:
--   1. demoras_variante_perillas: catalogo -> perillas del simulador
--   2. demoras_variantes_snapshot v2 (sobre el simulador)
--   3. demoras_variantes_reprocesar: un rango de dias, N variantes
--   4. demoras_lab_jobs: la cola de reprocesos de la pantalla
-- =====================================================================

-- ─── 1. Del catalogo a las perillas del simulador ────────────────────
CREATE OR REPLACE FUNCTION demoras_variante_perillas(p_variante smallint)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $function$
  SELECT jsonb_strip_nulls(jsonb_build_object(
           'estadistico',        v.estadistico,
           'nivel_ritmo',        v.nivel_ritmo,
           'factor_calibracion', v.factor,
           'escalon_minutos',    v.escalon_minutos,
           'min_minutos',        v.min_minutos,
           'subida_max',         v.suavizado_paso,
           'bajada_max',         v.suavizado_paso
         ))
         -- `suavizado` va SIEMPRE (es NOT NULL): un false tiene que
         -- pisar al modelo, y jsonb_strip_nulls no lo sacaria igual.
         || jsonb_build_object('suavizado', v.suavizado)
  FROM demoras_variantes v
  WHERE v.id = p_variante;
$function$;

COMMENT ON FUNCTION demoras_variante_perillas(smallint) IS
  'Traduce una fila del catalogo de variantes al jsonb de perillas que entiende demoras_simular_corrida. Los campos NULL se descartan: significan "como el modelo de esa corrida".';

-- ─── 2. El espejo de una corrida, ahora sobre el simulador ───────────
CREATE OR REPLACE FUNCTION demoras_variantes_snapshot(p_corrida_at timestamptz, p_escenario integer)
RETURNS integer
LANGUAGE plpgsql
AS $function$
DECLARE
  v          record;
  v_fecha    date;
  v_ini      timestamptz;
  v_prev     jsonb;
  v_n        integer := 0;
  v_paso     integer;
BEGIN
  -- Sin caja negra no hay simulacion posible.
  IF NOT EXISTS (SELECT 1 FROM demoras_corrida_meta
                  WHERE corrida_at = p_corrida_at AND escenario = p_escenario) THEN
    RETURN 0;
  END IF;

  v_fecha := (p_corrida_at AT TIME ZONE 'America/Montevideo')::date;
  v_ini   := v_fecha::timestamp AT TIME ZONE 'America/Montevideo';

  FOR v IN SELECT id FROM demoras_variantes WHERE activa ORDER BY id LOOP
    -- La escalera PROPIA de esta variante: su ultima corrida de hoy.
    -- Si no la tiene (primer dia, hueco), se cae a la del motor para
    -- re-sincronizar en vez de quedar anclada.
    SELECT coalesce(jsonb_object_agg(x.k, x.val), '{}'::jsonb) INTO v_prev
    FROM (
      SELECT dc.zona_id::text || '|' || dc.tipo_servicio AS k,
             to_jsonb(coalesce(dv.demora_suavizada, dc.demora_suavizada)) AS val
      FROM demoras_calculadas dc
      LEFT JOIN LATERAL (
        SELECT d2.demora_suavizada
        FROM demoras_calculadas_variantes d2
        WHERE d2.escenario = p_escenario AND d2.variante_id = v.id
          AND d2.zona_id = dc.zona_id AND d2.tipo_servicio = dc.tipo_servicio
          AND d2.corrida_at >= v_ini AND d2.corrida_at < p_corrida_at
        ORDER BY d2.corrida_at DESC LIMIT 1
      ) dv ON true
      WHERE dc.escenario = p_escenario
        AND dc.corrida_at = (
          SELECT max(d3.corrida_at) FROM demoras_calculadas d3
          WHERE d3.escenario = p_escenario AND d3.corrida_at >= v_ini
            AND d3.corrida_at < p_corrida_at)
    ) x;

    INSERT INTO demoras_calculadas_variantes (
      corrida_at, escenario, zona_id, tipo_servicio, variante_id,
      demora_cruda, demora_suavizada, demora_informada, ritmo_usado, calculado_at)
    SELECT p_corrida_at, p_escenario, s.zona_id, s.tipo_servicio, v.id,
           s.demora_cruda, s.demora_suavizada, s.demora_informada, NULL, now()
    FROM demoras_simular_corrida(p_corrida_at, p_escenario,
                                 demoras_variante_perillas(v.id::smallint), v_prev) s
    ON CONFLICT (corrida_at, escenario, zona_id, tipo_servicio, variante_id) DO UPDATE SET
      demora_cruda     = EXCLUDED.demora_cruda,
      demora_suavizada = EXCLUDED.demora_suavizada,
      demora_informada = EXCLUDED.demora_informada,
      calculado_at     = EXCLUDED.calculado_at;

    GET DIAGNOSTICS v_paso = ROW_COUNT;
    v_n := v_n + v_paso;
  END LOOP;

  RETURN v_n;
END;
$function$;

COMMENT ON FUNCTION demoras_variantes_snapshot(timestamptz, integer) IS
  'Espeja una corrida con todas las variantes activas usando el SIMULADOR PURO (solo caja negra). Cada variante arrastra su propia escalera; si le falta la corrida previa se cae a la del motor para re-sincronizar. Ver docs/sqls/2026-08-07-variantes-v2-simulador.sql.';

-- ─── 3. Reprocesar un rango de dias ──────────────────────────────────
-- El corazon del "reprocesar cada combinacion desde la pantalla".
-- Recorre las corridas capturadas de cada dia EN ORDEN (la escalera
-- depende del camino) y reescribe las filas de las variantes pedidas.
-- p_variantes NULL = todas las activas.
CREATE OR REPLACE FUNCTION demoras_variantes_reprocesar(
  p_escenario integer, p_desde date, p_hasta date, p_variantes integer[] DEFAULT NULL)
RETURNS TABLE(corridas integer, filas integer)
LANGUAGE plpgsql
AS $function$
DECLARE
  v      record;
  c      record;
  v_prev jsonb;
  v_cor  integer := 0;
  v_fil  integer := 0;
  v_paso integer;
  v_dia  date;
BEGIN
  FOR v IN
    SELECT id FROM demoras_variantes
    WHERE activa AND (p_variantes IS NULL OR id = ANY(p_variantes))
    ORDER BY id
  LOOP
    v_dia  := NULL;
    v_prev := '{}'::jsonb;

    FOR c IN
      SELECT m.corrida_at AS at, m.fecha_local AS dia
      FROM demoras_corrida_meta m
      WHERE m.escenario = p_escenario
        AND m.fecha_local BETWEEN p_desde AND p_hasta
      ORDER BY m.fecha_local, m.corrida_at
    LOOP
      -- La escalera se reinicia cada dia, igual que en el motor.
      IF v_dia IS DISTINCT FROM c.dia THEN
        v_dia  := c.dia;
        v_prev := '{}'::jsonb;
      END IF;

      INSERT INTO demoras_calculadas_variantes (
        corrida_at, escenario, zona_id, tipo_servicio, variante_id,
        demora_cruda, demora_suavizada, demora_informada, ritmo_usado, calculado_at)
      SELECT c.at, p_escenario, s.zona_id, s.tipo_servicio, v.id,
             s.demora_cruda, s.demora_suavizada, s.demora_informada, NULL, now()
      FROM demoras_simular_corrida(c.at, p_escenario,
                                   demoras_variante_perillas(v.id::smallint), v_prev) s
      ON CONFLICT (corrida_at, escenario, zona_id, tipo_servicio, variante_id) DO UPDATE SET
        demora_cruda     = EXCLUDED.demora_cruda,
        demora_suavizada = EXCLUDED.demora_suavizada,
        demora_informada = EXCLUDED.demora_informada,
        calculado_at     = EXCLUDED.calculado_at;

      GET DIAGNOSTICS v_paso = ROW_COUNT;
      v_fil := v_fil + v_paso;
      v_cor := v_cor + 1;

      -- El prev de la proxima corrida sale de lo que se acaba de escribir.
      SELECT coalesce(jsonb_object_agg(d.zona_id::text || '|' || d.tipo_servicio,
                                       to_jsonb(d.demora_suavizada)), '{}'::jsonb)
        INTO v_prev
        FROM demoras_calculadas_variantes d
       WHERE d.escenario = p_escenario AND d.corrida_at = c.at AND d.variante_id = v.id;
    END LOOP;
  END LOOP;

  corridas := v_cor;
  filas    := v_fil;
  RETURN NEXT;
END;
$function$;

COMMENT ON FUNCTION demoras_variantes_reprocesar(integer, date, date, integer[]) IS
  'Reprocesa las variantes indicadas sobre todas las corridas capturadas de un rango de dias, en orden cronologico (la escalera depende del camino y se reinicia cada dia). Es lo que permite dar de alta una variante nueva y tener veredicto sobre la historia en minutos, sin esperar dias.';

-- ─── 4. La cola de reprocesos de la pantalla ─────────────────────────
-- El reproceso de una semana son cientos de corridas: no puede colgar
-- de un request HTTP. La pantalla encola aca y consulta el progreso.
CREATE TABLE IF NOT EXISTS demoras_lab_jobs (
  id           bigserial PRIMARY KEY,
  escenario    integer     NOT NULL,
  desde        date        NOT NULL,
  hasta        date        NOT NULL,
  variantes    integer[],                   -- NULL = todas las activas
  estado       text        NOT NULL DEFAULT 'PENDIENTE'
               CHECK (estado IN ('PENDIENTE','CORRIENDO','LISTO','ERROR')),
  corridas     integer,
  filas        integer,
  error        text,
  pedido_por   text,
  creado_at    timestamptz NOT NULL DEFAULT now(),
  iniciado_at  timestamptz,
  terminado_at timestamptz
);

COMMENT ON TABLE demoras_lab_jobs IS
  'Cola de reprocesos del laboratorio pedidos desde la pantalla. Los toma el job demoras-lab-reproceso (cada minuto), de a uno.';

CREATE INDEX IF NOT EXISTS idx_lab_jobs_pendientes
  ON demoras_lab_jobs (estado, creado_at) WHERE estado IN ('PENDIENTE','CORRIENDO');

-- El worker: toma UN trabajo pendiente y lo corre. Lock propio para que
-- dos pasadas no tomen el mismo.
CREATE OR REPLACE FUNCTION demoras_lab_jobs_worker()
RETURNS integer
LANGUAGE plpgsql
AS $function$
DECLARE
  j   demoras_lab_jobs%ROWTYPE;
  res record;
BEGIN
  IF NOT pg_try_advisory_xact_lock(2180637408::bigint) THEN
    RETURN 0;
  END IF;

  SELECT * INTO j FROM demoras_lab_jobs
   WHERE estado = 'PENDIENTE' ORDER BY creado_at LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN RETURN 0; END IF;

  UPDATE demoras_lab_jobs SET estado = 'CORRIENDO', iniciado_at = now() WHERE id = j.id;

  BEGIN
    SELECT * INTO res FROM demoras_variantes_reprocesar(j.escenario, j.desde, j.hasta, j.variantes);
    UPDATE demoras_lab_jobs
       SET estado = 'LISTO', corridas = res.corridas, filas = res.filas, terminado_at = now()
     WHERE id = j.id;
  EXCEPTION WHEN OTHERS THEN
    UPDATE demoras_lab_jobs
       SET estado = 'ERROR', error = SQLERRM, terminado_at = now()
     WHERE id = j.id;
  END;

  RETURN 1;
END;
$function$;

COMMENT ON FUNCTION demoras_lab_jobs_worker() IS
  'Toma un reproceso pendiente de demoras_lab_jobs y lo ejecuta. Un fallo marca el trabajo como ERROR con su mensaje, sin tirar abajo la pasada.';

DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'demoras-lab-reproceso';
    PERFORM cron.schedule(
      'demoras-lab-reproceso',
      '* * * * *',
      $job$SELECT demoras_lab_jobs_worker()$job$
    );
  END IF;
END
$do$;
