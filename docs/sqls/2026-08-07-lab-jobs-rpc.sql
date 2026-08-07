-- =====================================================================
-- RPCs de la cola de reprocesos del laboratorio (demoras_lab_jobs)
-- Fecha: 2026-08-07 | Idempotente | Segunda mitad del pedido de Diego
-- (audio 7/8): dar de alta una variante nueva y tener veredicto sobre la
-- historia YA, sin esperar dias a que se llene sola.
--
-- La tabla demoras_lab_jobs y su worker (pg_cron, cada minuto) ya existen
-- en docs/sqls/2026-08-07-variantes-v2-simulador.sql seccion 4. Lo que
-- falta -- y es lo que agrega este archivo -- es la puerta que usa la
-- pantalla: encolar un reproceso y mirar como viene.
--
-- Por que RPCs y no PostgREST directo contra la tabla: el alta tiene
-- reglas que no son de la tabla sino del negocio (un reproceso de una
-- semana son cientos de corridas simuladas de a una y en orden, asi que
-- de a UNO por escenario; un rango de un anio colgaria el worker por
-- horas), y esas reglas tienen que vivir del lado de la base, donde no
-- se pueden saltear desde el cliente.
--
--   1. metricas_lab_job_crear(p)   -> encola (o explica por que no)
--   2. metricas_lab_jobs_listar(p) -> los ultimos 10, para el progreso
-- =====================================================================

