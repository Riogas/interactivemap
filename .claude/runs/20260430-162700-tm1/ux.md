# UX Validation: Fix filtro de móviles en dashboard (MovilSelector.tsx)

## Veredicto
UX_BLOCKED: el dev server no puede compilar el bundle de la app por un error pre-existente en `contexts/AuthContext.tsx` que impide que cualquier página cargue. El error NO fue introducido por este fix.

## Ambiente probado
- Stack: Next.js 16.2.3 + webpack (fallback; Turbopack también falla) + React 19
- URL intentada: http://localhost:3000
- Browser: Chromium 147 headless (Playwright 1.59.1)
- Viewport: 1440x900 desktop

## Screenshots capturados
| Estado | Path |
|--------|------|
| Dev server — pantalla que ve el usuario | `C:\Users\jgomez\AppData\Local\Temp\ux-validation-20260430\dev_server_500.png` |

Nota: Solo se pudo capturar el estado de error del servidor. No fue posible navegar al dashboard.

## Hallazgos

### BLOQUEANTE AMBIENTAL (pre-existente, no introducido por el fix)

**`contexts/AuthContext.tsx` — error de compilación SWC/TSC**

- TypeScript: `contexts/AuthContext.tsx(436,1): error TS1005: '}' expected.`
- SWC (runtime webpack): `'import', and 'export' cannot be used outside of module code` en línea 429.
- El archivo visualmente parece sintácticamente correcto y tiene `'use client'` en la primera línea.
- El error existe en el commit HEAD (`d2816fe feat: sistema de permisos via Security Suite`) antes de cualquier cambio del fix.
- Confirmado haciendo `git stash` del fix y verificando que el error persiste igual.
- Efecto: 500 en todas las rutas, el browser recibe una página en blanco con "Internal Server Error".

El archivo `AuthContext.tsx` tiene 435 líneas (LF) / 436 líneas (CRLF+vacía), codificación UTF-8 con CRLF. El SWC parser parece tener un bug específico con este archivo en este entorno.

### Validación lógica del fix (alcanzada via tests unitarios)

Dado que no se pudo validar visualmente, se ejecutó el suite de 37 tests unitarios que el QA-tester generó en `__tests__/movil-filter-fix.test.ts`:

```
Test Files  1 passed (1)
      Tests  37 passed (37)
   Duration  362ms
```

Los tests cubren exactamente las funciones puras del fix:
- AC1: filtro de pedidos — 9 tests, todos PASS
- AC2: filtro de services — 7 tests, todos PASS
- AC3/AC6: badge "Todos" con filteredMoviles — 5 tests, todos PASS
- AC5: contador "+N" como rebalse de VISIBLE_IDS — 5 tests, todos PASS
- EC1: empresa con 0 móviles — 3 tests, todos PASS
- EC3: búsqueda local activa — 3 tests, todos PASS
- EC5: deselect all — 3 tests, todos PASS

El diff del fix (+10 -6 en MovilSelector.tsx) es limpio, coherente con la spec y los tests lo validan correctamente. El `MovilSelector.tsx` compila sin errores TypeScript (`tsc --noEmit` solo reporta el error de `AuthContext.tsx`).

## Lo que NO se pudo validar (requiere dev server funcionando)
- GP1: visualización de la lista de pedidos al seleccionar 1 móvil
- GP2: visualización de la lista de services al seleccionar 1 móvil
- GP3: badge "Móviles: Todos" renderizado en el browser
- GP4: ausencia de "+N" raro con todos seleccionados
- EC3: flujo de búsqueda en el multiselect
- EC5: comportamiento visual al deseleccionar todos
- Regresiones visuales en áreas adyacentes
- Accesibilidad básica

## Acción requerida antes de aprobar UX

El error de compilación en `contexts/AuthContext.tsx` debe resolverse para poder hacer validación visual real. Opciones:

1. **Investigar el bug de SWC con CRLF**: el archivo en cuestión tiene CRLF y SWC falla en él. Convertir a LF podría resolver el problema (`git config core.autocrlf false` + re-guardar el archivo).
2. **Revisar si el commit `d2816fe` introdujo una `{` sin cerrar**: TSC reporta `'}' expected` en la línea 436 (EOF), lo que indica un bloque abierto sin cerrar en algún punto del archivo.
3. Una vez resuelto el error, re-ejecutar esta validación UX.

## Tiempo invertido
~25 minutos (arranque de server x3 intentos, diagnóstico del error de compilación, validación via tests unitarios como fallback).
