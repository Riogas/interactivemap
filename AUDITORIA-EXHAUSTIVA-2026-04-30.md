# Auditoría Exhaustiva TrackMovil — 30 abril 2026

**Análisis read-only ejecutado por 4 agentes en paralelo:** code-reviewer, architect, security, deps+perf. Sin modificar código.

**Stack:** Next.js 16 (App Router) + React 19 + Supabase self-hosted + Leaflet + Python FastAPI/AS400 (JT400 → DB2). Multi-tenant por `empresa_fletera_id`/`escenario_id`. Login federado contra GeneXus + SecuritySuite externos.

---

## ⚠️ Resumen ejecutivo

**El sistema tiene un perímetro razonable (rate-limit, CORS, security headers) pero el modelo de seguridad real está esencialmente APAGADO** por una convergencia de 4 problemas identificados independientemente por los 4 agentes:

1. **RLS desactivado** — todas las políticas son `USING (true)` permitiendo a `anon` leer/escribir todo. La anon key está en el bundle del navegador. Cualquiera puede `curl` el REST de Supabase y bajar TODOS los pedidos/clientes/teléfonos/GPS de TODAS las empresas, sin login.

2. **ENABLE_SECURITY_CHECKS=false** en `.env.local` desactiva `requireAuth/requireApiKey/requireRole`. Un proceso PM2 mal arrancado deja la API entera sin auth.

3. **Multi-tenancy NO se enforcer server-side** — endpoints aceptan `empresaIds` del query param sin validar contra el `allowedEmpresas` del JWT del usuario. Un distribuidor de empresa A puede pedir datos de empresa B.

4. **Credenciales reales versionadas en repo** — `.env.local`, `.env.production`, `scripts/deploy-linux.sh` tienen: `SUPABASE_SERVICE_ROLE_KEY` (bypass RLS total), `INTERNAL_API_KEY`, `GPS_TRACKING_TOKEN`, password AS400 root `qsecofr=wwm868`.

**Ningún hallazgo crítico es cosmético** — los 4 son explotables hoy mismo desde internet con un cliente HTTP.

Adicionalmente: arquitectura de UI con componentes monolíticos (dashboard 2.5K LOC, MapView 3.1K LOC), dos sistemas de auth incompatibles conviviendo (Supabase + GeneXus localStorage), y deuda técnica significativa en hooks Realtime duplicados y tipado debilitado por `:any` x158 + `as any` x64.

---

## 🔴 CRÍTICO — Bloqueantes (acción HOY)

### 1. Credenciales sensibles versionadas en repo
**Validado por 4/4 agentes.**

**Paths comprometidos:**
- `.env.local:3-46` — DB_PASSWORD=wwm868, SERVICE_ROLE_KEY, INTERNAL_API_KEY, GPS_TRACKING_TOKEN, ENABLE_SECURITY_CHECKS=false, NODE_TLS_REJECT_UNAUTHORIZED=0
- `.env.production:5-60` — mismas claves de prod
- `.env.production.template:26` — anon key real
- `scripts/deploy-linux.sh:53-72` — todas las claves hardcoded

**Acciones inmediatas:**
1. Rotar TODAS estas claves AHORA:
   - SUPABASE_SERVICE_ROLE_KEY
   - SUPABASE_ANON_KEY
   - INTERNAL_API_KEY
   - GPS_TRACKING_TOKEN
   - Password AS400 `qsecofr` (también: crear usuario read-only dedicado, dejar de usar root)
2. `git log --all -- .env.local` y `git log --all -- scripts/deploy-linux.sh` para verificar historial
3. Si hay historial: BFG/git-filter-repo para purgar
4. Mover secretos a vault (Vault/Doppler/SecretsManager) o `.env.production` cargado por systemd/PM2 fuera del repo
5. Verificar que `.gitignore` incluye `.env*` realmente (línea 34) y que estos archivos no estén tracked: `git ls-files | grep env`

