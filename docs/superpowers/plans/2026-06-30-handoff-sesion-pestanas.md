# Handoff de sesión entre pestañas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que una pestaña nueva del mismo navegador abra ya logueada, pidiendo la sesión a las pestañas hermanas vía `BroadcastChannel`, sin romper el modelo `sessionStorage` (la sesión sigue muriendo al cerrar todas las pestañas).

**Architecture:** Un módulo puro `lib/session-handoff.ts` define las keys de auth, el armado/parseo de los mensajes del protocolo y el collect/apply de la sesión. `contexts/AuthContext.tsx` abre un `BroadcastChannel('trackmovil-auth')` en el bootstrap: responde a pedidos de otras pestañas si tiene sesión, y si él mismo arranca sin sesión local, pide una y espera ≤600ms antes de caer al login.

**Tech Stack:** Next.js (App Router) + TypeScript, Vitest (unit), `BroadcastChannel` (API nativa del browser).

## Global Constraints

- No cambiar el backing store de auth: sigue `sessionStorage` (vía `authStorage` de `lib/auth-storage.ts`).
- Sin persistencia entre cierres de navegador ni "recordarme". El handoff es solo entre pestañas vivas del mismo navegador/origen.
- Timeout de espera del handoff: `HANDOFF_TIMEOUT_MS = 600` (ms).
- Nombre del canal: `'trackmovil-auth'`.
- Keys de auth a transferir (exactas): `trackmovil_user`, `trackmovil_token`, `trackmovil_allowed_empresas`, `trackmovil_allowed_escenarios`, `trackmovil_escenario_id`, `trackmovil_permisos`, `trackmovil_last_activity`.
- Cero regresión: con sesión local presente, o sin `BroadcastChannel`, o ante timeout/expiración → comportamiento actual (carga normal o `/login`).
- La sesión recibida se valida por expiración (reusar `isSessionExpired`) antes de hidratar.
- Sin nuevas dependencias.
- Se trabaja directo sobre `dev`; commits frecuentes; `git push origin dev` al final.

## File Structure

- `lib/session-handoff.ts` — **crear**: lógica pura del handoff (keys, collect/apply, protocolo de mensajes + type guards). Módulo hoja, sin imports del proyecto. Testeable aislado.
- `__tests__/session-handoff.test.ts` — **crear**: unit tests de la lógica pura.
- `contexts/AuthContext.tsx` — **modificar**: refactor del `useEffect` de carga inicial (líneas 256-333) para (a) extraer la hidratación a una función reusable y (b) abrir el `BroadcastChannel` que responde a pedidos y, si no hay sesión local, pide una y espera.

---

### Task 1: `lib/session-handoff.ts` (lógica pura) + tests

**Files:**
- Create: `lib/session-handoff.ts`
- Test: `__tests__/session-handoff.test.ts`

**Interfaces:**
- Consumes: nada del proyecto (módulo hoja).
- Produces:
  - `export const AUTH_KEYS: readonly string[]`
  - `export const HANDOFF_CHANNEL = 'trackmovil-auth'`
  - `export const HANDOFF_TIMEOUT_MS = 600`
  - `export type HandoffRequest = { type: 'REQUEST_SESSION'; nonce: string }`
  - `export type HandoffResponse = { type: 'SESSION_RESPONSE'; nonce: string; payload: Record<string, string> }`
  - `export type HandoffMessage = HandoffRequest | HandoffResponse`
  - `export function collectSession(read: (k: string) => string | null): Record<string, string> | null`
  - `export function applySession(payload: Record<string, string>, write: (k: string, v: string) => void): void`
  - `export function buildRequest(nonce: string): HandoffRequest`
  - `export function buildResponse(nonce: string, payload: Record<string, string>): HandoffResponse`
  - `export function isRequest(msg: unknown): msg is HandoffRequest`
  - `export function matchesResponse(msg: unknown, nonce: string): msg is HandoffResponse`

- [ ] **Step 1: Escribir el test que falla**

Crear `__tests__/session-handoff.test.ts`:

