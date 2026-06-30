# Preferencia de pantalla de inicio por rol (`PantallaLogin`) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que un rol defina, vía atributo `PantallaLogin`, a qué pantalla aterriza el usuario al iniciar sesión (default: el mapa, como hoy).

**Architecture:** Un helper puro `resolveLandingRoute(user)` en `lib/role-attributes.ts` lee el atributo de rol `PantallaLogin`, lo mapea contra un catálogo cerrado de pantallas (clave → ruta + gate de acceso) y devuelve siempre una ruta válida (default `/dashboard`). Se invoca desde los dos únicos puntos que deciden el aterrizaje: `AuthContext.login()` (devuelve `landingRoute`, consumido por `app/login/page.tsx`) y `app/page.tsx` (redirect del root para usuario ya autenticado).

**Tech Stack:** Next.js (App Router) + TypeScript, Vitest para tests unitarios, helpers existentes `isRoot` (`lib/auth-scope.ts`) y `hasFuncionalidad` (`lib/role-funcionalidades.ts`).

## Global Constraints

- Preferencia, NO restricción: el mapa sigue navegable para todos; sólo cambia la pantalla que se abre al loguear.
- Default siempre `/dashboard`: vacío, clave desconocida, JSON inválido, sin roles, o gate de acceso no superado → `/dashboard`. La feature nunca empeora el comportamiento actual.
- Clave del catálogo **case-insensitive** (`trim().toLowerCase()`).
- Multi-rol: gana el **primer** rol (en orden de `user.roles`) que tenga `PantallaLogin` con valor no vacío.
- Sin hardcodeo del rol "supervisor" en ningún lado: todo data-driven por el atributo.
- Gate de `/dashboard/stats`: `isRoot(user) || hasFuncionalidad(user.roles, 'Estadistica Global RiogasTracking')` — el mismo que ya aplica `app/dashboard/stats/layout.tsx`.
- Sin nuevas dependencias. Sin tocar el SecuritySuite (el atributo se carga allá).
- Commits frecuentes; al final `git push origin dev` (se trabaja directo sobre `dev`).

## File Structure

- `lib/role-attributes.ts` — **modificar**: agregar `resolveLandingRoute()`, el catálogo `LANDING_SCREENS`, el parser `parsePantallaValor()`, y la interface mínima `LandingUser`. Es el hogar natural (ya concentra la lectura de atributos de rol). Función pura → testeable aislada.
- `__tests__/landing-route.test.ts` — **crear**: tests unitarios de `resolveLandingRoute` (archivo nuevo aparte de `role-attributes.test.ts` para evitar conflictos y mantener foco).
- `contexts/AuthContext.tsx` — **modificar**: `login()` computa y devuelve `landingRoute`; ampliar el tipo de retorno y el de `AuthContextType.login`.
- `app/login/page.tsx` — **modificar**: usar `result.landingRoute ?? '/dashboard'` en el `router.push`.
- `app/page.tsx` — **modificar**: redirect del root usa `resolveLandingRoute(user)`.

---

### Task 1: Helper `resolveLandingRoute` + tests unitarios

**Files:**
- Modify: `lib/role-attributes.ts` (append al final del archivo)
- Test: `__tests__/landing-route.test.ts` (crear)

**Interfaces:**
- Consumes: `isRoot` de `@/lib/auth-scope`; `hasFuncionalidad` de `@/lib/role-funcionalidades`.
- Produces:
  - `export interface LandingUser { isRoot?: string; roles?: Array<{ RolNombre?: string; atributos?: Array<{ atributo: string; valor: string }>; funcionalidades?: Array<{ funcionalidadId: number; nombre: string }> }> }`
  - `export function resolveLandingRoute(user: LandingUser | null | undefined): string`

- [ ] **Step 1: Escribir el test que falla**

Crear `__tests__/landing-route.test.ts`:

