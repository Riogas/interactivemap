# Saneamiento de hardcodeos por perfil — migración a funcionalidades

**Fecha:** 2026-06-01
**Autor:** dmedaglia + Claude
**Estado:** En discusión — pendiente decisiones del usuario sobre 4-5 puntos abiertos.

---

## 0. Resumen ejecutivo

Hoy el sistema mezcla 3 sistemas de control de acceso:

1. ✅ **Funcionalidades** (`hasFuncionalidad(roles, 'NombreCanónico')`) — bien diseñado, ya cubre ~16 acciones.
2. ⚠️ **isRoot legacy** (`user.isRoot === 'S'`) — string literal repartido en ~30 lugares.
3. ⚠️ **IDs de rol hardcodeados** (`'48' | '49' | '50'` para Dashboard/Despacho/Supervisor) — repetido ~7 veces.

El objetivo es que el SISTEMA DE FUNCIONALIDADES sea la única fuente de verdad, con un único bypass coherente para Root. Esto baja la deuda técnica, hace el sistema más declarativo y permite que la asignación de permisos sea data-driven en vez de code-driven.

---

## 1. Inventario completo de hardcodeos detectados

### 1.1 `lib/auth-scope.ts` — el "hub" oficial

| Símbolo | Hardcodeo | Significado |
|---|---|---|
| `isRoot()` | `user.isRoot === 'S'` + `RolNombre === 'Root'` | Reconoce 2 formas (legacy + nuevo) |
| `isDespacho()` | `RolId === '49'` | Helper específico Despacho |
| `shouldScopeByEmpresa()` | usa `!isRoot() && !isDespacho()` | Composición |
| `isPrivilegedForZonaScope()` | `Set(['48', '49', '50'])` | Dashboard + Despacho + Supervisor |
| `isPrivilegedForCapEntrega()` | `Set(['48', '49', '50'])` | Mismo set |
| `isPrivilegedForUnassignedVisibility()` | `Set(['48', '49', '50'])` | Mismo set |

**Tres funciones distintas con el mismo Set repetido en cada una.**

### 1.2 `app/dashboard/page.tsx:2422` — duplicado

```ts
isPrivilegedUser = isRoot(user) ||
  (user?.roles?.some(r => [48, 49, 50].includes(Number(r.RolId))) ?? false);
```

Lo mismo que las 3 funciones de auth-scope.ts pero con **números** (no strings) y código inline.

### 1.3 `user.isRoot === 'S'` literal — ~30 lugares

**API admin routes (~12 endpoints):**
- `/api/admin/escenario-settings`
- `/api/admin/login-blocks` (2 rutas)
- `/api/admin/login-logs`
- `/api/admin/login-security/config`
- `/api/admin/login-security/unblock`
- `/api/admin/login-security/usuario-detalle`
- `/api/admin/notificaciones` (4 rutas)
- `/api/admin/recalcular-cap-entrega-all`
- `/api/admin/upload-manual`
- `/api/admin/usuarios-empresa` (2 rutas)
- `/api/moviles-dia/rebuild`

**Admin UI pages (~12 lugares):**
- `app/admin/configuracion/page.tsx` (2)
- `app/admin/login-blocks/page.tsx` (6)
- `app/admin/login-logs/page.tsx` (1)
- `app/admin/notificaciones/page.tsx` (3)

**Componentes UI (~6 lugares):**
- `MovilSelector.tsx` (drift indicator)
- `PreferencesModal.tsx` (sección admin)
- `PreferenciasGlobalesModal.tsx` (3 lugares)

### 1.4 Otros hardcodeos relacionados

- `MOVIL_ESTADOS_INACTIVOS = Set([3, 5, 15])` (`lib/movil-estados.ts`)
- Mismo array `[3, 5, 15]` en `docs/sqls/2026-05-25-vw-zona-capacidad-v2.sql`
- Defaults nocturno `NIGHT_START_HOUR=20.5`, `DAY_START_HOUR=6` (`lib/horario-servicio.ts`)

