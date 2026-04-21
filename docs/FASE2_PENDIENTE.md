# TrackMovil — Fase 2 pendiente (login/escenarios)

Contexto: terminamos la **Fase 1** (adaptar TrackMovil al nuevo response del login del Security Suite, con `preferencias` inline para `EmpFletera` y `Escenario`). Queda pendiente la Fase 2.

## Lo que YA quedó hecho (Fase 1)

- `lib/api/auth.ts`: `ParsedLoginResponse` actualizado — `roles`, `preferencias`, `accesos` al nivel raíz, con el shape nuevo (`rolId, rolNombre, aplicacionId, funcionalidades`).
- `contexts/AuthContext.tsx`:
  - Helper `parsePreferencia(prefs, atributo)` que entiende el formato `[{Nombre, Valor}]` (array).
  - Parseo local de `response.preferencias` para `EmpFletera` y `Escenario` (reemplaza el fetch a `/api/user-atributos`).
  - Validaciones (solo no-root):
    - Sin `Escenario` → login bloqueado: "El usuario no tiene escenarios asignados. Contacte al administrador."
    - `selectedEscenarioId` fuera de `allowedEscenarios` → login bloqueado: "No tiene acceso al escenario seleccionado."
  - Root: bypass total — `allowedEmpresas` y `allowedEscenarios` quedan `null`, ve lo que eligió en el combo.
  - `allowedEscenarios` persistido en `localStorage['trackmovil_allowed_escenarios']`.
  - Mapeo de `roles` nuevo → shape viejo (`RolId, RolNombre, RolTipo`) para no romper `sync-session`/Supabase.
- `app/api/user-atributos/route.ts`: eliminado.

## Fase 2 — pendiente

### 1. Tabla de escenarios + endpoint `GET /api/escenarios`
- Confirmar si ya existe la tabla de escenarios en la BD del Security Suite (o donde corresponda). Si no existe, crearla.
- Shape sugerido para el response del endpoint: `[{ id: number, nombre: string }]` (o `{ Nombre, Valor }` para mantener consistencia con `preferencias`).
- Definir autorización: ¿público para usuarios autenticados? ¿todos los usuarios ven todos los escenarios de la tabla, o se filtra por algo?

### 2. Combo dinámico en pantalla de login
- `app/login/page.tsx:19-21`: hoy `ESCENARIOS` está hardcoded a `[{ label: 'Montevideo', value: 1000 }]`.
- Reemplazar por un `fetch('/api/escenarios')` en `useEffect` (pre-login) y poblar el `<select>`.
- Mantener el default `1000` mientras carga, o mostrar spinner.

### 3. Pantalla de preferencias con combo de escenario (solo root)
- El usuario root puede cambiar de escenario post-login y eso cambia todo lo que ve en el mapa.
- Ubicación: nueva pantalla `/preferencias` o modal en el header del dashboard.
- Cuando cambia el escenario:
  - Actualizar `escenarioId` en `AuthContext`.
  - Persistir en `localStorage['trackmovil_escenario_id']`.
  - Disparar refresh de los datos del mapa (móviles, pedidos, zonas).

### 4. Filtro real por `escenarioId` en queries del mapa
- Hoy `escenarioId` vive como estado en `AuthContext` pero **no se pasa a los endpoints** de móviles/pedidos/zonas.
- Antes de tocar nada: revisar los endpoints actuales para ver si ya soportan filtro por `escenarioId`:
  - `app/api/all-positions/`
  - `app/api/latest/`
  - `app/api/moviles-extended/`
  - `app/api/pedidos/`, `pedidos-pendientes/`, `pedidos-servicios/`, etc.
  - `app/api/zonas/`, `moviles-zonas/`, `fleteras-zonas/`.
- Si el backend (AS400 / GeneXus) ya acepta `escenarioId` como parámetro, solo hay que pasarlo desde los componentes → route handlers.
- Si NO lo acepta, coordinar con backend para agregarlo antes de tocar el frontend.

### Regla de filtrado aplicada al mapa (recordatorio)
- **Root** → sin filtro de fleteras. Aplica solo el `escenarioId` seleccionado.
- **No-root** → filtra por `allowedEmpresas` (fleteras) **Y** por `escenarioId` (que ya está validado en login contra `allowedEscenarios`).

## Formato de `preferencias` (referencia)

```json
"preferencias": [
  { "atributo": "EmpFletera", "valor": "[{\"Nombre\": \"SOFIZEN S.A. - BUCEO\", \"Valor\": 70}]" },
  { "atributo": "Escenario",  "valor": "[{\"Nombre\": \"Montevideo\", \"Valor\": 1000}]" }
]
```

Ambos son arrays JSON-string. Parser genérico ya está en `contexts/AuthContext.tsx` (`parsePreferencia`).