```typescript
/**
 * Tests unitarios para resolveLandingRoute() de lib/role-attributes.ts
 *
 * Cubre los casos de la spec 2026-06-30-pantalla-login-landing-rol-design.md:
 *  - PantallaLogin ausente / vacío / sin roles → /dashboard (default).
 *  - 'mapa' → /dashboard.
 *  - 'stats' (con acceso) → /dashboard/stats; case-insensitive.
 *  - 'stats' sin funcionalidad ni root → /dashboard (defensa en profundidad).
 *  - root sin funcionalidad pero con 'stats' → /dashboard/stats (bypass).
 *  - valor JSON {"Pantalla":"stats"} y string pelado 'stats' → equivalentes.
 *  - clave desconocida / JSON basura → /dashboard.
 *  - multi-rol: primero con PantallaLogin gana (aunque su valor sea inválido).
 */

import { describe, it, expect } from 'vitest';
import { resolveLandingRoute, type LandingUser } from '@/lib/role-attributes';

const STATS_FUNC = { funcionalidadId: 1, nombre: 'Estadistica Global RiogasTracking' };

function role(
  atributos: Array<{ atributo: string; valor: string }> = [],
  funcionalidades: Array<{ funcionalidadId: number; nombre: string }> = [],
  RolNombre = 'Operador',
): NonNullable<LandingUser['roles']>[number] {
  return { RolNombre, atributos, funcionalidades };
}

function user(roles: NonNullable<LandingUser['roles']>, isRoot = 'N'): LandingUser {
  return { isRoot, roles };
}

describe('resolveLandingRoute()', () => {
  it('sin user / sin roles → /dashboard', () => {
    expect(resolveLandingRoute(null)).toBe('/dashboard');
    expect(resolveLandingRoute(undefined)).toBe('/dashboard');
    expect(resolveLandingRoute({ roles: [] })).toBe('/dashboard');
  });

  it('rol sin PantallaLogin → /dashboard', () => {
    expect(resolveLandingRoute(user([role()]))).toBe('/dashboard');
  });

  it('PantallaLogin vacío → /dashboard', () => {
    const u = user([role([{ atributo: 'PantallaLogin', valor: '' }])]);
    expect(resolveLandingRoute(u)).toBe('/dashboard');
  });

  it("'mapa' → /dashboard", () => {
    const u = user([role([{ atributo: 'PantallaLogin', valor: 'mapa' }])]);
    expect(resolveLandingRoute(u)).toBe('/dashboard');
  });

  it("'stats' con funcionalidad → /dashboard/stats", () => {
    const u = user([role([{ atributo: 'PantallaLogin', valor: 'stats' }], [STATS_FUNC])]);
    expect(resolveLandingRoute(u)).toBe('/dashboard/stats');
  });

  it("case-insensitive: 'STATS' y 'Stats' → /dashboard/stats", () => {
    for (const v of ['STATS', 'Stats', '  stats  ']) {
      const u = user([role([{ atributo: 'PantallaLogin', valor: v }], [STATS_FUNC])]);
      expect(resolveLandingRoute(u)).toBe('/dashboard/stats');
    }
  });

  it('valor JSON {"Pantalla":"stats"} → /dashboard/stats', () => {
    const u = user([
      role([{ atributo: 'PantallaLogin', valor: '{"Pantalla":"stats"}' }], [STATS_FUNC]),
    ]);
    expect(resolveLandingRoute(u)).toBe('/dashboard/stats');
  });

  it('valor JSON string "\\"stats\\"" → /dashboard/stats', () => {
    const u = user([role([{ atributo: 'PantallaLogin', valor: '"stats"' }], [STATS_FUNC])]);
    expect(resolveLandingRoute(u)).toBe('/dashboard/stats');
  });

  it("'stats' sin funcionalidad y no root → /dashboard (defensa en profundidad)", () => {
    const u = user([role([{ atributo: 'PantallaLogin', valor: 'stats' }])]);
    expect(resolveLandingRoute(u)).toBe('/dashboard');
  });

  it("'stats' siendo root (isRoot='S') sin funcionalidad → /dashboard/stats", () => {
    const u = user([role([{ atributo: 'PantallaLogin', valor: 'stats' }])], 'S');
    expect(resolveLandingRoute(u)).toBe('/dashboard/stats');
  });

  it("'stats' con rol 'Root' (sin isRoot flag) → /dashboard/stats", () => {
    const u = user([role([{ atributo: 'PantallaLogin', valor: 'stats' }], [], 'Root')]);
    expect(resolveLandingRoute(u)).toBe('/dashboard/stats');
  });

  it('clave desconocida → /dashboard', () => {
    const u = user([role([{ atributo: 'PantallaLogin', valor: 'inexistente' }])]);
    expect(resolveLandingRoute(u)).toBe('/dashboard');
  });

  it('JSON basura ({}) → /dashboard', () => {
    const u = user([role([{ atributo: 'PantallaLogin', valor: '{}' }])]);
    expect(resolveLandingRoute(u)).toBe('/dashboard');
  });

  it('multi-rol: el primero con PantallaLogin gana', () => {
    const u = user([
      role([{ atributo: 'PantallaLogin', valor: 'mapa' }], [STATS_FUNC]),
      role([{ atributo: 'PantallaLogin', valor: 'stats' }], [STATS_FUNC]),
    ]);
    expect(resolveLandingRoute(u)).toBe('/dashboard');
  });

  it('multi-rol: primero con valor inválido gana → /dashboard (no busca en el siguiente)', () => {
    const u = user([
      role([{ atributo: 'PantallaLogin', valor: 'inexistente' }], [STATS_FUNC]),
      role([{ atributo: 'PantallaLogin', valor: 'stats' }], [STATS_FUNC]),
    ]);
    expect(resolveLandingRoute(u)).toBe('/dashboard');
  });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `npx vitest run __tests__/landing-route.test.ts`
Expected: FAIL — `resolveLandingRoute is not a function` / no export `resolveLandingRoute`.

- [ ] **Step 3: Implementar el helper (append al final de `lib/role-attributes.ts`)**

```typescript
import { isRoot } from './auth-scope';
import { hasFuncionalidad } from './role-funcionalidades';

