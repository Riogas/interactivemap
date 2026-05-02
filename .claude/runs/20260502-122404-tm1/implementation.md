# Implementation — 20260502-122404-tm1

## Iteración 1

### Archivo modificado
`app/api/all-positions/route.ts`

### Cambios clave

1. **Import del helper gps-autocreate** (nuevo):
   ```ts
   import { isValidLatLng, selectMovilesNeedingDailyPosition, buildHistoryInsertRows, type MovilCandidate }
     from '@/lib/import-helpers/gps-autocreate';
   ```

2. **Nueva función `maybeSeedGpsFromPtoVta`**:
   - Recibe lista de candidatos (movil_id, escenario_id, lat, lng)
   - Llama `selectMovilesNeedingDailyPosition` para filtrar solo los que YA NO tienen entry del día (idempotencia)
   - Inserta en `gps_tracking_history` — el trigger `sync_gps_latest_position` hace el upsert a `gps_latest_positions`
   - Fire-and-forget: async sin await en el caller

3. **SELECT de moviles ampliado**:
   - Agregado `escenario_id` al SELECT (era requerido por MovilCandidate)

4. **En el path PTOVTA_FALLBACK**:
   - Reemplazado `Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0 && lng !== 0` con `isValidLatLng(lat, lng)` (usa la misma validación del helper, incluye range checks)
   - Cuando cae en fallback, agrega el candidato a `seedCandidates[]`

5. **Post-loop fire-and-forget**:
   ```ts
   if (seedCandidates.length > 0) {
     maybeSeedGpsFromPtoVta(supabase, seedCandidates).catch(...)
   }
   ```
   El cliente recibe la respuesta sin esperar. En el próximo poll (60s), `gps_latest_positions` ya tendrá el seed y el móvil pasará al path normal (`origen: SUPABASE`).

### TypeScript
- `tsc --noEmit`: 0 errores nuevos (1 pre-existente en FloatingToolbar.tsx, no relacionado)
- ESLint: +2 warnings `@typescript-eslint/no-explicit-any` en la nueva función (mismo patrón pre-existente en todo el repo, Supabase client no tiene tipo exportado)

### Idempotencia
- `selectMovilesNeedingDailyPosition` consulta gps_latest_positions filtrando por `fecha_hora >= startOfDayMontevideo()`. Si el móvil ya tiene entry del día (sembrado por importer o por llamada previa a all-positions), NO se re-inserta. Safe para recargas.