### 2. RLS efectivamente desactivado en TODAS las tablas
**Path:** `docs/sqls/supabase-full-migration.sql:608-663`

Las políticas son `FOR SELECT USING (true)` y `FOR ALL USING (true) WITH CHECK (true)` — RLS activo por compliance pero permite todo a `anon`.

**Explotación:**
```bash
curl 'https://supabase.glp.riogas.com.uy/rest/v1/pedidos?select=*' \
  -H "apikey: <NEXT_PUBLIC_SUPABASE_ANON_KEY>"
```
Devuelve todos los pedidos/clientes/coordenadas de todas las empresas, sin login.

**Acción:**
- Mientras tanto: restringir el bucket de Supabase via IP allow-list en nginx
- Esta semana: reescribir políticas con scope real (`USING (empresa_fletera_id = ANY(auth.jwt() -> 'allowed_empresas'))`)
- Revocar permisos de `anon` para INSERT/UPDATE/DELETE en tablas sensibles

### 3. ENABLE_SECURITY_CHECKS=false apaga toda la auth
**Paths:** `lib/auth-middleware.ts:44, 85-91, 206-209, 282-286`

Cuando `process.env.ENABLE_SECURITY_CHECKS === 'false'`, los middlewares devuelven `{ id: 'bypass-mode' }` y todos los `requireAuth/requireApiKey/requireRole` retornan true. El `.env.local` actual la tiene en `false`.

**Acción:**
- Eliminar el flag del código (no debe existir kill-switch global de auth)
- Si necesitás modo dev sin auth: condicionarlo a `NODE_ENV !== 'production'` y nunca aceptar la flag en prod
- **Verificar AHORA** qué valor tiene en el server actual: `pm2 env <id> | grep SECURITY`

### 4. Multi-tenancy NO se enforcer server-side
**Paths afectados (>15 endpoints):**
- `app/api/all-positions/route.ts:21-51`
- `app/api/pedidos/route.ts:24-77`
- `app/api/services/route.ts:25-77`
- `app/api/pedidos-pendientes/route.ts:14-61`
- `app/api/empresas/route.ts:7-49`
- `app/api/movil-session/[id]/route.ts:19-95`
- `app/api/coordinates/route.ts`
- `app/api/movil/[id]/route.ts`
- `app/api/latest/route.ts`
- `app/api/zonas/route.ts`
- `app/api/demoras/route.ts`
- etc.

**Patrón:** los handlers usan `service_role` (bypass RLS) y aceptan `empresaIds`/`empresa_fletera_id`/`movilId` del query param sin compararlos con el `allowedEmpresas` del JWT del usuario.

**Explotación:**
```bash
# Usuario distribuidor de empresa A logueado:
curl '/api/all-positions?empresaIds=999&escenarioId=1000' \
  -H "Authorization: Bearer <jwt-empresa-A>"
# Devuelve posiciones GPS de empresa 999 (B, competidor)
```

**Acción:**
- En cada handler: usar `getScopedEmpresas(user)` (helper YA EXISTE en `lib/auth-scope.ts`) e intersectar con `empresaIds` recibido. Fail-closed si vacío.
- Para queries por `movilId`/`pedidoId`: agregar verificación `WHERE empresa_fletera_id IN allowedEmpresas`

### 5. Endpoints sin autenticación que exponen datos sensibles