---

## 2. Sistema de funcionalidades — estado actual

### 2.1 Funcionalidades YA existentes en el código (16)

Identificadas via `grep hasFuncionalidad`:

| Funcionalidad | Usado en |
|---|---|
| `PermiteLogin` | AuthContext (gate de login) |
| `Ver Historico` | FloatingToolbar (cambio de fecha) |
| `Estadistica RiogasTracking` | (legacy, deprecating) |
| `Ranking de moviles` | (legacy) |
| `Estadistica Global RiogasTracking` | dashboard/stats/layout + page |
| `Estadisticas por zona` | dashboard FAB |
| `Capa Capacidad de Entrega` | dashboard mapa |
| `Ped s/asignar acumulados` | dashboard + stats |
| `Ped s/asignar x zona` | dashboard mapa |
| `Ped s/asignar unitarios` | dashboard markers + colapsable |
| `Gestion de Usuarios` | FloatingToolbar + usuarios-empresa |
| `Query incidentes` | FloatingToolbar |
| `Conf. Globales x Escenario` | FloatingToolbar |
| `Preferencias Globales` | FloatingToolbar |
| `Query Logs/Auditoria` | FloatingToolbar |
| `Query Inicios de sesion` | FloatingToolbar |
| `Notificacion de novedades` | FloatingToolbar |

**Observación:** Las 10 "nuevas funcionalidades" del backlog (PendientesARevisarRiogasTracking, item 6) **ya están casi todas creadas**. Faltan solo 3-4.

### 2.2 Funcionalidades que faltan crear (basado en el backlog item 6)

| Nombre canónico propuesto | Para gatear |
|---|---|
| `Mantenimiento P.Interes` | Botón/menú de mantenimiento de Puntos de Interés |
| `Estadist.Global x Zona` | Tab "x Zona" del centro estadístico |
| `Estadist.Global x Movil` | Tab "x Móvil" del centro estadístico |
| `Estadist.Global x EFL` | Tab "x EFL" del centro estadístico |

### 2.3 Funcionalidades nuevas para reemplazar los Sets de RolId

| Funcionalidad propuesta | Reemplaza |
|---|---|
| `Ver sin asignar (acumulado y por zona)` | `isPrivilegedForUnassignedVisibility` / lo que hoy hace el Set [48,49,50] en stats |
| `Ver sobrecupos Cap. Entrega` | `isPrivilegedForCapEntrega` (parte de "ver negativos") |
| `Ver todas las zonas (sin scope de empresa)` | `isPrivilegedForZonaScope` |

**Alternativa más conservadora:** reusar las existentes (`Ped s/asignar acumulados`, `Capa Capacidad de Entrega`) y solo crear las que faltan.

### 2.4 Permisos exclusivos de Root (no convertibles a funcionalidad)

Algunos endpoints/UI son **estrictamente para Root** y no tiene sentido exponerlos como funcionalidad (son acciones de bajo nivel del sistema):

- `/api/moviles-dia/rebuild` (reconstrucción de cache crítica)
- `/api/admin/login-security/*` (seguridad core)
- `/api/admin/upload-manual` (cargar manuales)
- `/api/admin/escenario-settings` (configuración global del escenario)

Estos quedan con un guard `isRoot(user)` (helper centralizado), pero **eliminando la comparación literal**. Es decir: la comparación `=== 'S'` se reemplaza, pero el gate sigue siendo "solo root".

---

## 3. Mapping completo: cada hardcodeo → reemplazo

### 3.1 `auth-scope.ts` — refactor interno

