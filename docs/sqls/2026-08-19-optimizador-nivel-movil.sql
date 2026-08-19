-- ====================================================================
-- El optimizador podia proponer algo que el catalogo no podia guardar
-- Fecha: 2026-08-19
-- ====================================================================
-- SINTOMA: el job `demoras-lab-optimizador-noct` (04:30) fallo en su PRIMERA
-- noche (19/8) despues de 612 s de busqueda:
--     ERROR: new row for relation "demoras_variantes" violates check
--            constraint "demoras_variantes_nivel_ritmo_check"
-- La transaccion entera se revirtio -> se perdio la propuesta del nocturno.
--
-- CAUSA: dos definiciones del mismo dominio que nunca se sincronizaron.
--   * demoras_variantes_optimizar barre el eje
--       ('nivel_ritmo', ARRAY['"CASCADA"','"ZONA"','"MOVIL"'])
--   * pero el catalogo tenia
--       CHECK (nivel_ritmo = ANY (ARRAY['CASCADA','ZONA']))
-- Cuando el descenso por coordenadas elige MOVIL como ganador, el alta
-- automatica en el catalogo revienta. Es un bug LATENTE desde que se escribio
-- el optimizador: nunca se disparo porque la busqueda del urgente siempre
-- convergio en ZONA. El nocturno, que es otro problema, eligio MOVIL.
--
-- POR QUE SE AMPLIA EL CHECK Y NO SE RECORTA EL EJE: MOVIL es una
-- configuracion evaluable de verdad, no un valor invalido. demoras_simular_ritmo
-- lo contempla explicitamente:
--       WHEN 'MOVIL' THEN x.nivel IN ('MOVIL','ZONA','GLOBAL')
-- o sea que el laboratorio sabe simular esa variante; lo unico que faltaba era
-- poder guardarla. Recortar el eje esconderia una parte del espacio de busqueda.
--
-- ALCANCE: `demoras_variantes` es catalogo del LABORATORIO. Verificado que
-- ninguna funcion del motor la lee -- las siete que la referencian son
-- demoras_lab_jobs_worker, demoras_variante_perillas, demoras_variantes_backfill,
-- demoras_variantes_evaluar, demoras_variantes_optimizar,
-- demoras_variantes_reprocesar y demoras_variantes_snapshot. demoras_calcular_run
-- NO esta en la lista. El motor no se entera de este cambio.
--
-- VERIFICACION PREVIA (dry run, revertido a proposito): se aplico este mismo
-- ALTER + un INSERT con nivel_ritmo='MOVIL' + RAISE -> el CHECK nuevo acepta
-- MOVIL y no quedo nada escrito. La prueba de fuego es la corrida real de
-- esta noche a las 04:30.
-- ====================================================================

ALTER TABLE demoras_variantes DROP CONSTRAINT demoras_variantes_nivel_ritmo_check;

ALTER TABLE demoras_variantes ADD CONSTRAINT demoras_variantes_nivel_ritmo_check
  CHECK (nivel_ritmo = ANY (ARRAY['CASCADA'::text, 'ZONA'::text, 'MOVIL'::text]));

COMMENT ON CONSTRAINT demoras_variantes_nivel_ritmo_check ON demoras_variantes IS
  'Los tres niveles que barre demoras_variantes_optimizar y que sabe simular '
  'demoras_simular_ritmo. Si se agrega un nivel al eje del optimizador, hay que '
  'agregarlo TAMBIEN aca o el alta automatica revienta y se pierde la corrida.';
