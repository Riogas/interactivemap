# Reimplementar sistema de auditoría con toggle global ON/OFF

## Contexto

En commit `b87d025` (presente en branches `dev` y `main`) se eliminó completamente el servicio de auditoría porque la tabla `audit_log` crecía sin parar (1.1 GB cuando la borramos en Supabase). Ahora el usuario quiere reactivarlo PERO con un toggle ON/OFF global que solo root puede controlar desde "Preferencias". Default OFF — solo se prende cuando se necesita auditar algo, después se apaga y la tabla puede limpiarse manualmente.

Repo: `C:\Users\jgomez\Documents\Projects\trackmovil`. Branch base: `dev`. Después merge a `main` (mismo workflow que venimos usando — el user confirma siempre push a ambas, pero el merge a main lo hace él, no la automatización).

## Requerimientos

### 1. Restaurar archivos eliminados en commit `b87d025`

Recuperarlos con `git show b87d025^:<path>`:

- `components/providers/AuditProvider.tsx` (interceptor global de fetch + tracking de navegación)
- `lib/audit-client.ts` (sendAuditBatch, sendAuditBeacon)
- `lib/audit-log.ts` (logAudit server-side)
- `app/api/audit/route.ts` (POST batch)
- `app/api/audit/list/route.ts` (GET con filtros)
- `app/admin/auditoria/page.tsx` (UI de listado)
- `docs/sqls/create-audit-log.sql`
- `docs/sqls/alter-audit-log-add-response-body.sql`

Mantener implementación tal cual estaba — son archivos probados.

### 2. Tabla nueva `public.audit_settings` (singleton)

```sql
id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1)
enabled boolean NOT NULL DEFAULT false
updated_at timestamptz NOT NULL DEFAULT now()
updated_by text
```

SQL en `docs/sqls/create-audit-settings.sql`. Insertar fila inicial `(1, false, now(), 'system')`.

### 3. Endpoint `GET /api/audit/config` (público, sin auth)

- Devuelve `{ enabled: boolean, updated_at: string, updated_by: string }`
- Lee `public.audit_settings WHERE id = 1` con service_role
- Cache de 5s del lado del server

### 4. Endpoint `POST /api/audit/config`

- Body: `{ enabled: boolean }`
- Auth: JWT en `Authorization: Bearer ...`. Decodificar payload, exigir `payload.isRoot === 'S'`
- Si OK: `UPDATE public.audit_settings SET enabled = $1, updated_at = now(), updated_by = $username WHERE id = 1`
- Responder `{ success: true, enabled, updated_at, updated_by }`

### 5. Modificar `AuditProvider.tsx` para respetar el flag

- Al montar, fetch a `/api/audit/config` y guardar `enabled` en un ref
- Polear `/api/audit/config` cada 60 segundos y actualizar el ref
- El interceptor de fetch siempre se instala, pero antes de hacer `enqueue(...)` chequea el ref. Si `enabled === false`, no hace nada (passthrough)
- El timer de flush (cada 5s) solo manda batch si `enabled === true`. Si pasa de false a true, recién entonces empieza a capturar
- Si pasa de true a false, dejar de capturar nuevo (los batches en buffer se descartan)
- Loggear `console.info("[audit] enabled=false, skipping")` 1 vez al cambio para debug

### 6. Modificar `components/ui/PreferencesModal.tsx`

- Sección "Auditoría" SOLO visible si `user.isRoot === 'S'`
- Toggle visual (switch) con label "Auditar actividad de usuarios"
- Texto descriptivo: "Cuando está ACTIVO, se registran todas las acciones de los usuarios (navegación, llamadas API, etc.). Por defecto está apagado para no consumir espacio en la base."
- Mostrar metadata: "Última actualización: 2026-05-05 19:00 por dmedaglia" (formato amigable, usa `updated_at` y `updated_by` del endpoint)
- Al togglear: POST `/api/audit/config` con `{ enabled: !current }`, mostrar loading state (deshabilitar el switch), y al volver mostrar toast confirmación o error
- Si el POST falla (no root, etc.) revertir el toggle visual

### 7. Restaurar botón en `FloatingToolbar.tsx`

Restaurar el botón "Logs / Auditoría" que removimos. SOLO visible si `user.isRoot === 'S'`. Abre `/admin/auditoria` en nueva tab.

### 8. Restaurar bypass de rate-limit

En `lib/rate-limit.ts`, restaurar el bloque que sacamos en `b87d025` para `/api/audit`. Agregar también bypass para `/api/audit/config` (es polling cada 60s).

### 9. Re-incluir `<AuditProvider>` en `app/layout.tsx`

Envolviendo el árbol como estaba antes.

### 10. Tests (vitest)

- Restaurar tests previos
- Test del endpoint POST `/api/audit/config`:
  - Sin auth → 401
  - Con JWT válido pero `isRoot !== 'S'` → 403
  - Con JWT root → 200 y se actualiza la fila
- Test del endpoint GET → 200 con shape correcto
- Test unitario: `AuditProvider` con `enabled=false` NO llama a `sendAuditBatch`. Con `enabled=true` SÍ
- Mantener tests existentes verdes

### 11. Documentación

- `docs/AUDITORIA.md` con: cómo activar (UI), cómo limpiar la tabla manualmente (`TRUNCATE public.audit_log`), cómo crear las tablas la primera vez (correr los 2 SQL), qué se audita.
- Agregar referencia desde README si existe.

## Decisiones tomadas (firmes, no consultar)

- Default OFF
- Toggle GLOBAL — root prende y afecta a todos los browsers conectados (vía polling del flag cada 60s)
- Persistencia server-side (tabla `audit_settings`), NO localStorage
- Solo `user.isRoot === 'S'` puede modificar el toggle
- AuditProvider siempre montado en layout.tsx; el toggle solo afecta SI envía batches

## Convenciones del repo

- TypeScript strict, no `any` salvo casos justificados
- React hooks; client components con `'use client'`
- Supabase server-side via `getServerSupabaseClient()` de `lib/supabase.ts` (usa service_role)
- JWT decode helper ya existe en `app/api/audit/route.ts` original (recuperarlo)
- Estilo de comentarios y código: mirar archivos vecinos
- Tests con vitest, descritos en español con AC#-naming. Mock supabase con vi.mock

## Git workflow

- Branch: dev. Commits granulares (uno por feature: restore + audit_settings + UI toggle + tests)
- NO hacer merge a main automáticamente — eso lo hace el user después de revisar
- Push solo a `dev` al final

## Out of scope

- No tocar el cron de purga de Logflare ni los otros crons (ya están)
- No tocar la lógica de filtros de móviles/pedidos/services (recientemente refactoreada)
- No reactivar `gps_tracking_history` en la publication de Realtime
- Usuario va a aplicar manualmente los SQL `create-audit-log.sql` + `create-audit-settings.sql` en Supabase Studio. NO hace falta migrar automáticamente

## Aceptación

- Tests verdes (incluyendo nuevos)
- `pnpm exec tsc --noEmit` sin errores
- Para un user no-root, el toggle no aparece en Preferencias y no puede tocar el endpoint POST
- Para un user root, puede prender/apagar; el cambio se refleja en todos los browsers conectados a los <60s siguientes
- Cuando enabled=false, ninguna llamada llega a `/api/audit` desde el browser
- Cuando enabled=true, el comportamiento del audit_log es idéntico al que tenía antes del commit b87d025