```ts
// ANTES
export function isDespacho(user) {
  return user?.roles?.some((r) => String(r.RolId) === '49') ?? false;
}

// DESPUÉS (opción A — eliminamos isDespacho como gate, lo hacemos data-driven)
// Despacho es solo un nombre — el "gate de despacho" en realidad significa
// "no aplica scope por empresa". Eso se vuelve una funcionalidad:
//   'Ver todas las empresas' (que tendrían Root, Despacho, y opcionalmente otros)
// y la función shouldScopeByEmpresa() solo consulta hasFuncionalidad.

// DESPUÉS (opción B — conservar isDespacho pero centralizar)
const DESPACHO_ROL_ID = '49';
export function isDespacho(user) {
  return user?.roles?.some((r) => String(r.RolId) === DESPACHO_ROL_ID) ?? false;
}
```

**Mismo tratamiento para `isPrivilegedFor*`** — pasarlas a funcionalidades.

### 3.2 dashboard/page.tsx:2422

```ts
// ANTES
const isPrivilegedUser = useMemo(
  () => isRoot(user) ||
    (user?.roles?.some(r => [48, 49, 50].includes(Number(r.RolId))) ?? false),
  [user],
);

// DESPUÉS
const isPrivilegedUser = useMemo(
  () => isRoot(user) || hasFuncionalidad(user?.roles, 'Ver pedidos sin asignar global'),
  [user],
);
// O reusar canVerAcumulados / canVerSinAsigPorZona según el contexto exacto donde se usa.
```

### 3.3 `user.isRoot === 'S'` literal → `isRoot(user)`

Reemplazo mecánico en ~30 lugares:

```ts
// ANTES
if (user.isRoot !== 'S') {
  router.push('/dashboard');
}

// DESPUÉS
if (!isRoot(user)) {
  router.push('/dashboard');
}
```

**En API routes:**

```ts
// ANTES
if (isRoot !== 'S') {
  return NextResponse.json({ success: false, error: 'Acceso denegado' }, { status: 403 });
}

// DESPUÉS — necesita importar isRoot del auth-scope.ts y construir el shape esperado
// O crear un helper de gate para API:
import { requireRoot } from '@/lib/api-auth-gates';
const gate = requireRoot(request);
if (gate !== true) return gate;
```

Hoy `requireRoot` ya existe en `app/api/admin/recalcular-cap-entrega-all/route.ts` — extraerlo a `lib/api-auth-gates.ts` y usarlo en los 12 endpoints.

### 3.4 Estados móvil hardcodeados

`MOVIL_ESTADOS_INACTIVOS` ya está centralizado en `lib/movil-estados.ts`. El array `[3,5,15]` en SQL es un duplicado deliberado (no se puede importar TS desde SQL). Opciones:

- **A:** dejarlo como está, con comentario "sync con `lib/movil-estados.ts`" y test que verifique consistencia.
- **B:** crear una **tabla `movil_estados_catalogo`** (id, descripcion, tipo_operativo enum 'activo' | 'inactivo' | 'pausa') y consultarla en runtime. Mucho más invasivo. **Defer.**

**Recomendación:** A. Si esto se considera fixeable, se puede hacer como tarea aparte.

---

## 4. Plan de saneamiento en 4 fases

### Fase 1 — Centralizar el helper `isRoot(user)` (S, 1-2 hs)

**Objetivo:** eliminar las ~30 comparaciones `=== 'S'` literales.

Tareas:
1. Crear `lib/api-auth-gates.ts` con `requireRoot(request): true | NextResponse` (extraído de recalcular-cap-entrega-all).
2. Reemplazar mecánicamente en TODOS los endpoints `/api/admin/*` y `/api/moviles-dia/rebuild`.
3. Reemplazar en las admin UI pages: `user.isRoot !== 'S'` → `!isRoot(user)`. Importar `isRoot` donde falte.
4. Reemplazar en componentes UI (`MovilSelector`, `PreferencesModal`, `PreferenciasGlobalesModal`).
5. Tests: existentes deben pasar; agregar 1 test que verifique que un user con rol "Root" pero sin flag legacy isRoot='S' tiene acceso a un endpoint admin (test integración).

**Riesgo:** muy bajo. Cambio mecánico, comportamiento equivalente para todos los usuarios actuales.

