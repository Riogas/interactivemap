-- =====================================================================
-- demoras_servidores — a que hora queda libre cada movil de la zona
-- Fecha: 2026-07-31 | Idempotente
--
-- El corazon del modelo del proximo hueco:
--
--   libre_en(movil) = (pedidos pendientes que tiene asignados) x (su ritmo)
--
-- La carga se cuenta en TODAS las zonas, no solo en esta. El movil es un
-- solo camion: si tiene trabajo en otro lado, ese trabajo tambien lo ocupa.
-- Aca muere el doble castigo del prorrateo: no hay que repartir al movil
-- entre sus zonas con una suposicion, porque los pedidos ya asignados
-- dicen exactamente donde esta su trabajo.
--
-- APROXIMACION DOCUMENTADA: un movil que lleva pedidos de mas de un tipo
-- (2 URGENTE + 1 SERVICE) se resuelve con el ritmo del tipo que se esta
-- calculando, no con uno distinto por pedido. Contar el ritmo real de cada
-- pedido segun su tipo es posible y queda anotado como mejora; hoy se
-- prefiere que la funcion sea legible y auditable.
--
-- transito_modo decide que hacer con un movil que en esta zona es de
-- transito, o sea que pasa por ahi pero no es su zona (DEMORA_MODELO.md 8.1):
--   IGUAL          compite como si fuera prioridad. Optimista: promete un
--                  movil que quiza no va.
--   CASTIGO        se le suman transito_castigo_minutos de desvio.
--   ALPHA          se le estira el libre_en dividiendo por peso_transito_alpha
--                  (0.3 -> tarda 3,3 veces mas en "estar disponible" para esta
--                  zona). Reusa el parametro que ya existe, pero ojo: alpha se
--                  diseno para repartir capacidad, no para estirar tiempos.
--   SOLO_SI_NO_HAY entra solo si ninguna prioridad de la zona se libera
--                  dentro de transito_margen_minutos del mejor transito.
--                  Es lo mas parecido a como trabaja la operacion.
--
-- Un movil descartado se DEVUELVE igual, con descartado=true, en vez de
-- filtrarse: quien audite una zona tiene que poder ver que habia un
-- transito disponible y por que no se uso.
-- =====================================================================
CREATE OR REPLACE FUNCTION demoras_servidores(
  p_escenario integer,
  p_fecha     date
)
RETURNS TABLE (
  zona_id       integer,
  tipo_servicio text,
  movil         integer,
  carga         integer,
  ritmo         numeric,
  ritmo_origen  text,
  libre_en      numeric,
  es_transito   boolean,
  descartado    boolean
)
LANGUAGE sql
STABLE
AS $fn$
  WITH cfg AS (
    SELECT coalesce(dm.transito_modo, 'SOLO_SI_NO_HAY')       AS modo,
           coalesce(dm.transito_castigo_minutos, 20)::numeric AS castigo,
           coalesce(dm.transito_margen_minutos, 15)::numeric  AS margen,
           coalesce(dm.estadistico, 'MEDIANA')                AS estadistico,
           coalesce(dm.ritmo_default_minutos, 30)::numeric    AS ritmo_defecto
      FROM (SELECT p_escenario AS e) x
      LEFT JOIN demoras_modelo dm ON dm.escenario_id = x.e
  ),
  alpha AS (
    SELECT coalesce((SELECT es.peso_transito_alpha FROM escenario_settings es
                      WHERE es.escenario_id = p_escenario), 0.3)::numeric AS a
  ),
  -- Moviles ACTIVOS con asignacion vigente a cada (zona, tipo).
  asign AS (
    SELECT mz.zona_id,
           mz.tipo_de_servicio AS tipo,
           mz.movil_id::integer AS movil,
           (mz.prioridad_o_transito <> 1) AS es_transito
    FROM moviles_zonas mz
    JOIN moviles_dia md
      ON md.movil_id     = mz.movil_id::integer
     AND md.escenario_id = mz.escenario_id
     AND md.fecha        = p_fecha
    WHERE mz.escenario_id = p_escenario
      AND coalesce(mz.activa, true)
      AND md.activo
      AND mz.tipo_de_servicio IN ('URGENTE','NOCTURNO','SERVICE')
  ),
  -- Carga real de cada movil: pendientes asignados en TODAS las zonas y de
  -- TODOS los tipos. Un asignado cuenta siempre (regla canonica de la
  -- ventana SA), asi que aca no hay filtro horario.
  carga_movil AS (
    SELECT p.movil, count(*)::integer AS n
    FROM (
      SELECT movil FROM pedidos
       WHERE escenario = p_escenario AND estado_nro = 1
         AND movil IS NOT NULL AND movil <> 0
         AND COALESCE(fch_para, (fch_hora_para AT TIME ZONE 'America/Montevideo')::date) = p_fecha
      UNION ALL
      SELECT movil FROM services
       WHERE escenario = p_escenario AND estado_nro = 1
         AND movil IS NOT NULL AND movil <> 0
         AND COALESCE(fch_para, (fch_hora_para AT TIME ZONE 'America/Montevideo')::date) = p_fecha
    ) p
    GROUP BY p.movil
  ),
  -- Ritmo de la ZONA: el blend ponderado de toda la cascada. Es el fallback
  -- para un movil sin historial propio.
  rit_zona AS (
    SELECT r.zona_id, r.tipo_servicio, r.ritmo_media, r.ritmo_mediana,
           r.ritmo_p75, r.ritmo_p90
    FROM demoras_ritmo(p_escenario, p_fecha) r
  ),
  -- Ritmo PROPIO de cada movil. Es el que manda: el pedido nuevo va al que
  -- se libera primero, y sin ritmo por movil dos moviles solo se
  -- diferenciarian por cuantos pedidos llevan.
  rit_movil AS (
    SELECT m.movil, m.tipo_servicio, m.ritmo_media, m.ritmo_mediana,
           m.ritmo_p75, m.ritmo_p90
    FROM demoras_ritmo_movil(p_escenario, p_fecha) m
  ),
  crudo AS (
    SELECT a.zona_id, a.tipo, a.movil, a.es_transito,
           coalesce(cm.n, 0) AS carga,
           -- Cascada de tres pasos, en este orden:
           --   1. El ritmo PROPIO del movil (chofer o movil, segun resolvio
           --      demoras_ritmo_movil).
           --   2. Si no tiene historial propio, el de la ZONA (blend).
           --   3. Si la zona tampoco tiene, el piso configurado.
           -- El piso no es opcional: con ritmo NULL, libre_en seria NULL y el
           -- movil desapareceria de la simulacion sin dejar rastro.
           coalesce(
             CASE c.estadistico
               WHEN 'MEDIA' THEN rm.ritmo_media
               WHEN 'P75'   THEN rm.ritmo_p75
               WHEN 'P90'   THEN rm.ritmo_p90
               ELSE rm.ritmo_mediana
             END,
             CASE c.estadistico
               WHEN 'MEDIA' THEN rz.ritmo_media
               WHEN 'P75'   THEN rz.ritmo_p75
               WHEN 'P90'   THEN rz.ritmo_p90
               ELSE rz.ritmo_mediana
             END,
             c.ritmo_defecto) AS ritmo,
           -- De donde salio el ritmo de ESTE movil. Sin esto no se puede
           -- contestar "por que este movil se libera antes que el otro".
           CASE
             WHEN (CASE c.estadistico
                     WHEN 'MEDIA' THEN rm.ritmo_media
                     WHEN 'P75'   THEN rm.ritmo_p75
                     WHEN 'P90'   THEN rm.ritmo_p90
                     ELSE rm.ritmo_mediana END) IS NOT NULL THEN 'MOVIL'
             WHEN (CASE c.estadistico
                     WHEN 'MEDIA' THEN rz.ritmo_media
                     WHEN 'P75'   THEN rz.ritmo_p75
                     WHEN 'P90'   THEN rz.ritmo_p90
                     ELSE rz.ritmo_mediana END) IS NOT NULL THEN 'ZONA'
             ELSE 'DEFECTO'
           END AS ritmo_origen
    FROM asign a
    CROSS JOIN cfg c
    LEFT JOIN carga_movil cm ON cm.movil = a.movil
    LEFT JOIN rit_zona  rz ON rz.zona_id = a.zona_id AND rz.tipo_servicio = a.tipo
    LEFT JOIN rit_movil rm ON rm.movil   = a.movil   AND rm.tipo_servicio = a.tipo
  ),
  con_libre AS (
    SELECT k.*,
           round(
             ((k.carga * k.ritmo)
              + CASE WHEN k.es_transito AND c.modo = 'CASTIGO' THEN c.castigo ELSE 0 END)
             * CASE WHEN k.es_transito AND c.modo = 'ALPHA' AND al.a > 0
                    THEN 1 / al.a ELSE 1 END
           , 2) AS libre_en
    FROM crudo k CROSS JOIN cfg c CROSS JOIN alpha al
  ),
  -- Mejor prioridad de cada (zona, tipo): la referencia contra la que se
  -- mide si vale la pena mandar un transito.
  mejor_prioridad AS (
    SELECT zona_id, tipo, min(libre_en) AS libre_min
    FROM con_libre
    WHERE NOT es_transito
    GROUP BY zona_id, tipo
  )
  SELECT l.zona_id, l.tipo, l.movil, l.carga, l.ritmo, l.ritmo_origen,
         l.libre_en, l.es_transito,
         (l.es_transito
          AND c.modo = 'SOLO_SI_NO_HAY'
          AND mp.libre_min IS NOT NULL
          AND mp.libre_min <= l.libre_en + c.margen) AS descartado
  FROM con_libre l
  CROSS JOIN cfg c
  LEFT JOIN mejor_prioridad mp ON mp.zona_id = l.zona_id AND mp.tipo = l.tipo;
$fn$;

COMMENT ON FUNCTION demoras_servidores(integer, date) IS
  'Tiempo de liberacion de cada movil ACTIVO por (zona, tipo): libre_en = carga x ritmo, con la carga contada en TODAS las zonas porque el movil es un solo camion. Es el punto exacto donde el modelo deja de prorratear: los pedidos ya asignados dicen donde esta el trabajo, no hace falta suponerlo. transito_modo (IGUAL / CASTIGO / ALPHA / SOLO_SI_NO_HAY) decide como compite un movil que en esa zona es de transito; el descartado se devuelve igual con descartado=true para que se pueda auditar por que no se uso. Aproximacion documentada: un movil con pedidos de varios tipos usa el ritmo del tipo que se esta calculando.';