```typescript
/**
 * Tests unitarios para lib/session-handoff.ts (lógica pura del handoff de sesión
 * entre pestañas). El wiring de BroadcastChannel se valida manualmente.
 */
import { describe, it, expect } from 'vitest';
import {
  AUTH_KEYS,
  collectSession,
  applySession,
  buildRequest,
  buildResponse,
  isRequest,
  matchesResponse,
} from '@/lib/session-handoff';

/** Crea un read/write sobre un objeto plano simulando un storage. */
function fakeStore(initial: Record<string, string> = {}) {
  const data: Record<string, string> = { ...initial };
  return {
    data,
    read: (k: string): string | null => (k in data ? data[k] : null),
    write: (k: string, v: string): void => { data[k] = v; },
  };
}

const FULL = {
  trackmovil_user: '{"id":"835","username":"supervisor"}',
  trackmovil_token: 'tok-abc',
  trackmovil_allowed_empresas: '[1,2]',
  trackmovil_allowed_escenarios: '[1000]',
  trackmovil_escenario_id: '1000',
  trackmovil_permisos: '["stats"]',
  trackmovil_last_activity: '1782828973000',
};

describe('collectSession()', () => {
  it('junta todas las AUTH_KEYS presentes', () => {
    const { read } = fakeStore(FULL);
    expect(collectSession(read)).toEqual(FULL);
  });

  it('devuelve null si falta el token', () => {
    const { trackmovil_token, ...rest } = FULL;
    const { read } = fakeStore(rest);
    expect(collectSession(read)).toBeNull();
  });

  it('devuelve null si falta el user', () => {
    const { trackmovil_user, ...rest } = FULL;
    const { read } = fakeStore(rest);
    expect(collectSession(read)).toBeNull();
  });

  it('ignora keys opcionales ausentes', () => {
    const min = { trackmovil_user: FULL.trackmovil_user, trackmovil_token: FULL.trackmovil_token };
    const { read } = fakeStore(min);
    expect(collectSession(read)).toEqual(min);
  });

  it('solo considera AUTH_KEYS (ignora keys ajenas)', () => {
    const { read } = fakeStore({ ...FULL, otra_cosa: 'x' });
    const result = collectSession(read);
    expect(result).not.toBeNull();
    expect(Object.keys(result!).every((k) => AUTH_KEYS.includes(k))).toBe(true);
  });
});

describe('applySession()', () => {
  it('escribe las keys del payload y el roundtrip preserva', () => {
    const dst = fakeStore();
    applySession(FULL, dst.write);
    expect(collectSession(dst.read)).toEqual(FULL);
  });

  it('escribe solo las AUTH_KEYS del payload (ignora ajenas)', () => {
    const dst = fakeStore();
    applySession({ ...FULL, hack: 'no' }, dst.write);
    expect('hack' in dst.data).toBe(false);
  });
});

describe('protocolo de mensajes', () => {
  it('buildRequest / isRequest', () => {
    const req = buildRequest('n1');
    expect(req).toEqual({ type: 'REQUEST_SESSION', nonce: 'n1' });
    expect(isRequest(req)).toBe(true);
    expect(isRequest(buildResponse('n1', FULL))).toBe(false);
    expect(isRequest(null)).toBe(false);
    expect(isRequest({ type: 'REQUEST_SESSION' })).toBe(false);
  });

  it('buildResponse / matchesResponse exige type + nonce correctos', () => {
    const res = buildResponse('n1', FULL);
    expect(res).toEqual({ type: 'SESSION_RESPONSE', nonce: 'n1', payload: FULL });
    expect(matchesResponse(res, 'n1')).toBe(true);
    expect(matchesResponse(res, 'otro')).toBe(false);
    expect(matchesResponse(buildRequest('n1'), 'n1')).toBe(false);
    expect(matchesResponse({ type: 'SESSION_RESPONSE', nonce: 'n1' }, 'n1')).toBe(false);
    expect(matchesResponse(null, 'n1')).toBe(false);
  });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `npx vitest run __tests__/session-handoff.test.ts`
Expected: FAIL — no existe `@/lib/session-handoff`.

- [ ] **Step 3: Implementar `lib/session-handoff.ts`**

```typescript
/**
 * Lógica pura del handoff de sesión entre pestañas (ver
 * docs/superpowers/specs/2026-06-30-handoff-sesion-pestanas-design.md).
 *
 * No importa nada del proyecto: solo arma/parsea los mensajes que viajan por el
 * BroadcastChannel y junta/aplica las keys de auth desde/hacia un storage abstracto.
 * El wiring del canal vive en contexts/AuthContext.tsx.
 */

