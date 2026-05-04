# Spec minima (inline orquestador): seed gps_latest_positions desde pto_vta_lat/lng en mapa

## Pedido literal
Móvil activo SIN coordenadas en gps_latest_positions PERO CON pto_vta_lat y pto_vta_lng poblados:
- debe generar automáticamente un registro en gps_latest_positions usando esas coordenadas
- una vez creado, sí debe mostrarse en el mapa (porque ahora tiene datos en gps_latest_positions)
- debe seguir apareciendo en el colapsable

Móvil activo SIN coordenadas en ningún lado:
- no debe mostrarse en el mapa
- sí debe aparecer en colapsable (ya funciona así)

## Síntoma reportado
El cron que limpia gps_latest_positions cada madrugada borra los seeds del importer.
El importer re-importa pero podría no haber corrido aún para el día. El mapa usa
PTOVTA_FALLBACK en memoria (all-positions ya lo hace) pero no persiste en gps_latest_positions.
Resultado: inconsistencia — si algo lee gps_latest_positions directamente no ve al móvil.

## Contexto técnico clave
- `/lib/import-helpers/gps-autocreate.ts`: helper ya existente con selectMovilesNeedingDailyPosition + buildHistoryInsertRows
- `/app/api/import/moviles/route.ts`: ya llama maybeAutocreateGpsForToday (plantilla del fix)
- `/app/api/all-positions/route.ts`: ya tiene PTOVTA_FALLBACK pero NO llama al seed
- El trigger sync_gps_latest_position en DB hace el upsert a gps_latest_positions automáticamente al insertar en gps_tracking_history
- El colapsable usa /api/moviles-extended que lee directamente de tabla moviles → NO necesita cambios

## Acceptance criteria
- [ ] AC1: Cuando all-positions detecta móvil con pto_vta_lat/lng pero sin entry en gps_latest_positions, llama al seed best-effort (no bloquea la respuesta)
- [ ] AC2: El seed usa escenario_id del móvil (ya está en el select de all-positions? si no, agregarlo)
- [ ] AC3: El seed es idempotente — selectMovilesNeedingDailyPosition ya filtra los que ya tienen registro del día
- [ ] AC4: Si el seed falla (Supabase error), la respuesta de all-positions no se ve afectada (best-effort)
- [ ] AC5: El móvil sin pto_vta_lat/lng sigue devolviendo null (no aparece en mapa)
- [ ] AC6: Los logs indican cuántos móviles se seeded ("gps-autocreate via all-positions")

## Archivos afectados
- `app/api/all-positions/route.ts`: agregar llamada al seed best-effort post-query
- Posiblemente ampliar el SELECT de moviles para incluir escenario_id (actualmente no lo trae)