| Endpoint | Riesgo | Acción |
|----------|--------|--------|
| `app/api/audit/list/route.ts` | Log completo de auditoría (IPs, bodies, JWTs en bodies) | requireAuth + role admin |
| `app/api/incidents/route.ts:52` POST | Upload arbitrario hasta 500MB al bucket Storage + insertar incidents falsos | requireAuth + validar mime real |
| `app/api/incidents/list/route.ts` | Signed URLs de videos privados de choferes (datos personales) | requireAuth + role admin |
| `app/api/incidents/[id]/route.ts` PATCH/DELETE | Modificar/borrar incidents arbitrarios | requireAuth + role admin |
| `app/api/zonas/route.ts` | Geografía operativa expuesta (rutas, polígonos) | requireAuth |
| `app/api/user-preferences/route.ts` GET/PUT | IDOR — leer/sobrescribir prefs de cualquier user_id | requireAuth + user_id = jwt.sub |
| `app/api/puntos-interes/import-osm/route.ts` POST/DELETE | Import OSM masivo + DELETE acepta `?usuario_email=cualquiera` | requireAuth + admin |
| `app/api/audit/route.ts` POST | Pollution de auditoría con eventos falsos atribuidos a otros users | requerir JWT verificado |

### 6. SQL injection clásica en API Python AS400
**Path:** `as400-api/api_as400.py:417-421, 495, 521-541, 626, 634-636, 664-668, 734, 752`

Queries con f-strings sobre query params que vienen como `Optional[str]` (CSV de IDs):
```python
f"AND m.EFLID IN ({','.join(empresa_list)})"  # empresa_list = empresaIds.split(',')
f"WHERE l.LOGCOORDMOVILFCHINSLOG >= '{startDate}'"
```

**Explotación:**
```
GET /coordinates?movilId=1&startDate=2025-01-01&empresaIds=1)+UNION+SELECT+*+FROM+QSYS.QAUSRSYS--
```

**Combo letal:** la API se conecta con `qsecofr` (super-usuario IBM i) → SQL injection da control total del AS400.

**Acción:**
1. Convertir TODAS las queries a prepared statements (la API ya lo hace en algunos endpoints — extender al resto)
2. Validar CSVs con regex `^\d+(,\d+)*$` antes de interpolar
3. Reemplazar `qsecofr` por usuario dedicado read-only sobre `GXCALDTA`/`GXICAGEO`
4. Password fuerte ≥20 chars (actual: 6 chars)

### 7. NODE_TLS_REJECT_UNAUTHORIZED=0 globalmente activo
**Paths:** `.env.local:46`, `.env.production:60`

Deshabilita validación TLS para TODAS las conexiones HTTPS del proceso (Supabase, SecuritySuite, AS400, GeneXus). MITM en cualquier salida.

**Acción:**
- Instalar el certificado interno como CA confiable: `NODE_EXTRA_CA_CERTS=/path/to/ca.pem`
- Setear `NODE_TLS_REJECT_UNAUTHORIZED=1`
- Si Supabase self-hosted necesita cert auto-firmado: configurar `https.Agent({ ca: trustedRootCert })` solo para ese host

### 8. xlsx 0.18.5 — vulnerabilidad HIGH activa + bundle inicial
**Path:** `package.json:34`, usado en `components/ui/PreferencesModal.tsx:6,126-128`

CVE-2023-30533 (Prototype Pollution) + CVE-2024-22363 (ReDoS). Paquete abandonado en npm. Importado estáticamente en client component que se carga en cada dashboard (~600KB bundle inicial).

**Acción:**
1. Migrar a `xlsx` desde CDN oficial de SheetJS (`https://cdn.sheetjs.com/`) o reemplazar por `exceljs`/`read-excel-file`
2. Convertir a dynamic import: `const XLSX = await import('xlsx')` dentro de `handleImportPOI`

---

## 🟠 ALTO — Acción esta semana

### 9. Stale closure en useGPSTracking → loop infinito de reconexiones
**Path:** `lib/hooks/useRealtimeSubscriptions.ts:169-183`

`retryCount` (useState) capturado en closure de `setupChannel`. La comparación `retryCount < MAX_RETRIES` siempre ve el valor stale (0). En errores de red genera miles de WebSockets.

**Fix:** usar `useRef` para el contador.

### 10. Race condition en GPS batch queue + URL hardcoded localhost:3002
**Path:** `lib/gps-batch-queue.ts:125-213, 284`