/**
 * Shape mínimo que necesita resolveLandingRoute. Compatible estructuralmente con
 * el `User` del AuthContext (sus roles incluyen RolNombre, atributos y funcionalidades).
 */
export interface LandingUser {
  isRoot?: string;
  roles?: Array<{
    RolNombre?: string;
    atributos?: Array<{ atributo: string; valor: string }>;
    funcionalidades?: Array<{ funcionalidadId: number; nombre: string }>;
  }>;
}

/** Ruta por defecto al iniciar sesión (el mapa) — comportamiento histórico. */
const DEFAULT_LANDING = '/dashboard';

/** Funcionalidad que habilita el acceso a /dashboard/stats (igual gate que stats/layout.tsx). */
const STATS_FUNCIONALIDAD = 'Estadistica Global RiogasTracking';

interface ScreenDef {
  route: string;
  /** Si está presente, el usuario debe pasarlo; si no, cae al default. */
  canAccess?: (user: LandingUser | null | undefined) => boolean;
}

/**
 * Catálogo cerrado de pantallas de aterrizaje. Las claves se comparan en minúsculas.
 * Extensible: agregar una entrada (ej. `ranking: { route: '/dashboard/ranking', canAccess: ... }`).
 */
const LANDING_SCREENS: Record<string, ScreenDef> = {
  mapa: { route: '/dashboard' },
  stats: {
    route: '/dashboard/stats',
    canAccess: (user) =>
      // Reutiliza los helpers existentes; los casts acotan la diferencia de shape
      // entre LandingUser y los tipos ScopedUser / RoleWithFuncionalidades.
      isRoot(user as Parameters<typeof isRoot>[0]) ||
      hasFuncionalidad(
        (user?.roles ?? []) as Parameters<typeof hasFuncionalidad>[0],
        STATS_FUNCIONALIDAD,
      ),
  },
};

/**
 * Extrae la clave de pantalla del `valor` del atributo PantallaLogin, de forma defensiva.
 * Acepta:
 *   - string pelado: `stats`
 *   - JSON string: `"stats"`
 *   - JSON objeto: `{"Pantalla":"stats"}` (clave canónica) o el primer valor string del objeto
 * Devuelve null si no logra extraer una clave.
 */
function parsePantallaValor(valor: string): string | null {
  const raw = String(valor).trim();
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'string') return parsed;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const obj = parsed as Record<string, unknown>;
      if (typeof obj.Pantalla === 'string') return obj.Pantalla;
      const firstStr = Object.values(obj).find((v) => typeof v === 'string');
      return typeof firstStr === 'string' ? firstStr : null;
    }
    return null;
  } catch {
    // No es JSON → el string crudo es la clave (ej. "stats").
    return raw;
  }
}

