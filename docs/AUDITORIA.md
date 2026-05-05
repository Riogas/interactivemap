# Sistema de Auditoría — TrackMovil

## Resumen

El sistema de auditoría registra las acciones de los usuarios (navegación, llamadas a la API, etc.) en la tabla `public.audit_log` de Supabase.

Tiene un **toggle global ON/OFF** controlado por la tabla `public.audit_settings`. Solo un usuario `root` puede activarlo o desactivarlo desde **Preferencias → Auditoría**.

Por defecto está **apagado** para no consumir espacio en la base de datos.

---

## Cómo activar la auditoría

1. Loguearse con un usuario que tenga `isRoot = 'S'`.
2. Abrir el panel de **Filtros y Configuración** (botón ⚙ en la esquina superior derecha).
3. Ir a **Preferencias**.
4. En la sección **Auditoría (ADMIN)**, activar el toggle "Auditar actividad de usuarios".
5. El cambio se persiste en la base y se propaga a todos los browsers conectados en ≤60 segundos (vía polling del flag).

Para **desactivar**: repetir los pasos y desactivar el toggle. Los batches en buffer se descartan del lado del cliente.

---

## Qué se audita

Cuando la auditoría está activa, se registran:

- **Llamadas a la API** (`event_type = 'api_call'`): endpoint, método HTTP, status de respuesta, duración, body de respuesta (JSON, truncado a 20 KB en cliente y 50 KB en servidor).
- **Navegación** (`event_type = 'navigation'`): cambios de ruta dentro de la SPA.
- **Eventos Realtime** (`event_type = 'realtime'`, `realtime_drift`): cambios de estado del WebSocket y drift detectado.
- **Eventos custom** (`event_type = 'custom'`): emitidos explícitamente por código de la app.

No se auditan: los propios endpoints `/api/audit` y `/api/audit/config` (están en la lista de exclusión del interceptor), ni las rutas de Next.js (`/_next/`).

---

## Crear las tablas (primera vez)

Correr en **Supabase Studio → SQL Editor**, en este orden:

1. `docs/sqls/create-audit-log.sql` — crea la tabla `public.audit_log` con índices.
2. `docs/sqls/alter-audit-log-add-response-body.sql` — agrega la columna `response_body`.
3. `docs/sqls/create-audit-settings.sql` — crea la tabla `public.audit_settings` (singleton) e inserta la fila inicial con `enabled = false`.

> El usuario debe aplicar estos SQL manualmente. La app no ejecuta migraciones automáticas.

---

## Limpiar la tabla manualmente

La tabla `audit_log` puede crecer mucho si la auditoría queda activa por mucho tiempo. Para limpiarla:

```sql
-- Borrar todos los registros
TRUNCATE public.audit_log;

-- O borrar solo registros más antiguos de N días (ejemplo: 30 días)
DELETE FROM public.audit_log WHERE ts < NOW() - INTERVAL '30 days';
```

Ejecutar en **Supabase Studio → SQL Editor** con el rol `service_role` o `postgres`.

> Después de truncar, desactivar la auditoría desde Preferencias si ya no se necesita.

---

## Ver los logs

Acceder a `/admin/auditoria` (botón "Logs / Auditoría" en el panel de Filtros y Configuración, visible solo para root).

Funcionalidades de la UI:
- Filtros por usuario, tipo de evento, endpoint, rango de fechas.
- Paginación de 100 registros por página.
- Auto-refresh configurable (5s, 10s, 15s, 30s, 1min, o manual).
- Click en una fila para ver el detalle completo del evento.

---

## Arquitectura técnica

| Componente | Descripción |
|---|---|
| `components/providers/AuditProvider.tsx` | Interceptor de `window.fetch` + tracking de navegación. Consulta `/api/audit/config` al montar y cada 60s para respetar el toggle. |
| `lib/audit-client.ts` | `sendAuditBatch()` y `sendAuditBeacon()` — envían batches al endpoint POST. |
| `lib/audit-log.ts` | Helper server-side para insertar en `audit_log` con service_role. |
| `app/api/audit/route.ts` | POST `/api/audit` — recibe batches del AuditProvider. |
| `app/api/audit/list/route.ts` | GET `/api/audit/list` — lee la tabla con filtros y paginación. |
| `app/api/audit/config/route.ts` | GET/POST `/api/audit/config` — lee/escribe `audit_settings`. POST requiere `isRoot = 'S'`. |
| `app/admin/auditoria/page.tsx` | UI de listado de eventos. |
| `public.audit_log` | Tabla de eventos (creada con `create-audit-log.sql`). |
| `public.audit_settings` | Tabla singleton de configuración (creada con `create-audit-settings.sql`). |
