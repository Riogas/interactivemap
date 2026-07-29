#!/usr/bin/env bash
# Valida migraciones SQL contra un Postgres 15 descartable.
# Uso: scripts/sql-harness/run.sh migracion1.sql [migracion2.sql ...] --assert assert.sql
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
C=pgharness
trap 'docker rm -f $C >/dev/null 2>&1 || true' EXIT

MIGS=(); ASSERTS=(); MODE=mig
for a in "$@"; do
  if [ "$a" = "--assert" ]; then MODE=assert; continue; fi
  if [ "$MODE" = mig ]; then MIGS+=("$a"); else ASSERTS+=("$a"); fi
done

docker rm -f $C >/dev/null 2>&1 || true
docker run -d --name $C -e POSTGRES_PASSWORD=test postgres:15 >/dev/null
for _ in $(seq 1 30); do docker exec $C pg_isready -U postgres >/dev/null 2>&1 && break; sleep 2; done

echo "── stubs"
docker exec -i $C psql -U postgres -v ON_ERROR_STOP=1 -q < "$HERE/00-stubs.sql"

for m in "${MIGS[@]}"; do
  echo "── migracion: $m"
  docker exec -i $C psql -U postgres -v ON_ERROR_STOP=1 --single-transaction -q < "$m"
done

FAIL=0
for t in "${ASSERTS[@]:-}"; do
  [ -z "$t" ] && continue
  echo "── assert: $t"
  docker exec -i $C psql -U postgres -v ON_ERROR_STOP=1 < "$t" || FAIL=1
done

# Test de lock con dos conexiones concurrentes.
#
# Se decide mirando los asserts QUE SE PASARON, no un archivo fijo. Antes esto
# hacia grep sobre "$HERE/assert-run.sql" hardcodeado, que existe siempre: el
# test de lock corria en TODA invocacion, aunque no se hubiera aplicado la
# migracion de demoras_calcular_run. Efecto real medido: validar solo
# demoras_acabado con su assert daba exit 1 con "function
# demoras_calcular_run does not exist" — el harness reprobaba una migracion
# correcta, que es la peor forma de fallar para una herramienta de validacion.
LOCK_TEST=0
for t in "${ASSERTS[@]:-}"; do
  [ -z "$t" ] && continue
  if grep -q "advisory_xact_lock" "$t" 2>/dev/null; then LOCK_TEST=1; fi
done

if [ "$LOCK_TEST" = 1 ]; then
  echo "── test lock concurrente (dos conexiones)"

  # Lanzar conexion 2 en background: toma el lock y espera
  docker exec -i $C psql -U postgres -q <<'LOCKEOF' &
BEGIN;
SELECT pg_advisory_xact_lock(2180637405::bigint);
SELECT 'lock_taken'::text as status;
SELECT pg_sleep(3);
COMMIT;
LOCKEOF

  BG_PID=$!
  sleep 1  # esperar a que tome el lock

  # Ejecutar conexion 1: intenta demoras_calcular_run durante el lock
  LOCK_OUTPUT=$(docker exec -i $C psql -U postgres -q 2>&1 <<'TESTEOF'
DO $$
DECLARE result bigint;
BEGIN
  result := demoras_calcular_run(timestamptz '2026-07-29 22:00:00-03');
  IF result IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'con lock tomado, debio devolver 0, devolvio %', result;
  END IF;
  SELECT count(*) INTO result FROM demoras_calculadas
   WHERE corrida_at = timestamptz '2026-07-29 22:00:00-03';
  IF result > 0 THEN
    RAISE EXCEPTION 'con lock tomado, no debio escribir filas pero escribio %', result;
  END IF;
  RAISE NOTICE 'ok lock: rechaza corridas solapadas (devuelve 0 sin escribir)';
END $$;
TESTEOF
)

  if echo "$LOCK_OUTPUT" | grep -q "ok lock"; then
    echo "  ✓ corrida bloqueada rechazada (devuelve 0 sin escribir)"
  else
    FAIL=1
    echo "  ✗ assert fallo:"
    echo "$LOCK_OUTPUT"
  fi

  wait $BG_PID 2>/dev/null || true  # esperar a bg process
fi

docker rm -f $C >/dev/null 2>&1 || true
exit $FAIL