/** Nombre del BroadcastChannel usado para el handoff. */
export const HANDOFF_CHANNEL = 'trackmovil-auth';

/** Cuánto espera una pestaña nueva una respuesta antes de caer al login. */
export const HANDOFF_TIMEOUT_MS = 600;

/**
 * Keys de auth que viven en sessionStorage (las que maneja authStorage).
 * `trackmovil_user` y `trackmovil_token` son obligatorias para que haya sesión.
 */
export const AUTH_KEYS = [
  'trackmovil_user',
  'trackmovil_token',
  'trackmovil_allowed_empresas',
  'trackmovil_allowed_escenarios',
  'trackmovil_escenario_id',
  'trackmovil_permisos',
  'trackmovil_last_activity',
] as const;

export type HandoffRequest = { type: 'REQUEST_SESSION'; nonce: string };
export type HandoffResponse = { type: 'SESSION_RESPONSE'; nonce: string; payload: Record<string, string> };
export type HandoffMessage = HandoffRequest | HandoffResponse;

/**
 * Junta de un storage las AUTH_KEYS presentes. Devuelve null si falta user o token
 * (no hay sesión transferible).
 */
export function collectSession(read: (k: string) => string | null): Record<string, string> | null {
  const user = read('trackmovil_user');
  const token = read('trackmovil_token');
  if (!user || !token) return null;

  const payload: Record<string, string> = {};
  for (const k of AUTH_KEYS) {
    const v = read(k);
    if (v !== null && v !== undefined) payload[k] = v;
  }
  return payload;
}

/** Escribe en el storage destino solo las AUTH_KEYS presentes en el payload. */
export function applySession(payload: Record<string, string>, write: (k: string, v: string) => void): void {
  for (const k of AUTH_KEYS) {
    const v = payload[k];
    if (typeof v === 'string') write(k, v);
  }
}

export function buildRequest(nonce: string): HandoffRequest {
  return { type: 'REQUEST_SESSION', nonce };
}

export function buildResponse(nonce: string, payload: Record<string, string>): HandoffResponse {
  return { type: 'SESSION_RESPONSE', nonce, payload };
}

export function isRequest(msg: unknown): msg is HandoffRequest {
  return (
    typeof msg === 'object' && msg !== null &&
    (msg as { type?: unknown }).type === 'REQUEST_SESSION' &&
    typeof (msg as { nonce?: unknown }).nonce === 'string'
  );
}