-- ─── 1. Alta de un reproceso ─────────────────────────────────────────
-- p: { escenario (req), desde? (YYYY-MM-DD), hasta? (YYYY-MM-DD;
--      default hoy Montevideo, desde default hasta-6),
--      variantes?: int[] (ausente o null = TODAS las activas),
--      pedido_por?: text }
--
-- Devuelve la fila creada como jsonb, o { error: '...' } cuando el
-- pedido no entra: el que llama muestra ese texto tal cual, asi que
-- esta escrito para que lo lea una persona, no para debug.
CREATE OR REPLACE FUNCTION metricas_lab_job_crear(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
AS $fn$
DECLARE
  v_esc       integer;
  v_desde     date;
  v_hasta     date;
  v_swap      date;
  v_dias      integer;
  v_vars_type text;
  v_vars      int[];
  v_faltan    int[];
  v_pedido    text;
  v_activo    bigint;
  v_row       demoras_lab_jobs%ROWTYPE;

  -- Tope del rango. El worker simula corrida por corrida y en orden (la
  -- escalera depende del camino recorrido): un mes ya son miles de
  -- simulaciones y es lo maximo que tiene sentido tener a alguien
  -- esperando frente a la pantalla.
  MAX_DIAS CONSTANT integer := 31;
BEGIN
  v_esc := nullif(p->>'escenario', '')::integer;
  IF v_esc IS NULL THEN
    RETURN jsonb_build_object('error', 'Falta el escenario del reproceso.');
  END IF;

  v_hasta := coalesce(nullif(p->>'hasta', '')::date,
                      (now() AT TIME ZONE 'America/Montevideo')::date);
  v_desde := coalesce(nullif(p->>'desde', '')::date, v_hasta - 6);

  -- Un rango al reves es un error de tipeo, no un pedido vacio: se da
  -- vuelta en vez de devolver cero corridas sin explicacion.
  IF v_desde > v_hasta THEN
    v_swap  := v_desde;
    v_desde := v_hasta;
    v_hasta := v_swap;
  END IF;

  v_dias := (v_hasta - v_desde) + 1;
  IF v_dias > MAX_DIAS THEN
    RETURN jsonb_build_object(
      'error', format('El rango no puede pasar de %s dias y pediste %s. Cortalo en tandas.',
                      MAX_DIAS, v_dias));
  END IF;

  v_vars_type := jsonb_typeof(p->'variantes');
  IF v_vars_type IS NULL OR v_vars_type = 'null' THEN
    v_vars := NULL;                            -- NULL = todas las activas
  ELSIF v_vars_type = 'array' THEN
    IF jsonb_array_length(p->'variantes') = 0 THEN
      -- Lista vacia NO es "todas": es un pedido sin sentido, y hacerlo
      -- pasar por "todas" seria reprocesar 13 variantes cuando el que
      -- pidio queria ninguna.
      RETURN jsonb_build_object('error', 'Elegi al menos una variante, o pedi todas.');
    END IF;
    SELECT array_agg(DISTINCT x::int) INTO v_vars
      FROM jsonb_array_elements_text(p->'variantes') AS x;
  ELSE
    RETURN jsonb_build_object('error', 'El parametro "variantes" tiene que ser una lista de ids o venir vacio.');
  END IF;

  -- Un id que no existe (o una variante dada de baja) no rompe nada pero
  -- deja un trabajo que termina LISTO sin haber hecho nada: mejor
  -- decirlo ahora.
  IF v_vars IS NOT NULL THEN
    SELECT array_agg(u) INTO v_faltan
      FROM unnest(v_vars) AS u
     WHERE NOT EXISTS (SELECT 1 FROM demoras_variantes c WHERE c.id = u AND c.activa);
    IF v_faltan IS NOT NULL THEN
      RETURN jsonb_build_object(
        'error', format('Variantes inexistentes o inactivas: %s.', array_to_string(v_faltan, ', ')));
    END IF;
  END IF;

  v_pedido := left(nullif(trim(coalesce(p->>'pedido_por', '')), ''), 120);

  -- Dos clics simultaneos (o dos pestanias) pasarian los dos el chequeo
  -- de "hay uno en curso" y encolarian dos reprocesos del mismo
  -- escenario. El lock serializa el alta por escenario y dura lo que la
  -- transaccion.
  PERFORM pg_advisory_xact_lock(hashtext('metricas_lab_job_crear'), v_esc);

  SELECT j.id INTO v_activo
    FROM demoras_lab_jobs j
   WHERE j.escenario = v_esc AND j.estado IN ('PENDIENTE', 'CORRIENDO')
   ORDER BY j.creado_at
   LIMIT 1;

  IF v_activo IS NOT NULL THEN
    RETURN jsonb_build_object(
      'error', format('Ya hay un reproceso en curso para este escenario (trabajo #%s). Espera a que termine.', v_activo),
      'job_id', v_activo);
  END IF;

  INSERT INTO demoras_lab_jobs (escenario, desde, hasta, variantes, pedido_por)
  VALUES (v_esc, v_desde, v_hasta, v_vars, v_pedido)
  RETURNING * INTO v_row;

  RETURN to_jsonb(v_row);
END
$fn$;

COMMENT ON FUNCTION metricas_lab_job_crear(jsonb) IS
  'Encola un reproceso del laboratorio en demoras_lab_jobs (lo toma el worker demoras-lab-reproceso cada minuto). Valida el rango (max 31 dias, lo da vuelta si viene al reves), los ids de variantes y que no haya otro reproceso en curso para el mismo escenario. Devuelve la fila creada, o {error} con un texto para mostrar en pantalla. Ver docs/sqls/2026-08-07-lab-jobs-rpc.sql.';

-- ─── 2. La cola, para mostrar el progreso ────────────────────────────
-- p: { escenario (req) }. Devuelve { escenario, jobs: [...] } con los
-- ultimos 10 trabajos del escenario, del mas nuevo al mas viejo.
CREATE OR REPLACE FUNCTION metricas_lab_jobs_listar(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
AS $fn$
DECLARE
  v_esc    integer;
  v_result jsonb;
BEGIN
  v_esc := nullif(p->>'escenario', '')::integer;
  IF v_esc IS NULL THEN
    RETURN jsonb_build_object('escenario', null, 'jobs', '[]'::jsonb);
  END IF;

  SELECT jsonb_build_object(
           'escenario', v_esc,
           'jobs', coalesce(jsonb_agg(
             -- to_jsonb(j) ya trae la fila entera; duracion_seg se agrega
             -- calculada porque el reloj vive en la base: un trabajo
             -- CORRIENDO se mide contra now() del servidor, no contra el
             -- reloj del navegador (que puede estar corrido).
             to_jsonb(j) || jsonb_build_object(
               'duracion_seg',
               CASE WHEN j.iniciado_at IS NOT NULL
                    THEN round(EXTRACT(EPOCH FROM (coalesce(j.terminado_at, now()) - j.iniciado_at))::numeric, 0)
               END)
             ORDER BY j.creado_at DESC), '[]'::jsonb))
    INTO v_result
    FROM (
      SELECT * FROM demoras_lab_jobs
       WHERE escenario = v_esc
       ORDER BY creado_at DESC
       LIMIT 10
    ) j;

  RETURN v_result;
END
$fn$;

COMMENT ON FUNCTION metricas_lab_jobs_listar(jsonb) IS
  'Los ultimos 10 reprocesos del laboratorio de un escenario, con estado, tiempos y duracion, para la lista de progreso de la card Laboratorio de variantes. Ver docs/sqls/2026-08-07-lab-jobs-rpc.sql.';

-- Los roles de Supabase pueden no existir en un Postgres pelado (harness
-- local, restore en otra VM): REVOKE/GRANT sobre un rol inexistente es un
-- error duro (42704), no un no-op, y rompe la idempotencia del archivo.
REVOKE EXECUTE ON FUNCTION metricas_lab_job_crear(jsonb)   FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION metricas_lab_jobs_listar(jsonb) FROM PUBLIC;
DO $do$
DECLARE
  r text;
  f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['metricas_lab_job_crear(jsonb)', 'metricas_lab_jobs_listar(jsonb)'] LOOP
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
        EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM %I', f, r);
      END IF;
    END LOOP;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
    END IF;
  END LOOP;
END
$do$;