/**
 * Resuelve a qué ruta debe aterrizar el usuario al iniciar sesión, según el atributo
 * de rol `PantallaLogin`. Siempre devuelve una ruta válida; el default es el mapa
 * (`/dashboard`), preservando el comportamiento previo a esta feature.
 *
 * Reglas:
 *  - Gana el PRIMER rol (en orden) con `PantallaLogin` de valor no vacío.
 *  - Clave normalizada con trim().toLowerCase() contra un catálogo cerrado.
 *  - Si la pantalla tiene gate de acceso y el usuario no lo pasa → default (no se lo
 *    manda a una pantalla de la que el guard lo rebotaría).
 *  - Cualquier ausencia / valor inválido / clave desconocida → default.
 */
export function resolveLandingRoute(user: LandingUser | null | undefined): string {
  const roles = user?.roles ?? [];

  let rawKey: string | null = null;
  for (const role of roles) {
    const attr = (role.atributos ?? []).find((a) => a.atributo === 'PantallaLogin');
    if (attr?.valor != null && String(attr.valor).trim() !== '') {
      rawKey = parsePantallaValor(attr.valor); // primero gana, aunque su valor sea inválido
      break;
    }
  }
  if (!rawKey) return DEFAULT_LANDING;

  const key = rawKey.trim().toLowerCase();
  const screen = LANDING_SCREENS[key];
  if (!screen) return DEFAULT_LANDING; // clave desconocida
  if (screen.canAccess && !screen.canAccess(user)) return DEFAULT_LANDING; // sin acceso
  return screen.route;
}
```

- [ ] **Step 4: Correr el test para verificar que pasa**

Run: `npx vitest run __tests__/landing-route.test.ts`
Expected: PASS — todos los casos en verde.

- [ ] **Step 5: Type-check del proyecto**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: sin errores nuevos en `lib/role-attributes.ts` ni en el test.

- [ ] **Step 6: Commit**

```bash
git add lib/role-attributes.ts __tests__/landing-route.test.ts
git commit -m "feat(auth): resolveLandingRoute helper para preferencia PantallaLogin por rol"
```

---

### Task 2: Integrar en `AuthContext.login()` y `app/login/page.tsx`

**Files:**
- Modify: `contexts/AuthContext.tsx`
- Modify: `app/login/page.tsx:44`

**Interfaces:**
- Consumes: `resolveLandingRoute` de `@/lib/role-attributes` (Task 1).
- Produces: `login()` devuelve `{ success: boolean; error?: string; warning?: string; landingRoute?: string }`.

- [ ] **Step 1: Importar el helper en `AuthContext.tsx`**

Agregar al bloque de imports (junto a los otros `@/lib/...`):

```typescript
import { resolveLandingRoute } from '@/lib/role-attributes';
```

- [ ] **Step 2: Ampliar el tipo de retorno de `login` en `AuthContextType`**

En la interface `AuthContextType`, reemplazar la firma de `login`:

```typescript
  login: (username: string, password: string, escenarioId?: number) => Promise<{ success: boolean; error?: string; warning?: string; landingRoute?: string }>;