- `flush()` con `isProcessing` guard no atómico → pérdida silenciosa de records GPS bajo carga
- `createMissingMoviles` hace `fetch('http://localhost:3002/...')` sin API key, falla en prod silenciosamente cuando aparecen móviles nuevos

**Fix:** mutex real (cola de Promises), `splice(0)` en vez de `= []`, env var `APP_BASE_URL` + INTERNAL_API_KEY header.

### 11. Memory leak: URL.createObjectURL sin revoke
**Path:** `contexts/IncidentRecorderContext.tsx:358`

Cada grabación → preview → discard leakea un Blob.

**Fix:** `URL.revokeObjectURL(url)` en `discard()` y al confirmar.

### 12. RealtimeProvider hardcoded a escenarioId=1000
**Path:** `app/layout.tsx:30`

Usuarios con escenarios distintos al 1000 NO reciben actualizaciones realtime.

**Fix:** leer `escenarioId` del AuthContext dinámicamente.

### 13. Bypass de rate limit por LAN + x-forwarded-for inyectable
**Path:** `lib/rate-limit.ts:75-91, 138-153`

- Toda IP `192.168.*.*`/`10.*.*.*`/`172.16-31.*.*` queda exenta de rate limit (incluyendo login)
- `getClientIp` confía en el primer valor de `x-forwarded-for` sin validar proxy upstream

**Explotación:** brute-force ilimitado en `/api/proxy/gestion/login` desde LAN o con `X-Forwarded-For: 192.168.1.1` spoofeado.

**Fix:** trust solo IPs de nginx upstream confiables, tomar última IP del header, no exentar LAN para auth.

### 14. Logs masivos con bodies completos y tokens parciales en producción
**Paths:** `app/api/proxy/[...path]/route.ts:96-345`, `app/api/auth/login/route.ts:20`, `as400-api/api_as400.py:202`

PM2 persiste GBs de logs con tokens, bodies de login, queries con datos personales.

**Fix:** logger central con redacción automática de Authorization/Cookie. `console.log` → `info/debug` levels condicionales por env.

### 15. JWT decodificado SIN verificar firma
**Paths:** `app/api/audit/route.ts:15-24`, `app/api/incidents/route.ts:22-31`

`decodeJwtPayload` solo hace `Buffer.from(payload, 'base64')`. El `userId/username` no verificado se persiste en `audit_log` y `incidents` como real.

**Fix:** verificar firma con clave compartida del SecuritySuite.

### 16. Dos sistemas de auth incompatibles conviviendo
**Paths:** `lib/auth-middleware.ts` (Supabase) + `contexts/AuthContext.tsx` (GeneXus localStorage)

`requireAuth()` valida sesión Supabase pero `AuthContext` no usa Supabase Auth — guarda token en localStorage propio y borra cookies sb-*. Los 30 endpoints con `requireAuth` deberían siempre devolver 401, pero como `ENABLE_SECURITY_CHECKS=false` están bypaseados. Bomba de tiempo.

**Fix:** definir UN modelo (Supabase Auth con SSO contra GeneXus, o reemplazar requireAuth por verificación del token GeneXus). Eliminar el código del que no se va a usar.

### 17. follow-redirects + postcss vulnerables (vía axios y next)
**Path:** `package.json` deps tree

- `follow-redirects ≤1.15.11` MODERATE GHSA-r4q5-vmmm-2653 (filtra headers cross-domain)
- `postcss <8.5.10` MODERATE CVE-2026-41305 (XSS via `</style>`)

**Fix:** pnpm overrides:
```json
"pnpm": {
  "overrides": {
    "follow-redirects": ">=1.16.0",
    "postcss": ">=8.5.12"
  }
}
```

### 18. Conflicto next.config.ts vs next.config.mjs
**Path:** `next.config.ts` (vacío) + `next.config.mjs` (real con security headers, webpack fallbacks, standalone)

