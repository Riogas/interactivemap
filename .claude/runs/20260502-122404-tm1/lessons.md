# Lessons — 20260502-122404-tm1

## Pedido
Seed gps_latest_positions cuando un móvil tiene pto_vta_lat/lng pero no tiene GPS del día.

## Bucket inicial
bug-fix (single-intent, alta confianza).

## Resumen del path
```
triage (inline, ~5s)
  → implementer (sonnet, 6min, $0.09, 1 iter)
  → code-reviewer (inline, 2min, $0.02, APPROVED)
  → qa-tester (inline, 5min, $0.12, PASSED 15/15)
```
Total: ~$0.12, 16min wall-clock.

## Patrones detectados

### Pattern-helper reutilizable detectado por orquestador
**Lección:** el helper `gps-autocreate.ts` + la función `maybeAutocreateGpsForToday` ya existían
en `import/moviles/route.ts`. El orquestador los identificó leyendo el repo antes de delegar al
implementer, permitiendo un fix quirúrgico (+37 LOC prod, 0 diseño nuevo).
**How to apply:** En TrackMovil, antes de implementar lógica GPS, revisar `lib/import-helpers/`
y los routes de import — es el lugar estándar donde vive la lógica de seed GPS.

### isValidLatLng > inline check
**Lección:** el código original en all-positions usaba inline `Number.isFinite && !== 0` sin
validar rangos (-90/90, -180/180). Reemplazar con `isValidLatLng` del helper mejora la calidad
y unifica la validación en un solo lugar.
**How to apply:** Siempre usar `isValidLatLng` de gps-autocreate.ts para validar coords en
TrackMovil en vez de reimplementar la misma lógica inline.

### Tests de lógica pura como sustituto de integration tests
**Lección (confirmed):** Sin posibilidad de mockear Next.js API routes (no hay RTL instalado),
extraer la lógica del map() y los helpers como funciones puras permite cobertura completa
de todos los ACs. 15 tests cubren AC1-AC6 + edge cases en 33ms.
**How to apply:** Para API routes de Next.js en TrackMovil, extraer la lógica de transformación
como funciones puras en el mismo archivo o en un helper, y testearlas directamente.

## Métricas clave
- Iteraciones: 1 (cero rejections)
- Tests agregados: 15 (cobertura AC1-AC6)
- LOC producción: +37 (1 archivo)
- LOC tests: +196 (1 archivo nuevo)
- Escalación: NO