**Beneficio:** un user con rol Root nuevo (sin flag legacy) funciona correctamente en todos los gates admin. Hoy probablemente falla en varios.

### Fase 2 — Eliminar duplicado [48,49,50] en dashboard (S, 30 min)

**Objetivo:** unificar el helper `isPrivilegedUser` de dashboard/page.tsx con el sistema central.

Tareas:
1. Decidir: ¿reusar `isPrivilegedForUnassignedVisibility(user)` directamente o consolidar a funcionalidad?
2. Reemplazar `isPrivilegedUser` por `isPrivilegedForUnassignedVisibility(user)` (camino corto) o `hasFuncionalidad(user?.roles, 'X')` (camino largo, requiere crear la funcionalidad nueva).
3. Si vamos por camino corto: dejar TODO consolidado y unificado pero todavía vía `isPrivilegedFor*`.

**Riesgo:** bajo si camino corto. Medio si tocamos las funciones.

**Beneficio:** 1 fuente de verdad en vez de 2.

### Fase 3 — Convertir `isPrivilegedFor*` a funcionalidades (M, ~1 día)

**Objetivo:** que TODO el control de acceso pase por funcionalidades. Borrar las 3 funciones `isPrivilegedFor*` del auth-scope.ts.

Tareas:
1. **Decidir nomenclatura.** Propuesto:
   - `isPrivilegedForCapEntrega` → funcionalidad **`Cap. Entrega - ver sobrecupos`**
   - `isPrivilegedForZonaScope` → funcionalidad **`Ver todas las empresas`** (también reemplaza `isDespacho` en el gate de scope)
   - `isPrivilegedForUnassignedVisibility` → funcionalidad **`Ver pedidos sin asignar (global)`**
2. **Crear las funcionalidades nuevas en el SecuritySuite** (proceso operativo: ¿quién/cómo?).
3. **Asignar las funcionalidades nuevas a los 4 roles actuales** (Root, Despacho, Dashboard, Supervisor — 12 asignaciones en total).
4. **Refactor en código:**
   - Reemplazar `isPrivilegedForCapEntrega(user)` por `hasFuncionalidad(user?.roles, 'Cap. Entrega - ver sobrecupos')` en `SaturacionZonasLayer`.
   - Mismo tratamiento para los otros 2 usos.
   - Borrar las 3 funciones de auth-scope.ts.
5. Tests: cambios visibles para los 4 roles.

**Riesgo:** medio. Si la migración de asignaciones no se hace correctamente, usuarios de Despacho/Dashboard/Supervisor pueden perder acceso. **Hacer un release atómico** que (a) cree las funcionalidades, (b) las asigne a los 4 roles, (c) deploy del código nuevo.

**Beneficio:** sistema 100% data-driven. Si mañana un cliente quiere darle "ver sobrecupos" a un rol nuevo, se hace por configuración, no por código.

### Fase 4 — Crear las 4 funcionalidades pendientes (S, ~2 hs)

Las del backlog item 6 que aún no están:

1. **`Mantenimiento P.Interes`** — gatear el botón/menú de POIs.
2. **`Estadist.Global x Zona`** — gatear el tab del centro estadístico.
3. **`Estadist.Global x Movil`** — gatear el tab.
4. **`Estadist.Global x EFL`** — gatear el tab.

Tareas:
1. Crear las 4 en el SecuritySuite.
2. Asignar inicial: a) si quedan default-on para todos → solo Root y Supervisor; b) si quedan default-off → solo Root.
3. Agregar gates en el código:
   - Mantenimiento P.Interes: localizar el botón/menú y meter `canVerMantenPoi = isRoot(user) || hasFuncionalidad(...)`.
   - Estadist.Global x Zona/Movil/EFL: en `app/dashboard/stats/page.tsx`, gatear cada tab.

**Riesgo:** bajo.

---

## 5. Decisiones abiertas (las clave)

### 5.1 Camino largo o corto en Fase 2?
**Camino corto:** reemplazar `isPrivilegedUser` por `isPrivilegedForUnassignedVisibility(user)`. Misma lógica, sin nuevas funcionalidades.