Si Next 16 elige el `.ts`, se PIERDEN todos los security headers + fallbacks en producción. **Riesgo de regresión silenciosa al actualizar Next.**

**Fix:** borrar `next.config.ts`.

### 19. Login del proxy `/api/proxy/gestion/login` exime requireAuth
**Path:** `app/api/proxy/[...path]/route.ts:115-128`

Combinado con bypass de rate limit por LAN (#13) → brute-force ilimitado al SGM.

**Fix:** rate limit estricto siempre para auth aunque venga de LAN.

### 20. /api/incidents/[id] enumeración secuencial → DELETE arbitrario de evidencia
Combinación de #5 y endpoint sin auth. Atacante puede borrar evidencia de incidentes.

### 21. Componentes monolíticos extremos
- `app/dashboard/page.tsx` — 2548 LOC, ~30 useState, 3 setInterval, 12+ modales hijos
- `components/map/MapView.tsx` — 3132 LOC
- `lib/hooks/useRealtimeSubscriptions.ts` — 712 LOC
- `components/ui/MovilSelector.tsx` — 1649 LOC

Cualquier setState recompila el árbol. Compile times lentos. Imposible razonar sobre re-renders.

**Fix:** continuar la migración a `hooks/dashboard/`, romper MapView por capa, objetivo <400 LOC por archivo.

### 22. 6 hooks Realtime copy-paste
**Path:** `lib/hooks/useRealtimeSubscriptions.ts`

`useGPSTracking`, `useMoviles`, `usePedidos`, `useEmpresasFleteras`, `usePedidosRealtime`, `useServicesRealtime` repiten el mismo pattern con variantes mínimas. Bug fixes no se propagan (ya hay diferencias entre `useGPSTracking` MAX_RETRIES=5 y `usePedidosRealtime` sin max).

**Fix:** factory `createRealtimeHook<T>({ table, filterBuilder, idKey })` y derivar los 6 en ~50 LOC totales.

### 23. Sin middleware.ts global → rate-limit/audit no aplican uniformemente
No existe `middleware.ts` en raíz. `autoRateLimit` solo aplica si los handlers lo invocan explícitamente — `app/api/auth/login/route.ts` no lo hace → login sin rate limit.

### 24. Acceso directo a Supabase desde 19 componentes UI
Cero capa de servicio/repos. Cada modal/layer hace su propia query con sus filtros. La lógica de scope-by-empresa se duplica con riesgo de olvidarse en un sitio.

**Fix:** `lib/repositories/` (movilesRepo, pedidosRepo, zonasRepo) como único punto de entrada.

### 25. Patrones inconsistentes de cliente Supabase
Algunos handlers usan `getServerSupabaseClient()` (service_role), otros hacen `createClient(URL, ANON_KEY)` propio. Si se activa RLS, los segundos empiezan a devolver vacío silenciosamente.

**Fix:** lint rule que detecte `createClient` fuera de `lib/supabase.ts`.

---

## 🟡 MEDIO — Mejoras

| # | Hallazgo | Path/Detalle |
|---|----------|--------------|
| 26 | Tipos `any` masivos | 158 `:any` + 64 `as any` en 62 archivos |
| 27 | safeCompare no es realmente timing-safe | `lib/auth-middleware.ts:52-61` — leakea length |
| 28 | Queries sin `.limit()` ni paginación | `app/api/pedidos/route.ts:44`, `app/api/services/route.ts:45` |
| 29 | `transformGpsToSupabase(gps: any)` sin validar | `app/api/import/gps/route.ts:10` — Zod schema existe pero no se usa |
| 30 | Audit captura request_body sin sanitizar | tokens/passwords pueden quedar en `audit_log` |
| 31 | `safeParseJSON` 50 iteraciones O(n²) | DoS posible con payload grande malformado |
| 32 | Stack trace expuesto en producción | `app/api/import/moviles/route.ts:248` |
| 33 | Deps fantasma | `pg` (devDeps, 0 imports), `docx` (0 imports), `@types/react-window` (deprecado) |
| 34 | `@supabase/auth-helpers-nextjs` deprecado y unused | sacar |
| 35 | `react-leaflet-markercluster@5.0.0-rc.0` | RC en producción + "Package no longer supported" |
| 36 | Falta CSP / HSTS | `next.config.mjs:24-52` |
| 37 | Token en localStorage sin HttpOnly | XSS roba token directamente |
| 38 | 63/137 archivos con `'use client'` | pierde SSR, muchos modales innecesariamente client |
| 39 | Sólo 2 dynamic imports | modales pesados se importan estáticamente |
| 40 | `<img>` directo en vez de `next/image` | login, MovilSelector, MapView, PreferencesModal |
| 41 | Fetches sin caching | 30+ archivos, 0 con `next: { revalidate }` |
| 42 | Loops anidados en MapView | 9 forEach con par anidado, sin memoization |
| 43 | Permissions-Policy / X-Frame-Options inconsistente | `next.config.mjs:35` SAMEORIGIN vs `proxy.ts:114` DENY |
| 44 | CORS allowedOrigins[0] fallback | `proxy.ts:87-89` confunde política |
| 45 | INTERNAL_API_KEY estático sin rotación | si una APK se decompila se obtienen todos |
| 46 | Routing dual `app/` vs `src/app/` | boilerplate residual de create-next-app |
| 47 | 13 scripts deploy redundantes | borrar todos menos uno |
| 48 | AS400 API en repo Next.js como sidecar | `as400-api/.venv` versionado, jt400.jar binario |
| 49 | `NEXT_PUBLIC_SUPABASE_PROXY_URL` proxy via nginx | OK pero sin certificate pinning |
| 50 | Sin tests UI/Realtime | 9 tests, todos sobre lógica pura |

---

## 🔵 BAJO — Informativo

| # | Hallazgo |
|---|----------|
| 51 | `app/page.tsx.bak` versionado |
| 52 | `lib/db-mock.ts`, `lib/db.ts` posibles dead code |
| 53 | `package.json.backup-`, `trackmovil.tar`, `trackmovil.zip` (101MB c/u) en raíz → infla Docker |
| 54 | `Dockerfile` usa `pnpm@latest` no reproducible |
| 55 | `process.on()` listeners no desregistrados en singleton GPS queue |
| 56 | `serverExternalPackages: ['odbc']` en next.config — odbc no figura en deps |
| 57 | `as400-api` CORS `allow_methods=["*"]` |
| 58 | Pool conexiones AS400 inexistente → DoS por agotamiento |
| 59 | `public/clear-storage.js` con `console.log('Token: ...')` |
| 60 | `escenarioId={1000}` hardcoded | `app/layout.tsx` |

---

## ✅ Cosas bien hechas (no romper)

- **`lib/auth-scope.ts` + `lib/scope-filter.ts`** — multi-tenancy bien aislada con tests dedicados (root vs despacho vs distribuidor). Es el módulo más sano del repo. **Solo falta usarlo server-side.**
- **`hooks/dashboard/`** — extracción incipiente correcta (`useDashboardModals`, `useFilterHelpers`, `useMapDataView`, `useScopedZonaIds`). Continuar.
- **`lib/supabase.ts::getServerSupabaseClient()`** — helper correcto, solo falta forzar uso.
- **Memoización en `RealtimeProvider`** — useCallback/useMemo/refs bien hechos.
- **Logging de Realtime al audit_log** — útil para diagnosticar caída de WebSockets.
- **Manejo de reconexión Realtime con refetch** — pattern correcto: cuando vuelve WS, fetch full para no perder gap.
- **Doble client Supabase (anon proxy / service server-side)** — decisión correcta para self-hosted.
- **Scoping fail-closed** en `getScopedEmpresas`.
- **Vitest configurado** y tests existentes con patrón consistente.
- **Tipos generados de Supabase** (`types/supabase.ts`) — el tooling está, falta usarlo.

---

## 🎯 Plan de acción ordenado por urgencia

### HOY (4-6 horas)
1. **Rotar todas las credenciales** (#1) — service role, internal key, GPS token, anon key, password AS400
2. **Verificar `ENABLE_SECURITY_CHECKS` en server PM2** (#3) — `pm2 env <id> | grep SECURITY`
3. **Restringir REST de Supabase a IPs internas en nginx** (#2) — mitigación temporal mientras se reescribe RLS
4. **Quitar `ENABLE_SECURITY_CHECKS` del código** (#3) — eliminar el kill-switch
5. **Borrar `next.config.ts` vacío** (#18)
6. **Verificar git history** — `git log --all -- .env.*` y `git log --all -- scripts/deploy-linux.sh`. Si hay leaks, BFG/filter-repo

### Esta semana (8-12 horas)
7. **Reescribir RLS** (#2) con scope real por `empresa_fletera_id`. Revocar permisos de `anon`. Mover escrituras a service_role.
8. **Agregar `requireAuth` + role check** a los 8 endpoints abiertos identificados (#5)
9. **Enforcer multi-tenancy server-side** (#4) — usar `getScopedEmpresas` en cada handler con `empresaIds`
10. **Convertir queries Python a prepared statements** (#6) y crear usuario AS400 read-only no-`qsecofr`
11. **`NODE_TLS_REJECT_UNAUTHORIZED=1`** (#7) con CA interna confiable
12. **Fix stale closure en useGPSTracking** (#9) — `useRef` para retryCount
13. **xlsx → dynamic import + plan de reemplazo** (#8)
14. **pnpm overrides** para follow-redirects y postcss (#17)
15. **Verificar firma JWT** en `decodeJwtPayload` (#15)
16. **Quitar logs verbosos de prod** (#14) — logger central con redacción

### Próximas 2 semanas (16-24 horas)
17. **Decidir modelo de auth único** (#16) — Supabase con SSO o GeneXus puro
18. **Crear `middleware.ts` global** (#23) con rate-limit + audit
19. **Refactorizar dashboard/MapView** (#21) — objetivo <400 LOC por archivo
20. **Factory de hooks Realtime** (#22) — eliminar copy-paste
21. **Capa `lib/repositories/`** (#24) — abstracción sobre Supabase
22. **Limpiar deps fantasma** (#33-34) y deps deprecadas
23. **Mover AS400 API a repo separado** (#48)
24. **Agregar tests UI/Realtime** (#50)

### Próximo mes
25. **Migrar token a HttpOnly cookie + CSP/HSTS** (#37, #36)
26. **CSRF protection** en endpoints state-changing
27. **Logging structured + redacción automática**
28. **Rate limit con Redis** para multi-instancia (#26 medium)

---

## 📊 Métricas

- **Archivos analizados:** ~150 archivos clave (de 137 .ts/.tsx + Python + SQL)
- **Hallazgos totales:** 60 (8 crítico + 17 alto + 25 medio + 10 bajo)
- **Hallazgos bloqueantes:** 8 — deben resolverse antes de cualquier nuevo release
- **Hallazgos validados por múltiples agentes (alta confianza):** #1, #2, #3, #4, #7, #16, #21
- **LOC totales code:** ~50K líneas
- **Componentes >400 LOC:** ~12
- **`:any` ocurrencias:** 158 en 62 archivos
- **Endpoints sin auth identificados:** 8

---

*Generado por: code-reviewer (Opus) + architect (Opus) + security-reviewer (general) + deps+perf (general) corriendo en paralelo. Read-only — sin modificaciones al código.*
