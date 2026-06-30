# Handoff de sesión entre pestañas (BroadcastChannel)

**Fecha:** 2026-06-30
**Estado:** Diseño aprobado, pendiente de implementación

## Problema

La sesión de TrackMovil se guarda en **`sessionStorage`** a propósito (`lib/auth-storage.ts`):
no debe persistir más allá de la vida de la pestaña (se borra al cerrar pestaña/navegador/PC).

`sessionStorage` es **por pestaña**: no se comparte. Cuando se abre `/dashboard` en una
**pestaña nueva** (ej. el botón "Abrir mapa" del header de `/stats`, `target="_blank"`), esa
pestaña arranca con `sessionStorage` vacío → sin token → la app redirige a `/login`. El
usuario tiene que volver a loguearse, lo cual es molesto y rompe el flujo del kiosko.

## Objetivo

Que una pestaña nueva del **mismo navegador** abra **ya logueada**, sin reintroducir
persistencia de sesión más allá del cierre del navegador. Es decir: mantener el modelo
`sessionStorage` (la sesión muere cuando se cierran todas las pestañas) pero permitir que
una pestaña hermana "preste" la sesión a una recién abierta.

## Solución

**Handoff de sesión vía `BroadcastChannel`** (canal same-origin entre pestañas del mismo
navegador). Una pestaña que arranca sin sesión propia pide la sesión a las pestañas hermanas
antes de caer al login.

### Componente 1 — `lib/session-handoff.ts` (lógica pura, testeable)

- `AUTH_KEYS: readonly string[]` — las keys de auth que viven en `sessionStorage`:
  `trackmovil_user`, `trackmovil_token`, `trackmovil_allowed_empresas`,
  `trackmovil_allowed_escenarios`, `trackmovil_escenario_id`, `trackmovil_permisos`,
  `trackmovil_last_activity`.
- `collectSession(read: (k: string) => string | null): Record<string, string> | null`
  — junta de un storage las `AUTH_KEYS` presentes. Devuelve `null` si falta `trackmovil_user`
  o `trackmovil_token` (no hay sesión transferible).
- `applySession(payload: Record<string, string>, write: (k: string, v: string) => void): void`
  — escribe en el storage destino solo las `AUTH_KEYS` presentes en el payload.
- Protocolo de mensajes (objetos serializables que viajan por el canal):
  - `buildRequest(nonce: string): HandoffMessage` → `{ type: 'REQUEST_SESSION', nonce }`.
  - `buildResponse(nonce: string, payload): HandoffMessage` → `{ type: 'SESSION_RESPONSE', nonce, payload }`.
  - `isRequest(msg): boolean`, `matchesResponse(msg, nonce): boolean` — type guards que validan
    forma + nonce, para descartar mensajes ajenos/viejos.

### Componente 2 — Wiring en `contexts/AuthContext.tsx` (bootstrap)

En el `useEffect` de carga inicial (el que hoy lee `authStorage` al montar):

1. Si **hay** sesión local (`trackmovil_user` + `trackmovil_token` en `sessionStorage`):
   comportamiento actual sin cambios (carga + valida expiración + hidrata).
2. Si **no hay** sesión local (pestaña nueva):
   - Mantener `isLoading = true`.
   - Abrir `BroadcastChannel('trackmovil-auth')`, postear `buildRequest(nonce)` y esperar
     **hasta `HANDOFF_TIMEOUT_MS` (600ms)** una respuesta que matchee el nonce.
   - Al recibir respuesta válida: `applySession(payload, authStorage.setItem)`, **validar
     expiración** (reusar `isSessionExpired`); si quedó válida, hidratar el estado igual que
     en la carga normal (user + permisos + escenarios). Si expiró, descartar → login.
   - Timeout sin respuesta (o sin `BroadcastChannel` en el browser) → `isLoading = false`,
     queda deslogueado → `/login` (comportamiento actual, cero regresión).

**Lado responder (todas las pestañas):** suscribirse al canal mientras el provider vive. Al
recibir `REQUEST_SESSION`, si esta pestaña *tiene* sesión (`collectSession` ≠ null) y no está
expirada, responder con `buildResponse(nonce, payload)`. El canal se cierra en el cleanup.

## Flujo

```
Pestaña nueva (sin sesión)                 Pestaña logueada (hermana)
  │ mount: sessionStorage vacío
  │ BroadcastChannel('trackmovil-auth')
  │ post REQUEST_SESSION {nonce} ─────────►  onmessage: tengo sesión?
  │ espera <=600ms                            sí → post SESSION_RESPONSE {nonce, payload}
  │ onmessage matchesResponse(nonce) ◄──────  ─┘
  │ applySession → validar expiración → hidratar estado → logueada ✅
  └ (si timeout) → /login (igual que hoy)
```

## Seguridad

- `BroadcastChannel` es **same-origin** y entre pestañas del mismo perfil de navegador. El
  token nunca sale del navegador ni cruza orígenes.
- Cualquier pestaña same-origin puede pedir la sesión, pero las pestañas same-origin ya
  comparten dominio de confianza (mismo `localStorage`, mismo `sessionStorage` por contexto).
  No agrega superficie de ataque real.
- El nonce evita parear respuestas viejas/cruzadas.

## Casos borde

- Navegador sin `BroadcastChannel` → no hay handoff → login (actual).
- Ninguna pestaña hermana logueada → timeout → login (actual).
- Sesión recibida ya expirada por inactividad → descartada → login.
- Mensaje con nonce que no matchea o forma inválida → ignorado.
- F5/refresh en una pestaña ya logueada → no dispara handoff (tiene sesión local).

## Tests (Vitest, unit sobre la lógica pura)

- `collectSession`: con todas las keys → objeto completo; sin `token` o sin `user` → `null`;
  ignora keys ausentes.
- `applySession`: escribe solo las `AUTH_KEYS` presentes; roundtrip `collect`→`apply` preserva valores.
- `matchesResponse`: true solo si type+nonce correctos; false ante nonce distinto, type distinto,
  o forma inválida. `isRequest` análogo.
- El wiring de `BroadcastChannel` se valida en prueba manual (abrir mapa desde stats → entra logueado).

## Fuera de alcance

- No cambia el backing store de auth (sigue `sessionStorage`).
- No agrega persistencia entre cierres de navegador ni "recordarme".
- No toca el flujo de login ni el de logout.
- No sincroniza logout entre pestañas (un logout en una pestaña no cierra las otras) — se puede
  evaluar aparte si se pide.