export function matchesResponse(msg: unknown, nonce: string): msg is HandoffResponse {
  return (
    typeof msg === 'object' && msg !== null &&
    (msg as { type?: unknown }).type === 'SESSION_RESPONSE' &&
    (msg as { nonce?: unknown }).nonce === nonce &&
    typeof (msg as { payload?: unknown }).payload === 'object' &&
    (msg as { payload?: unknown }).payload !== null
  );
}
```

- [ ] **Step 4: Correr el test para verificar que pasa**

Run: `npx vitest run __tests__/session-handoff.test.ts`
Expected: PASS (todos los casos verdes).

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: sin errores nuevos.

- [ ] **Step 6: Commit**

```bash
git add lib/session-handoff.ts __tests__/session-handoff.test.ts
git commit -m "feat(auth): logica pura de handoff de sesion entre pestanas"
```

---

### Task 2: Wiring del handoff en `AuthContext` (bootstrap)

**Files:**
- Modify: `contexts/AuthContext.tsx` (imports + el `useEffect` de carga inicial, líneas 256-333)

**Interfaces:**
- Consumes: `HANDOFF_CHANNEL`, `HANDOFF_TIMEOUT_MS`, `collectSession`, `applySession`, `buildRequest`, `buildResponse`, `isRequest`, `matchesResponse` de `@/lib/session-handoff` (Task 1).
- Produces: ninguno (consumo final, comportamiento de UI).

- [ ] **Step 1: Agregar el import en `contexts/AuthContext.tsx`**

Agregar junto a los otros imports `@/lib/...` (ej. debajo del import de `session-expiry`):

```typescript
import {
  HANDOFF_CHANNEL,
  HANDOFF_TIMEOUT_MS,
  collectSession,
  applySession,
  buildRequest,
  buildResponse,
  isRequest,
  matchesResponse,
} from '@/lib/session-handoff';
```

- [ ] **Step 2: Reemplazar el `useEffect` de carga inicial**

Reemplazar **todo** el bloque actual (desde el comentario `// Cargar sesión desde localStorage al iniciar` hasta su `}, []);`):

```typescript
  // Cargar sesión desde localStorage al iniciar
  useEffect(() => {
    const savedUser = authStorage.getItem('trackmovil_user');
    const savedToken = authStorage.getItem('trackmovil_token');

    if (savedUser && savedToken) {
      try {
        // Validar que savedUser sea JSON válido
        if (!savedUser.startsWith('{')) {
          throw new Error('Invalid user data format');
        }

        const parsedUser = JSON.parse(savedUser);

        // Validar que tenga campos mínimos requeridos
        if (!parsedUser.username || !parsedUser.id) {
          throw new Error('Invalid user data structure');
        }

        // ⏰ Verificar expiración de sesión (inactividad, con override por atributo de rol)
        if (isSessionExpired(parsedUser.loginTime, flattenAtributos(parsedUser))) {
          clearExpiredSession();
          setIsLoading(false);
          return;
        }

        // Cargar empresas permitidas desde localStorage
        const savedEmpresas = authStorage.getItem('trackmovil_allowed_empresas');
        let allowedEmpresas: number[] | null = null;
        if (savedEmpresas) {
          try {
            allowedEmpresas = JSON.parse(savedEmpresas);
          } catch (e) {
            console.warn('⚠️ Error parsing allowed empresas:', e);
          }
        }

        // Cargar escenarios permitidos desde localStorage
        const savedEscenarios = authStorage.getItem('trackmovil_allowed_escenarios');
        let allowedEscenarios: number[] | null = null;
        if (savedEscenarios) {
          try {
            allowedEscenarios = JSON.parse(savedEscenarios);
          } catch (e) {
            console.warn('⚠️ Error parsing allowed escenarios:', e);
          }
        }

        // Cargar escenario persistido
        const savedEscenario = authStorage.getItem('trackmovil_escenario_id');
        if (savedEscenario) setEscenarioId(parseInt(savedEscenario, 10));

        // Cargar permisos persistidos
        const savedPermisos = authStorage.getItem('trackmovil_permisos');
        if (savedPermisos) {
          try {
            const arr: string[] = JSON.parse(savedPermisos);
            setPermisos(new Set(arr));
          } catch {
            // ignore: se recargarán si el usuario hace algo
          }
        }

        setUser({
          ...parsedUser,
          token: savedToken,
          allowedEmpresas,
          allowedEscenarios,
        });
      } catch (e) {
        console.error('Error al cargar sesión, limpiando localStorage:', e);
        // Limpiar datos corruptos
        authStorage.removeItem('trackmovil_user');
        authStorage.removeItem('trackmovil_token');
      }
    }
    setIsLoading(false);
  }, []);
```

por este (extrae la hidratación a `hydrateFromStorage()` y agrega el `BroadcastChannel`):

