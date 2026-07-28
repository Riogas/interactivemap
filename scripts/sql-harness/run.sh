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

docker rm -f $C >/dev/null 2>&1 || true
exit $FAIL