```

- [ ] **Step 3: Ampliar la firma interna de `login` y computar `landingRoute`**

En la declaración de `const login = async (...)`, ampliar el tipo de retorno declarado:

```typescript
  const login = async (username: string, password: string, selectedEscenarioId: number = 1000): Promise<{ success: boolean; error?: string; warning?: string; landingRoute?: string }> => {
```

Y en el bloque de éxito (justo después de `setEscenarioId(selectedEscenarioId);` y antes del `return` con warning), computar la ruta y devolverla. Reemplazar:

```typescript
        // Propagar warning del endpoint de seguridad (ej. USER_EQ_PASS) al consumidor
        const warning = (response as { warning?: string }).warning;
        return warning ? { success: true, warning } : { success: true };
```

por:

```typescript
        // Resolver la pantalla de aterrizaje según el atributo de rol PantallaLogin.
        // Default '/dashboard' (mapa) si no hay preferencia o no aplica.
        const landingRoute = resolveLandingRoute(newUser);

        // Propagar warning del endpoint de seguridad (ej. USER_EQ_PASS) al consumidor
        const warning = (response as { warning?: string }).warning;
        return warning
          ? { success: true, warning, landingRoute }
          : { success: true, landingRoute };
```

- [ ] **Step 4: Usar `landingRoute` en `app/login/page.tsx`**

En `app/login/page.tsx`, dentro de `if (result.success) { ... }`, reemplazar:

```typescript
        // Animacion de exito antes de redirigir
        await new Promise(resolve => setTimeout(resolve, 500));
        router.push('/dashboard');
```

por:

```typescript
        // Animacion de exito antes de redirigir
        await new Promise(resolve => setTimeout(resolve, 500));
        const landingRoute = (result as { landingRoute?: string }).landingRoute ?? '/dashboard';
        router.push(landingRoute);
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: sin errores nuevos.

- [ ] **Step 6: Verificar que la suite no se rompió**

Run: `npx vitest run`
Expected: PASS (incluye `landing-route.test.ts` y el resto; ningún test existente roto).

- [ ] **Step 7: Commit**

```bash
git add contexts/AuthContext.tsx app/login/page.tsx
git commit -m "feat(auth): login redirige a la pantalla de PantallaLogin (default mapa)"
```

---

### Task 3: Integrar en el redirect del root `app/page.tsx`

**Files:**
- Modify: `app/page.tsx`

**Interfaces:**
- Consumes: `resolveLandingRoute` de `@/lib/role-attributes` (Task 1); `user` de `useAuth()`.
- Produces: ninguno (consumo final).

- [ ] **Step 1: Importar el helper y leer `user` del contexto**

En `app/page.tsx`, agregar el import:

```typescript
import { resolveLandingRoute } from '@/lib/role-attributes';
```

y reemplazar la desestructuración del hook:

```typescript
  const { isAuthenticated } = useAuth();
```

por:

```typescript
  const { isAuthenticated, user } = useAuth();
```

- [ ] **Step 2: Usar `resolveLandingRoute` en el efecto de redirect**

Reemplazar el `useEffect`:

```typescript
  useEffect(() => {
    if (isAuthenticated) {
      router.push('/dashboard');
    } else {
      router.push('/login');
    }
  }, [isAuthenticated, router]);
```

por:

```typescript
  useEffect(() => {
    if (isAuthenticated) {
      router.push(resolveLandingRoute(user));
    } else {
      router.push('/login');
    }
  }, [isAuthenticated, user, router]);
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: sin errores nuevos.

- [ ] **Step 4: Verificación manual (golden path)**

Run: `pnpm dev` (o `npm run dev`) y, en el navegador:
1. Loguear con un usuario **sin** `PantallaLogin` → aterriza en el mapa (`/dashboard`). ✅ comportamiento actual.
2. Loguear con un usuario cuyo rol tiene `PantallaLogin = stats` y la funcionalidad `Estadistica Global RiogasTracking` → aterriza en `/dashboard/stats` sin pasar por el mapa.
3. Estando logueado en (2), navegar a `/` → vuelve a `/dashboard/stats` (consistencia root vs login).
4. Desde stats, el menú/navegación al mapa sigue funcionando (es preferencia, no candado).

Expected: los 4 puntos se cumplen.

- [ ] **Step 5: Commit y push**

```bash
git add app/page.tsx
git commit -m "feat(auth): root redirect respeta PantallaLogin para usuario autenticado"
git push origin dev
```

---

## Self-Review

**1. Spec coverage:**
- Catálogo cerrado `mapa`/`stats` + extensible → `LANDING_SCREENS` (Task 1). ✅
- Helper `resolveLandingRoute` con primero-gana, parse defensivo, case-insensitive, gate → Task 1 + tests. ✅
- Gate stats por funcionalidad/root (corrección del spec) → `canAccess` de `stats` (Task 1). ✅
- Integración en `login()` devolviendo `landingRoute` → Task 2. ✅
- `app/login/page.tsx` usa `landingRoute` → Task 2. ✅
- `app/page.tsx` usa `resolveLandingRoute(user)` (única fuente de verdad) → Task 3. ✅
- Todos los casos borde (vacío, basura, JSON inválido, sin roles, sin acceso) → tests Task 1. ✅
- Fuera de alcance (sin candado de navegación, sin tocar SecuritySuite, sin UI de selección, sin hardcodeo "supervisor") → respetado. ✅

**2. Placeholder scan:** sin TBD/TODO; todo el código está completo y literal. ✅

**3. Type consistency:** `LandingUser`, `resolveLandingRoute(user)`, `landingRoute` y los casts `Parameters<typeof isRoot>[0]` / `Parameters<typeof hasFuncionalidad>[0]` son consistentes entre Task 1 (definición) y Tasks 2-3 (consumo). El retorno de `login` se amplía de forma idéntica en `AuthContextType` y en la declaración interna. ✅