```typescript
  // Cargar sesión al iniciar, con handoff entre pestañas.
  //
  // La sesión vive en sessionStorage (por pestaña, a propósito). Una pestaña nueva
  // (ej. el botón "Abrir mapa" que abre /dashboard con target=_blank) arranca sin
  // sesión propia. Para no mandarla al login, le pide la sesión a las pestañas
  // hermanas del mismo navegador vía BroadcastChannel y, si alguna responde a
  // tiempo, la hidrata. Si nadie responde en HANDOFF_TIMEOUT_MS, cae al login.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let channel: BroadcastChannel | null = null;

    /**
     * Lee la sesión de authStorage y, si es válida, hidrata el estado.
     * Retorna 'ok' | 'none' (no hay) | 'expired' | 'error'. No toca isLoading.
     */
    const hydrateFromStorage = (): 'ok' | 'none' | 'expired' | 'error' => {
      const savedUser = authStorage.getItem('trackmovil_user');
      const savedToken = authStorage.getItem('trackmovil_token');
      if (!savedUser || !savedToken) return 'none';

      try {
        if (!savedUser.startsWith('{')) throw new Error('Invalid user data format');
        const parsedUser = JSON.parse(savedUser);
        if (!parsedUser.username || !parsedUser.id) throw new Error('Invalid user data structure');

        if (isSessionExpired(parsedUser.loginTime, flattenAtributos(parsedUser))) {
          clearExpiredSession();
          return 'expired';
        }

        const savedEmpresas = authStorage.getItem('trackmovil_allowed_empresas');
        let allowedEmpresas: number[] | null = null;
        if (savedEmpresas) {
          try { allowedEmpresas = JSON.parse(savedEmpresas); }
          catch (e) { console.warn('⚠️ Error parsing allowed empresas:', e); }
        }

        const savedEscenarios = authStorage.getItem('trackmovil_allowed_escenarios');
        let allowedEscenarios: number[] | null = null;
        if (savedEscenarios) {
          try { allowedEscenarios = JSON.parse(savedEscenarios); }
          catch (e) { console.warn('⚠️ Error parsing allowed escenarios:', e); }
        }

        const savedEscenario = authStorage.getItem('trackmovil_escenario_id');
        if (savedEscenario) setEscenarioId(parseInt(savedEscenario, 10));

        const savedPermisos = authStorage.getItem('trackmovil_permisos');
        if (savedPermisos) {
          try { setPermisos(new Set(JSON.parse(savedPermisos) as string[])); }
          catch { /* se recargarán si el usuario hace algo */ }
        }

        setUser({ ...parsedUser, token: savedToken, allowedEmpresas, allowedEscenarios });
        return 'ok';
      } catch (e) {
        console.error('Error al cargar sesión, limpiando localStorage:', e);
        authStorage.removeItem('trackmovil_user');
        authStorage.removeItem('trackmovil_token');
        return 'error';
      }
    };

    const nonce =
      (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random()}`;

    // Abrir el canal (vive lo que vive el provider): responde a pedidos de otras
    // pestañas y, abajo, lo usamos para pedir sesión si hace falta.
    if (typeof BroadcastChannel !== 'undefined') {
      channel = new BroadcastChannel(HANDOFF_CHANNEL);
      channel.onmessage = (ev: MessageEvent) => {
        const msg = ev.data;
        // Responder: si esta pestaña tiene sesión, mandársela a quien la pidió.
        if (isRequest(msg)) {
          const payload = collectSession((k) => authStorage.getItem(k));
          if (payload && channel) channel.postMessage(buildResponse(msg.nonce, payload));
          return;
        }
        // Recibir: respuesta a NUESTRO pedido de bootstrap.
        if (matchesResponse(msg, nonce) && !cancelled) {
          if (timer) { clearTimeout(timer); timer = null; }
          applySession(msg.payload, (k, v) => authStorage.setItem(k, v));
          const res = hydrateFromStorage(); // re-lee el storage ya poblado, valida expiración
          if (res !== 'ok') setIsLoading(false); // expirada/ inválida → login
        }
      };
    }

    // Bootstrap: primero intentar sesión local.
    const local = hydrateFromStorage();
    if (local !== 'none') {
      // Había sesión (ok) o estaba expirada/corrupta (ya limpiada). Listo.
      setIsLoading(false);
      return () => { cancelled = true; if (timer) clearTimeout(timer); channel?.close(); };
    }

    // Sin sesión local → pedir handoff y esperar. Sin canal → login directo.
    if (channel) {
      timer = setTimeout(() => { if (!cancelled) setIsLoading(false); }, HANDOFF_TIMEOUT_MS);
      channel.postMessage(buildRequest(nonce));
    } else {
      setIsLoading(false);
    }

    return () => { cancelled = true; if (timer) clearTimeout(timer); channel?.close(); };
  }, []);
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: sin errores nuevos.

