# Auditoría de Código — TrackMóvil

**Fecha:** 2025-07-06  
**Repositorio:** Riogas/interactivemap  
**Branch:** main  
**Última referencia:** commit a4a7081  

---

## Índice

1. [Vulnerabilidades de Seguridad](#1-vulnerabilidades-de-seguridad)
2. [Rendimiento del Mapa](#2-rendimiento-del-mapa)
3. [Código Muerto / Sin Usar / Mock](#3-código-muerto--sin-usar--mock)
4. [Bug: Contador "Ped. sin Asig."](#4-bug-contador-ped-sin-asig)
5. [Resumen Ejecutivo](#5-resumen-ejecutivo)

---

## 1. Vulnerabilidades de Seguridad

### 1.1 CRÍTICAS (4)

#### VULN-01: Seguridad deshabilitada en producción
- **Archivo:** `scripts/install-trackmovil-git.sh`, `scripts/deploy-linux.sh`, `deploy-trackmovil.sh`
- **Descripción:** Todos los scripts de deploy configuran `ENABLE_SECURITY_CHECKS=false`. Esto desactiva COMPLETAMENTE la autenticación en `lib/auth-middleware.ts` — `requireAuth()` retorna un usuario ficticio `bypass@disabled.local` con rol admin, `requireApiKey()` es no-op, `requireRole()` siempre pasa.
- **Impacto:** Cualquier persona con acceso de red puede acceder a TODOS los endpoints de la API sin autenticación.
- **Recomendación:** Establecer `ENABLE_SECURITY_CHECKS=true` en producción. Crear un mecanismo de override solo para desarrollo local.

#### VULN-02: Credenciales de producción hardcodeadas en Git
- **Archivos:** `scripts/install-trackmovil-git.sh`, `scripts/deploy-linux.sh`, `.env` patterns
- **Datos expuestos:**
  - Supabase URL y anon key
  - Supabase service role key
  - Contraseña de BD: `wwm868`
  - API key: `96c596ab...`
  - Token GPS: `jfj4Jdjks...`
  - Contraseña de usuario real: `VeintiunoDeOctubre!`
- **Recomendación:** Rotar TODAS las credenciales inmediatamente. Usar un gestor de secretos (Azure Key Vault, AWS Secrets Manager, o Doppler). Eliminar credenciales del historial de Git con `git filter-branch` o `BFG`.

#### VULN-03: Inyección SQL en API AS400
- **Archivo:** `as400-api/api_as400.py`
- **Descripción:** Consultas SQL construidas con f-strings directamente con parámetros del usuario, e.g.: `f"SELECT * FROM tabla WHERE campo = '{user_input}'"`. Sin parametrización ni sanitización.
- **Impacto:** Un atacante puede ejecutar consultas arbitrarias contra el AS400.
- **Recomendación:** Usar consultas parametrizadas (`cursor.execute("SELECT ... WHERE campo = ?", (param,))`).

#### VULN-04: Supabase service_role key expuesta
- **Archivos:** Scripts de deploy
- **Descripción:** El `SUPABASE_SERVICE_ROLE_KEY` está en texto plano en scripts versionados. Esta key tiene acceso **completo** a la BD sin políticas RLS.
- **Recomendación:** Mover a variable de entorno del servidor, nunca versionar.

---

### 1.2 ALTAS (6)

#### VULN-05: TLS deshabilitado globalmente
- **Archivos:** Scripts de deploy
- **Descripción:** `NODE_TLS_REJECT_UNAUTHORIZED=0` en todos los entornos. Deshabilita la verificación de certificados SSL para TODAS las conexiones HTTPS, incluyendo la conexión a Supabase.
- **Impacto:** Vulnerable a ataques Man-in-the-Middle.

#### VULN-06: Rutas API sin autenticación
- **Rutas afectadas:** `/api/zonas`, `/api/user-preferences`, `/api/doc`, `/api/import/*`, `/api/sync-session`
- **Descripción:** Múltiples rutas API no llaman a `requireAuth()` en absoluto (independientemente de `ENABLE_SECURITY_CHECKS`).

#### VULN-07: Sync-session permite suplantación de usuario
- **Archivo:** `app/api/movil-session/sync-session/route.ts`
- **Descripción:** Acepta `userId` de la solicitud sin validar que el usuario autenticado sea ese userId. Permite a cualquier usuario marcar/desmarcar sesiones de cualquier otro usuario.

#### VULN-08: IDOR en user-preferences
- **Archivo:** `app/api/user-preferences/route.ts`
- **Descripción:** Acepta `userId` del query param sin verificar identidad. Un usuario puede leer/modificar preferencias de cualquier otro.

#### VULN-09: Rate limit de GPS bypaseable
- **Archivo:** `app/api/import/route.ts`
- **Descripción:** Rate limit basado en IP en memoria, sin persistencia. Se resetea con cada restart del servidor. Con `ENABLE_SECURITY_CHECKS=false`, el rate limit ni siquiera se evalúa.

#### VULN-10: Token de sesión en localStorage
- **Archivo:** `contexts/AuthContext.tsx`
- **Descripción:** Tokens almacenados en `localStorage` son accesibles desde cualquier script JavaScript en la página — vulnerables a XSS.
- **Recomendación:** Usar `httpOnly` cookies.

---

### 1.3 MEDIAS (8)

| ID | Descripción | Archivo |
|----|-------------|---------|
| VULN-11 | CORS con wildcard como fallback | `next.config.mjs` |
| VULN-12 | API AS400 sin autenticación | `as400-api/api_as400.py` |
| VULN-13 | `dangerouslySetInnerHTML` en varios componentes | MapView.tsx, zone layers |
| VULN-14 | `innerHTML` directo en controles Leaflet | MovilesZonasLayer.tsx |
| VULN-15 | Logging verboso de credenciales en producción | Múltiples archivos |
| VULN-16 | Errores TypeScript ignorados en build | `next.config.mjs` (`ignoreBuildErrors: true`) |
| VULN-17 | Whitelist de proxy demasiado amplia | `proxy.ts` |
| VULN-18 | AS400 API expone todos los endpoints sin restricción | `as400-api/api_as400.py` |

### 1.4 BAJAS (6)

| ID | Descripción | Archivo |
|----|-------------|---------|
| VULN-19 | Rate limiting en memoria (no distribuido) | `lib/rate-limit.ts` |
| VULN-20 | Todas las IPs privadas en whitelist | `lib/auth-middleware.ts` |
| VULN-21 | GC probabilístico (no determinístico) | `lib/gps-batch-queue.ts` |
| VULN-22 | Endpoint de debug accesible | `/api/debug/toggle` |
| VULN-23 | Documentación API pública sin auth | `/api/doc` |
| VULN-24 | Sesión no validada al restaurar | `contexts/AuthContext.tsx` |

---

## 2. Rendimiento del Mapa

### 2.1 Hallazgos Críticos

#### PERF-01: Arrays filtrados en JSX causando re-renders masivos (IMPACTO CRÍTICO)
- **Archivo:** `app/dashboard/page.tsx` (~línea 2055-2080)
- **Problema:** Las props `pedidos` y `services` del componente `MapView` contienen expresiones `.filter()` inline de 15+ líneas que se ejecutan en cada render del dashboard. Esto crea nuevas referencias de array cada vez, invalidando la memoización de `MapView` con `arePropsEqual`.
- **Impacto:** MapView se re-renderiza completamente en CADA cambio de estado del dashboard.
- **Solución sugerida:** Extraer arrays filtrados a `useMemo` con dependencias correctas.
- **Mejora estimada:** 40-60% menos re-renders de MapView.

#### PERF-02: Animaciones CSS en TODOS los marcadores activos
- **Archivo:** `components/map/MapView.tsx` (~línea 1293)
- **Problema:** Cada marcador de móvil activo tiene `animation: pulse 2s infinite` inline. Con 80+ marcadores, el navegador ejecuta 80+ animaciones CSS simultáneas con `transform: scale()`, causando composición GPU continua. El flag `shouldDisableAnimations` existe pero NO funciona porque usa selectors de atributo CSS que no matchean estilos inline.
- **Mejora estimada:** 30-50% menos trabajo GPU con >150 marcadores.

#### PERF-03: Polylines individuales por segmento de ruta
- **Archivo:** `components/map/MapView.tsx` (~línea 2150-2260)
- **Problema:** En modo "COMPLETO", cada punto de la ruta crea un componente `<OptimizedPolyline>` separado. Con 200 puntos = 200 componentes React + 200 objetos Leaflet polyline.
- **Solución:** Agrupar segmentos por bucket de opacidad (3-4 polylines vs 200).
- **Mejora estimada:** 60-80% menos elementos DOM durante animación.

#### PERF-04: History points sin cache de iconos
- **Archivo:** `components/map/MapView.tsx` (~línea 2350-2440)
- **Problema:** Cada punto del historial crea un `L.divIcon` nuevo (NO usa `getCachedIcon`). Con 200+ puntos visibles = 200 DOM nodes únicos. Debería usar `L.circleMarker` (Canvas) en vez de `L.divIcon` (DOM).
- **Mejora estimada:** 50-70% menos elementos DOM en animación.

#### PERF-05: Múltiples `setMoviles()` causan cascadas de re-render
- **Archivo:** `app/dashboard/page.tsx` (~línea 848, 1487, 1587)
- **Problema:** Al menos 5 `useEffect` diferentes llaman a `setMoviles()`, cada uno causando: dashboard re-render → MovilSelector → MapView → todos los hijos.
- **Solución:** Usar `useReducer` o store externo (Zustand).
- **Mejora estimada:** 30-50% menos cascadas de re-render.

#### PERF-06: Sin culling de viewport para marcadores no agrupados
- **Problema:** Todos los marcadores (200+ pedidos + 80+ móviles + 50+ POIs = 330+ DOM elements) se renderizan siempre, sin importar si están visibles en el viewport actual.
- **Nota:** Existe `components/map/ViewportCulling.tsx` con `useViewportCulling` pero **nunca se importa ni usa** en ningún componente.
- **Mejora estimada:** 30-50% menos nodos DOM a zoom típico.

### 2.2 Hallazgos Medios

| ID | Descripción | Mejora Est. |
|----|-------------|-------------|
| PERF-07 | Cache de íconos sin límite de tamaño (MapOptimizations.tsx) — crece ilimitadamente | Menor (memoria) |
| PERF-08 | `filterHistoryByTime` no memoizado — crea Date objects en cada render | 10-20% CPU animación |
| PERF-09 | Service Worker solo cachea tiles OSM — no CartoDB, Esri, temas dark/light | Significativo para no-OSM |
| PERF-10 | `OptimizedPolyline` usa `JSON.stringify` para comparar props | 5-10% más rápido |
| PERF-11 | `markInactiveMoviles` crea nuevos objetos en cada render (no memoizado) | 10-20% menos allocations |
| PERF-12 | Triple actualización: polling 30s + Realtime + `usePedidosRealtime` hook — redundante | 33% menos requests |
| PERF-13 | `preferCanvas={true}` no ayuda — todos los marcadores usan `divIcon` (DOM) | Informativo |
| PERF-14 | `arePropsEqual` itera array completo de móviles O(n) en cada render padre | Menor |
| PERF-15 | Controles Leaflet (filter/legend) se destruyen y recrean al cambiar filtro | DOM thrashing |

### 2.3 Hallazgos Buenos ✅

- Zone layers (`DemorasZonasLayer`, `DistribucionZonasLayer`, etc.) están correctamente memoizados con `memo()` + `useMemo`.
- GPS Batch Queue (`lib/gps-batch-queue.ts`) está bien diseñado con batching, backoff exponencial y recovery a disco.
- Icon caching existe y funciona (`getCachedIcon` en MapOptimizations).

### 2.4 Top 5 Fixes por Prioridad

| # | Hallazgo | Impacto | Esfuerzo |
|---|----------|---------|----------|
| 1 | PERF-01 — Arrays inline en props MapView | **Crítico** | Bajo |
| 2 | PERF-02 + PERF-04 — Animaciones CSS + history divIcons | **Alto** | Medio |
| 3 | PERF-03 — 200 polylines individuales | **Alto** | Medio |
| 4 | PERF-05 — Cascadas de setMoviles | **Alto** | Alto |
| 5 | PERF-06 — Sin viewport culling (ViewportCulling.tsx existe pero nunca se usa) | **Alto** | Medio |

> **Nota:** Corregir solo PERF-01 y PERF-02 produciría una **reducción del 50-70%** en re-renders innecesarios y trabajo GPU bajo carga típica.

---

## 3. Código Muerto / Sin Usar / Mock

### 3.1 Archivos Backup (eliminar)

| Archivo | Descripción |
|---------|-------------|
| `app/page.tsx.bak` | Home page legacy |
| `components/ui/MovilSelector.tsx.bak` | MovilSelector viejo |
| `package.json.backup-` | Backup de package.json |

### 3.2 Código Mock (completamente muerto)

| Archivo | Líneas | Descripción |
|---------|--------|-------------|
| `lib/db-mock.ts` | 97 | Datos GPS falsos para móviles 693, 251, 337 en Asunción. **CERO imports** en el codebase. Completamente muerto. |

### 3.3 Componentes Huérfanos (nunca importados)

| Componente | Descripción |
|------------|-------------|
| `components/demo/RealtimeDemo.tsx` | Demo de Supabase Realtime — 255 líneas, sin imports |
| `components/dashboard/MovilesSinGPS.tsx` | Muestra móviles sin GPS — 74 líneas, sin imports |
| `components/ui/InfoPanel.tsx` | Panel informativo — sin imports |
| `components/ui/MovilInfoCard.tsx` | Card de info de móvil — sin imports |
| `components/ui/LoadingSpinner.tsx` | Spinner de carga — sin imports |
| `components/map/ViewportCulling.tsx` | **Viewport culling implementado pero nunca conectado** — resolvería PERF-06 |

### 3.4 Archivos/Directorios Muertos

| Archivo/Dir | Descripción |
|-------------|-------------|
| `src/app/page.tsx` | Boilerplate default de Next.js — la app real usa `app/page.tsx`. Todo el directorio `src/app/` es scaffolding muerto. |
| `lib/api/services.example.ts` | Template de ejemplo — sin imports |
| `lib/validation.ts` | 401 líneas de schemas Zod — **CERO imports** en todo el codebase |
| `lib/rate-limit.ts` | Referenciado solo desde `proxy.ts` que probablemente no se usa |
| `proxy.ts` | Renombrado de `middleware.ts` — puede no ser reconocido por Next.js 16 |

### 3.5 Dependencias npm Sin Usar

| Paquete | Versión | Estado |
|---------|---------|--------|
| `nanoid` | ^5.1.6 | **CERO imports** en source files |
| `@supabase/auth-helpers-nextjs` | ^0.15.0 | **CERO imports** — la app usa `@supabase/ssr` en su lugar |
| `zod` | ^4.3.6 | Solo en `lib/validation.ts` que es código muerto |

### 3.6 Rutas API Potencialmente Sin Usar

| Ruta | ¿Llamada desde frontend? |
|------|--------------------------|
| `/api/coordinates` | NO — cero llamadas encontradas |
| `/api/latest` | NO — cero llamadas encontradas |
| `/api/doc` | NO desde frontend — solo navegación directa |
| `/api/debug/toggle` | Solo via curl — herramienta backend |
| `/api/pedido-detalle/[pedidoId]` | NO — cero llamadas encontradas |
| `/api/servicio-detalle/[servicioId]` | NO — cero llamadas encontradas |

### 3.7 Tipos Exportados Sin Usar (`types/index.ts`)

Los siguientes types se exportan pero **nunca se importan** desde archivos activos:

`EmpresaFletera`, `MovilEmpresa`, `PedidosServiciosResponse`, `PedidosServiciosPendientesResponse`, `MovilUnified`, `GPSPosition`, `PedidoPendiente`, `ServiceData`, `PedidoData`, `PuntoInteresData`, `MovilInsert`, `PedidoInsert`, `ServiceInsert`, `EmpresaFleteraInsert`, `GPSTrackingInsert`

### 3.8 `console.log` en producción

20+ llamadas a `console.log` en componentes de producción (MapView.tsx, PedidosTableModal.tsx, ZonasAsignacionModal.tsx, RealtimeProvider.tsx, MapOptimizations.tsx, dashboard/page.tsx). Deberían usar el sistema `gpsLog` de `debug-config.ts` o eliminarse.

### 3.9 Scripts de Diagnóstico (raíz del proyecto)

12+ scripts `.sh` diagnósticos/one-time en la raíz del proyecto: `analisis-forense.sh`, `aumentar-fd-limit.sh`, `diagnostico-conexion.sh`, `diagnostico-load.sh`, `monitorear-conexiones.sh`, `ver-errores.sh`, `ver-login-completo.sh`, `test-conexion-track.sh`, `test-pedidos-api.sh`, `fix-dependencies.sh`, `deploy-empresa-999-fix.sh`, `DEPLOY_FORCE_REBUILD.sh`.

> Se recomienda mover a un directorio `scripts/diagnostico/` o eliminar los que ya no sean necesarios.

---

## 4. Bug: Contador "Ped. sin Asig."

### 4.1 Síntoma
El indicador "Ped. sin Asig." en `DashboardIndicators.tsx` muestra **36** cuando el número real debería ser significativamente menor.

### 4.2 Flujo de Datos

```
1. dashboard/page.tsx → fetchPedidos()
   GET /api/pedidos?escenario=1000&fecha=YYYY-MM-DD
   
2. /api/pedidos/route.ts
   Query: pedidos WHERE escenario=1000 AND fecha=hoy
   ⚠️ NO filtra por estado → retorna TODOS (pendientes + finalizados)
   
3. dashboard/page.tsx → pedidosCompletos (useMemo)
   Merge: pedidosIniciales + pedidosRealtime
   → Array con TODOS los pedidos del día
   
4. <DashboardIndicators pedidos={pedidosCompletos} />
   → Recibe TODOS los pedidos (todos los estados)
   
5. DashboardIndicators.tsx línea 22:
   sinAsignar = pedidos.filter(p => !p.movil || Number(p.movil) === 0)
   ⚠️ NO filtra por estado_nro === 1 (pendiente)
   → Cuenta pedidos finalizados SIN móvil también
```

### 4.3 Causa Raíz

**El filtro `sinAsignar` no verifica `estado_nro`**. Cuenta TODOS los pedidos del día que no tienen móvil asignado, incluyendo:
- `estado_nro = 1` (pendiente) ← **los que DEBERÍA contar**
- `estado_nro = 2` (finalizado) ← **NO debería contarlos**
- Cualquier otro estado

### 4.4 Evidencia Comparativa

Otros componentes del codebase SÍ filtran correctamente:
- `ZonaEstadisticasModal.tsx` línea ~161: filtra `sinAsignar` con `Number(p.estado_nro) === 1`
- `MapView.tsx`: marcadores de pedidos pendientes filtran por `estado_nro === 1`
- El propio `DashboardIndicators.tsx` usa `estado_nro === 2` correctamente para `finalizados`

### 4.5 Fix Requerido

```tsx
// ACTUAL (bug):
let sinAsignar = pedidos.filter(p => !p.movil || Number(p.movil) === 0);

// CORRECTO:
let sinAsignar = pedidos.filter(p => 
  Number(p.estado_nro) === 1 && 
  (!p.movil || Number(p.movil) === 0)
);
```

---

## 5. Resumen Ejecutivo

### Hallazgos Totales

| Categoría | Crítico | Alto | Medio | Bajo | Total |
|-----------|---------|------|-------|------|-------|
| Seguridad | 4 | 6 | 8 | 6 | **24** |
| Rendimiento | 1 | 5 | 9 | — | **15** |
| Código Muerto | — | — | — | — | **~35 items** |
| Bugs | 1 | — | — | — | **1** |

### Acciones Urgentes (hacer AHORA)

1. **Rotar TODAS las credenciales** expuestas en Git (Supabase keys, DB password, API keys, GPS token)
2. **Habilitar `ENABLE_SECURITY_CHECKS=true`** en producción
3. **Parametrizar queries SQL** en `as400-api/api_as400.py`
4. **Corregir filtro `sinAsignar`** para incluir solo `estado_nro === 1`

### Acciones Recomendadas (próximas 2 semanas)

1. Implementar PERF-01 (memoizar arrays en dashboard) — mayor impacto con menor esfuerzo
2. Implementar PERF-02 (animaciones condicionales) + PERF-04 (cache history icons)
3. Habilitar `NODE_TLS_REJECT_UNAUTHORIZED=1` con certificados válidos
4. Eliminar archivos backup, código mock y componentes huérfanos
5. Conectar `ViewportCulling.tsx` que ya existe pero no se usa

### Acciones a Mediano Plazo (próximo mes)

1. Migrar de `localStorage` a `httpOnly` cookies para tokens
2. Implementar autenticación en rutas API descubiertas
3. Migrar a `useReducer`/Zustand para estado de móviles
4. Reducir polylines de 200 individuales a 3-4 agrupados
5. Limpiar dependencias npm sin usar y tipos huérfanos

---

## 6. Correcciones Aplicadas (2025-07-07)

### Dependencias
- **Next.js**: Actualizado de 16.1.6 a **16.1.7** — corrige 5 CVEs (HTTP request smuggling, image cache DoS, postponed buffering DoS, CSRF bypass, HMR websocket CSRF)

### VULN-01: Seguridad deshabilitada en producción — **CORREGIDO**
- `lib/auth-middleware.ts`: `SECURITY_ENABLED` ahora es `!== 'false'` (habilitado por defecto)
- `scripts/deploy-linux.sh`, `scripts/deploy-linux-organized.sh`, `scripts/install-trackmovil-git.sh`: `ENABLE_SECURITY_CHECKS=true`

### VULN-05: TLS deshabilitado globalmente — **CORREGIDO**
- `pm2.config.js`: Removido `NODE_TLS_REJECT_UNAUTHORIZED=0`
- `scripts/*.sh`: Comentado `NODE_TLS_REJECT_UNAUTHORIZED=0`
- `app/api/proxy/[...path]/route.ts` y `app/api/proxy/login/route.ts`: `rejectUnauthorized` ahora lee de env var (configurable)

### VULN-09: Token GPS — timing-safe — **CORREGIDO**
- `lib/auth-middleware.ts`: API key comparación con `timingSafeEqual` via `safeCompare()`
- `app/api/import/gps/route.ts`: Token y API key comparación con `safeCompare()`

### VULN-11: CORS wildcard — **CORREGIDO**
- `proxy.ts`: Fallback CORS ya no usa `*`, se omite `Access-Control-Allow-Origin` si no hay origins configurados

### VULN-15: Logging de credenciales — **CORREGIDO**
- `app/api/auth/sync-session/route.ts`: Removido logging de `access_token`
- `app/api/proxy/login/route.ts`: Removido logging de body (credenciales) y data cruda

### VULN-17: Proxy SSRF whitelist amplia — **CORREGIDO**
- `app/api/proxy/[...path]/route.ts`: Removido `gestion\/.*$` catch-all, reemplazado con rutas específicas

### Security Headers — **NUEVO**
- `next.config.mjs`: Agregados X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy, X-DNS-Prefetch-Control

### Pendientes (no corregidos en este commit)
- **VULN-02**: Credenciales hardcodeadas en Git — requiere rotación manual
- **VULN-03**: SQL injection en AS400 — requiere refactor de api_as400.py
- **VULN-04**: service_role key en scripts — requiere gestor de secretos
- **VULN-06/07/08**: Rutas sin auth / IDOR — requiere agregar `requireAuth()` a cada ruta
- **VULN-10**: Tokens en localStorage — requiere migración a httpOnly cookies
- **flatted** CVE: Dependencia transitiva de eslint, requiere actualización de eslint

---

*Documento generado automáticamente como parte de auditoría de código. No se realizó ninguna modificación al código fuente.*
