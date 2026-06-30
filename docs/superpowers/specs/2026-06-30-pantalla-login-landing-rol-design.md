# Preferencia de pantalla de inicio por rol (`PantallaLogin`)

**Fecha:** 2026-06-30
**Estado:** Diseño aprobado, pendiente de implementación

## Problema

Hoy todo usuario aterriza en el **mapa** (`/dashboard`) al loguearse: el redirect está
hardcodeado en `app/login/page.tsx` (`router.push('/dashboard')`) y en `app/page.tsx`
(root → `/dashboard` cuando ya hay sesión).

Aparece un perfil tipo **"supervisor"** al que no le interesa el mapa, sólo las
estadísticas globales (`/dashboard/stats`). Queremos que ese tipo de usuario aterrice
directo en stats, sin abrir el mapa.

## Decisión de diseño

Es una **preferencia de aterrizaje, no un candado**. El usuario igual puede navegar al
mapa desde el menú; sólo cambia la pantalla que se abre al iniciar sesión.

Lo modelamos como un **atributo de rol genérico** (`PantallaLogin`), data-driven desde el
SecuritySuite, consistente con el patrón ya existente (`EmpFletera`, `Escenario`,
`HistoricoMaxCoords`, `TiempoInactividadMin`). **No** se hardcodea el rol "supervisor" en
ningún lado: cualquier rol puede tener su landing.

## Catálogo de pantallas (mapa cerrado, en código)

| Clave (case-insensitive) | Ruta              | Gate de acceso requerido                                          |
|--------------------------|-------------------|------------------------------------------------------------------|
| `mapa`                   | `/dashboard`      | (ninguno)                                                        |
| `stats`                  | `/dashboard/stats`| `isRoot` **o** funcionalidad `'Estadistica Global RiogasTracking'`|

- Vacío o clave desconocida → `/dashboard` (comportamiento actual preservado).
- Extensible con una línea (ej. `ranking → /dashboard/ranking` con su propio gate).

> **Nota (corrección durante el plan):** el acceso a `/dashboard/stats` está gateado por
> **funcionalidad** (`'Estadistica Global RiogasTracking'`), no por el Set de permisos
> (`hasPermiso('stats')`). El gate es el mismo que ya aplica `app/dashboard/stats/layout.tsx`
> (`isRoot(user) || hasFuncionalidad(user.roles, 'Estadistica Global RiogasTracking')`). El
> helper lo reutiliza para no mandar al usuario a una pantalla de la que el guard lo rebotaría.

## Convención del atributo en SecuritySuite

- Atributo de rol: `PantallaLogin`.
- `valor` (defensivo, acepta ambas formas):
  - JSON string: `{"Pantalla":"stats"}` (consistente con los otros atributos, que son JSON strings).
  - String pelado: `stats`.
- **Case-insensitive**: `stats`, `STATS`, `Stats` son equivalentes. Se normaliza con
  `trim().toLowerCase()`.

## Componentes

### 1. Helper `resolveLandingRoute` en `lib/role-attributes.ts`

Función pura, testeable de forma aislada. Vive junto a los otros helpers de atributos de rol.
Recibe el `user` (lo necesita para el gate de acceso: `isRoot` + `hasFuncionalidad`).

```
resolveLandingRoute(
  user: LandingUser | null | undefined,   // shape mínimo: { isRoot?, roles?[{ RolNombre?, atributos?, funcionalidades? }] }
): string  // siempre devuelve una ruta válida; default '/dashboard'
```

Lógica:
1. Recorrer `user.roles` **en orden**; el **primero** que tenga atributo `PantallaLogin` con
   valor no vacío gana (regla "primero gana"). Los demás se ignoran.
2. Leer `valor` de forma defensiva: intentar `JSON.parse`; si es objeto, tomar la clave
   `Pantalla` (o el primer valor string si no está `Pantalla`); si el parse falla, usar el
   string crudo. Normalizar con `trim().toLowerCase()`.
3. Buscar la clave normalizada en el catálogo. Si no existe → `/dashboard`.
4. Si la pantalla resuelta tiene gate (`canAccess`) y el usuario no lo pasa → `/dashboard`
   (defensa en profundidad: nunca mandar a una pantalla de la que el guard lo rebotaría).
5. Si ningún rol define `PantallaLogin` → `/dashboard`.

Toda rama de error/ausencia cae al mapa: la feature nunca empeora el comportamiento actual.

### 2. Integración en `AuthContext.login()`

`login()` ya tiene `newUser` (con `roles` mapeados, que incluyen `atributos` y
`funcionalidades`) en scope justo antes del `return`. Computa la ruta ahí con
`resolveLandingRoute(newUser)` y la devuelve:

```
return { success: true, landingRoute, ...(warning ? { warning } : {}) };
```

Se extiende el tipo de retorno de `login()` (y de `AuthContextType.login`) para incluir
`landingRoute?: string`.

### 3. `app/login/page.tsx`

Reemplazar el `router.push('/dashboard')` fijo por:

```
router.push(result.landingRoute ?? '/dashboard');
```

(El `result` ya se castea para leer campos extra como `warning`; se agrega `landingRoute`.)

### 4. `app/page.tsx` (root, usuario ya autenticado)

Para mantener **una sola fuente de verdad**, cuando `isAuthenticated` usar:

```
router.push(resolveLandingRoute(user.roles, permisos));
```

en lugar del `'/dashboard'` fijo. Requiere leer `user` del `useAuth()` (además de `isAuthenticated`).

## Flujo de datos

```
SecuritySuite (atributo PantallaLogin en rol)
        │  (response.roles[].atributos[])
        ▼
AuthContext.login() ── arma newUser ──► resolveLandingRoute(newUser)
        │                                        │
        │ devuelve { success, landingRoute }     │ (función pura, también usada por app/page.tsx)
        ▼                                        ▼
login/page.tsx → router.push(landingRoute)   app/page.tsx → router.push(resolveLandingRoute(user))
```

## Manejo de errores / casos borde

- `valor` con JSON inválido → fallback a string crudo → si no matchea catálogo → `/dashboard`.
- Clave desconocida (typo del admin) → `/dashboard`.
- `stats` sin la funcionalidad `'Estadistica Global RiogasTracking'` (y no root) → `/dashboard`.
- Usuario sin roles / sin `PantallaLogin` → `/dashboard`.
- Multi-rol con valores en conflicto → gana el primero en `roles[]`.

## Tests (`__tests__`, patrón unitario ya existente para `role-attributes.ts`)

- `stats`, `STATS`, `{"Pantalla":"stats"}` (con funcionalidad o root) → `/dashboard/stats`.
- `mapa` → `/dashboard`.
- vacío / clave basura / rol sin atributo → `/dashboard`.
- `stats` sin la funcionalidad (y no root) → `/dashboard`.
- multi-rol: el primero con `PantallaLogin` gana.
- JSON inválido en `valor` → no rompe, cae a `/dashboard`.

## Fuera de alcance

- No agrega restricciones de navegación (el mapa sigue accesible para todos).
- No modifica el SecuritySuite (el atributo se carga del lado del SecuritySuite).
- No hardcodea el rol "supervisor".
- No agrega un selector de "pantalla de inicio" en la UI del usuario (es config de rol).