- [ ] **Step 4: Suite completa (no romper nada existente)**

Run: `npx vitest run`
Expected: PASS (incluye `session-handoff.test.ts`, `role-attributes.test.ts`, `landing-route.test.ts` y el resto).

- [ ] **Step 5: Verificación manual (golden path)**

Requiere build/dev corriendo apuntando a un backend válido y un usuario logueable.
1. Loguear normalmente → cae en su pantalla (igual que hoy).
2. En `/stats` (usuario con `PantallaLogin=stats`), clic en el botón "Abrir mapa" → la
   pestaña nueva abre **ya logueada** en el mapa (no pide login).
3. Cerrar TODAS las pestañas de la app y reabrir una → pide login (la sesión murió, no persiste).
4. F5 en una pestaña logueada → sigue logueada (sin parpadeo de login).

Expected: los 4 puntos se cumplen.

- [ ] **Step 6: Commit y push**

```bash
git add contexts/AuthContext.tsx
git commit -m "feat(auth): pestana nueva hereda la sesion via BroadcastChannel (default login)"
git push origin dev
```

---

## Self-Review

**1. Spec coverage:**
- `lib/session-handoff.ts` con keys, collect/apply, protocolo + guards → Task 1. ✅
- Bootstrap: sesión local sin cambios; sin sesión → request + espera 600ms → hidratar o login → Task 2. ✅
- Responder que contesta a pedidos si tiene sesión → `onmessage`/`isRequest` en Task 2. ✅
- Validación de expiración de la sesión recibida (`isSessionExpired` vía `hydrateFromStorage`) → Task 2. ✅
- Fallbacks (sin BroadcastChannel, timeout, expirada, nonce no matchea) → Task 2 + guards Task 1. ✅
- Nombre de canal `'trackmovil-auth'`, timeout 600ms, keys exactas → Global Constraints + Task 1. ✅
- Seguridad same-origin (BroadcastChannel) y nonce → inherente al diseño. ✅
- Tests de la lógica pura → Task 1. ✅
- Fuera de alcance (no cambia store, no persiste, no toca login/logout, no sincroniza logout) → respetado. ✅

**2. Placeholder scan:** sin TBD/TODO; todo el código está completo y literal (incluido el bloque viejo a reemplazar, para anclar el find/replace). ✅

**3. Type consistency:** los símbolos exportados por `lib/session-handoff.ts` en Task 1 (`HANDOFF_CHANNEL`, `HANDOFF_TIMEOUT_MS`, `collectSession`, `applySession`, `buildRequest`, `buildResponse`, `isRequest`, `matchesResponse`) coinciden exactamente con los importados y usados en Task 2. `hydrateFromStorage` retorna `'ok' | 'none' | 'expired' | 'error'` y se consume coherente en ambos puntos (bootstrap local y respuesta del canal). ✅

**Nota de diseño (deviación menor vs spec):** el responder envía la sesión si `collectSession` ≠ null (tiene user+token), sin revalidar expiración de su lado; la validación de expiración ocurre en el **requester** (vía `hydrateFromStorage` → `isSessionExpired`), que es el safety net end-to-end. Evita duplicar la lógica de expiración y parseo en el responder (DRY). El efecto neto cumple la spec: una sesión expirada recibida se descarta y cae al login.