**Camino largo:** ya saltar a Fase 3 (convertir todo a funcionalidad).

→ **Recomiendo camino corto** + Fase 3 después. Itera más rápido y baja el riesgo.

### 5.2 Cómo se crean las funcionalidades nuevas (4 + 3) operativamente?
¿Hay endpoint admin para crearlas? ¿Las creás vos manualmente en SecuritySuite? ¿Se hace via SQL?

→ Necesito que me digas el proceso para saber qué genero como entregable (SQL? script? UI?).

### 5.3 Despacho como "ve todas las empresas" — ¿coincide siempre?
Hoy `isDespacho()` se usa en `shouldScopeByEmpresa()` para decir "si es Despacho, no aplique scope". Si en el futuro quieren un Despacho con scope (caso raro), hoy no se puede.

→ **Propuesta:** convertir a funcionalidad `Ver todas las empresas`. Despacho la tiene por defecto. Si mañana sale el caso raro, le sacás la funcionalidad y listo.

→ **Confirmación:** ¿el rol Despacho (RolId 49) SIEMPRE debe ver todas las empresas? Si la respuesta es "sí siempre", podemos dejarlo hardcoded como excepción y solo refactorizar los 3 isPrivilegedFor*.

### 5.4 Estados móvil hardcodeados (`[3,5,15]`) en SQL vs TS
**Opción A (cheap):** dejar como está + test de consistencia.
**Opción B (overkill):** tabla catálogo en BD.

→ **Recomiendo A**.

### 5.5 Mapeo de grupos SGM → roles (backlog item 5)
Esto es un sistema aparte (la sincro con SGM). NO entra en este saneamiento; ese es el item 3.1 del backlog "PendientesARevisarRiogasTracking" y se trata por separado.

→ **Confirmación:** mantener separado, ¿OK?

---

## 6. Comparativa antes vs después

| Aspecto | Hoy | Después de Fases 1-4 |
|---|---|---|
| Comparaciones `=== 'S'` literales | ~30 lugares | 0 |
| Sets de RolId `['48','49','50']` repetidos | 3 lugares en auth-scope.ts | 0 |
| Arrays `[48,49,50]` hardcoded inline | 1 en dashboard | 0 |
| Funciones `isPrivilegedFor*` | 3 (con misma lógica) | 0 |
| Funcionalidades en uso | 16 | 19-23 (depende decisiones) |
| Cambio de rol = nuevo deploy | Sí | Solo si se cambia el catálogo de funcionalidades |

---

## 7. Estimaciones

| Fase | Esfuerzo | Riesgo | Beneficio | Prioridad |
|---|---|---|---|---|
| F1 - Centralizar isRoot | 1-2 hs | Bajo | Alto | P0 |
| F2 - Eliminar duplicado [48,49,50] | 30 min | Bajo | Medio | P0 |
| F3 - Convertir isPrivilegedFor* | ~1 día | Medio | Alto | P1 |
| F4 - 4 funcionalidades pendientes | ~2 hs | Bajo | Medio | P1 |

**Total: ~2 días de trabajo + tiempo operativo de SecuritySuite.**

---

## 8. Puntos abiertos / por confirmar

1. ¿Camino corto o largo en F2? (recomendación: corto)
2. ¿Cómo se crean nuevas funcionalidades en SecuritySuite? (SQL/UI/API)
3. ¿Despacho = "ve todas las empresas" SIEMPRE? (si sí, se simplifica F3)
4. ¿Estados móvil hardcoded en SQL: A o B? (recomendación: A)
5. ¿Vamos en este orden F1 → F2 → F3 → F4, o priorizamos F1+F2 y dejamos F3+F4 para más adelante?
6. ¿La asignación de las funcionalidades nuevas a roles existentes la hacés vos (SecuritySuite) o necesitás scripts SQL?

Cuando confirmes los puntos 1-6, generamos el plan ejecutable.
