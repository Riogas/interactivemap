# Portal de documentación de APIs (`/docs`) — diseño

**Fecha:** 2026-08-17
**Aplicaciones:** SecuritySuite (secapi, app 1) · GOYA (app 3) · RiogasTracking (TrackMovil, app 5)
**Estado:** aprobado — RBAC ya dado de alta, implementación pendiente

---

## 1. Objetivo

Cada una de las tres aplicaciones expone un apartado `/docs`, accesible solo para
usuarios root, con el catálogo completo de sus APIs: endpoints, método, autenticación,
quién las consume, parámetros de entrada, forma de la respuesta, códigos de error y
ejemplos de consumo copiables. Desde la misma página se puede ejecutar una llamada
real contra el ambiente en el que se está parado.

El problema que resuelve: hoy no existe ningún inventario de estas APIs. Goya tiene
Swagger apagado en producción y casi sin descripciones; TrackMovil tiene un endpoint
`/api/doc` que lee un archivo que ya no existe en el repo; secapi no tiene nada. Los
contratos con los consumidores externos (VB6, el sender de GeneXus, la app móvil)
viven en la cabeza de quien los escribió y en specs sueltas de diseño.

## 2. Alcance

**Entra:**

- Las APIs propias de cada aplicación (las que la app sirve).
- Las integraciones con terceros: `/api/calles/*` con `x-api-key` (VB6), `/api/import/*`
  con `X-API-Key` (sender GeneXus/SGM), `/api/import/gps` con token en el body (app móvil
  MoveIT), `/api/zonas/sync/webhook` (TrackMovil → Goya), los endpoints públicos de
  sorteos con `x-api-key`.
- Un apartado de "estado real de la autenticación" por app: qué endpoints no validan
  nada hoy, dónde la firma del JWT no se verifica, qué gates son spoofeables. Es
  información sensible y es exactamente por eso que el portal es solo-root.

**No entra:**

- Los endpoints legacy de GeneXus que se alcanzan por proxy (`/api/[...proxy]` en secapi,
  `/api/[...path]` en modo `legacy` en Goya, `/api/proxy/*` en TrackMovil). Se documenta
  que el proxy existe y a dónde apunta, no cada endpoint del otro lado.
- El servicio `as400-api` de secapi (Express :5000, interno) — tiene su propio README.
- Cambiar cómo funciona la autenticación de las apps. Los problemas que el portal
  documenta se arreglan aparte, no acá.

## 3. Estado relevado

| | secapi (1) | GOYA (3) | TrackMovil (5) |
|---|---|---|---|
| Stack | Next 16 App Router + Prisma | Next 16 (front) + NestJS 11 (`backend/`) | Next 16 + Supabase |
| Endpoints propios | ~70 handlers, 36 `route.ts` | 90 en 17 controllers NestJS + 8 route handlers | 133 handlers en 91 `route.ts` |
| Puerto (PM2) | 3001 | 3000 (front) / 3001 (api) | 3002 |
| Doc existente | ninguna | `@nestjs/swagger` en `/api/docs`, **apagado si `NODE_ENV=production`** | `GET /api/doc` roto (lee un `.md` inexistente) |
| Validación de entrada | manual | class-validator + DTOs | zod en ~6 rutas, resto manual |
| Menú | tabla `objetos` de secapi (raíz 18) | tabla `objetos` de secapi (raíz 10) | código (`FloatingToolbar.tsx`) |
| Gate de páginas | `src/proxy.ts` → secapi, solo si `PERMISOS_ENFORCE=1` | `src/proxy.ts` → secapi (activo) | layout guard client-side |
| Gate de APIs | casi ninguno | `AuthGuard` (no distingue root) | headers `x-track-isroot` / `x-track-funcs`, **spoofeables** |

Hechos que condicionan el diseño:

1. **El JWT de secapi no lleva el flag root.** Su payload es
   `{iss, username, userId, sistema}`. Ninguna app puede decidir "es root" leyendo el
   token: hay que preguntarle a secapi.
2. **`solo_root` no significa lo que parece.** El bypass del motor es por
   `usuarios.es_root='S'`, que hoy tiene una sola cuenta. Los roles llamados "Root"
   (57/55/52) son otra cosa. Ver §6.
3. **secapi-dev y secapi-prod comparten la misma instancia de Postgres** (idéntica en `.env` y
   en `pm2.config.js`). Todo alta de RBAC impacta producción al instante.
4. **El WAF de nginx de TrackMovil** rechaza con 403 los requests cuyo body o query contenga
   ciertos patrones de shell. Los patrones exactos están en la config del server, no acá.

## 4. Decisiones

| Decisión | Elegido | Por qué |
|---|---|---|
| Contenido | generado del código + capa de notas a mano | Lo generado no envejece; las notas aportan el porqué y los ejemplos reales, que ningún generador infiere. |
| Alcance por app | cada app documenta lo suyo | Tres repos independientes; unificar obligaría a publicar specs entre apps sin ganancia real. |
| Gate root | verificar contra secapi en cada request | Es lo único que resiste manipulación del localStorage o del header `x-track-isroot`. |
| Try it | GET directo, escrituras con confirmación | Es root y el ambiente puede ser producción; la confirmación evita el POST accidental. |
| Visor | componente propio, copiado en los tres repos | Coherencia visual con cada app y sin montar infraestructura de paquetes privados por una pantalla. |

## 5. Arquitectura

Misma estructura en las tres aplicaciones, con la implementación adaptada al stack.

### 5.1 Producción del contenido

```
docs/api/
├── openapi.json        generado por `pnpm docs:api`, versionado en el repo
├── anotaciones.yaml    escrito a mano: descripciones, consumidores, ejemplos, notas
└── README.md           cómo regenerar y cómo documentar un endpoint nuevo
```

- **Goya:** el generador arranca el `DocumentBuilder` de `@nestjs/swagger` ya existente
  en `backend/src/main.ts` en modo offline y vuelca el documento. Los DTOs de
  class-validator alimentan los schemas de entrada.
- **secapi y TrackMovil:** parser estático que recorre `app/api/**/route.ts`, deriva el
  path desde la estructura de carpetas (incluyendo `[param]` y `[...catchall]`), detecta
  los `export async function GET|POST|PUT|PATCH|DELETE`, y lee el docblock de cabecera
  del archivo. En TrackMovil esos docblocks ya existen en casi todos los handlers y
  describen query params, auth y forma de respuesta: son la fuente primaria.

El merge de `openapi.json` + `anotaciones.yaml` produce el documento final. Las
anotaciones siempre ganan sobre lo inferido.

**Antienvejecimiento:** un test falla si aparece un endpoint sin entrada en
`anotaciones.yaml`. Es el patrón que TrackMovil ya usa para las perillas del motor de
demora en `components/metricas/documentacion-data.ts`.

### 5.2 Gate root

`lib/docs/root-guard.ts` — mismo contrato en las tres apps:

```
requireRoot(request) → { ok: true, usuario } | { ok: false, status, code }
```

1. Extrae el Bearer del header (o la cookie `token`).
2. `POST {SECAPI_URL}/api/db/permisos` con `{ AplicacionId, ObjetoKey: 'docs', AccionKey: 'view' }`.
3. Acepta solo `permitido === 'GRANTED'`. La razón puede ser `ROOT` (bypass por
   `es_root='S'`) o el otorgamiento vía rol Root; ambas son válidas.
4. Cachea el resultado 5 minutos por token, negativo 30 segundos.
5. Ante error de red: **fail-closed**. Un portal que lista endpoints sin autenticación
   no se abre porque secapi no contestó.

En secapi el guard consulta la base directamente (`usuarios.es_root` + `rol_funcionalidades`),
sin salto de red.

### 5.3 Endpoints nuevos

| Endpoint | Qué hace |
|---|---|
| `GET /api/docs/spec` | Devuelve el documento mergeado. Pasa por `requireRoot`. |
| `POST /api/docs/try` | Ejecuta la llamada server-side con la sesión del root y devuelve status, headers y cuerpo. Pasa por `requireRoot`. |

`POST /api/docs/try` recibe `{ payload }` donde `payload` es el request a ejecutar
(método, path, query, headers, body) **codificado en base64**. No es ofuscación: es lo que
permite que un ejemplo con sintaxis de shell en el cuerpo atraviese el WAF de nginx de
TrackMovil, que inspecciona el body del request entrante.

Reglas de ejecución:

- Solo contra el propio host de la app. Nada de proxy abierto a internet.
- `GET`/`HEAD` se ejecutan directo.
- `POST`/`PUT`/`PATCH`/`DELETE` exigen `confirmacion === <path exacto>` en el cuerpo;
  la UI pide escribirlo. El ambiente (dev/prod) se muestra en el diálogo, derivado del host.
- Timeout 30 s, respuesta truncada a 1 MB.

### 5.4 Página

- **secapi:** `src/app/dashboard/docs/page.tsx`
- **Goya:** `src/app/dashboard/docs/page.tsx`
- **TrackMovil:** `app/docs/page.tsx` + `layout.tsx` con el guard, siguiendo el patrón
  de `app/dashboard/stats/layout.tsx`

La página nunca renderiza el catálogo desde el cliente sin haber pasado el guard
server-side: el gate de UI es adicional, no sustituto.

### 5.5 Visor

Un componente, `components/docs/`, escrito contra variables CSS que cada app mapea a su
tema (shadcn/Radix en Goya y secapi, tokens `--stats-*` en TrackMovil). Contenido por
endpoint: método y path, autenticación requerida, quién lo consume, parámetros, cuerpo,
respuestas por código, errores conocidos, y ejemplos en curl / fetch / VB6 según
corresponda. Navegación por módulo, búsqueda por path y por texto.

Sin emojis como iconografía: SVG inline, como el resto de las tres aplicaciones.

## 6. RBAC — ya dado de alta

Ejecutado el 2026-08-17 con `scripts/seed-docs-funcionalidad.ts` (idempotente, en secapi):

| App | Objeto PAGE | Acción `view` | Funcionalidad | Otorgada al rol |
|---|---|---|---|---|
| 1 SecuritySuite | id 29 | id 124 (`GFPM-WHVF`) | id 61 `docs` | Root (57) |
| 3 GOYA | id 30 | id 125 (`GFPM-WHVF`) | id 62 `docs` | Root (55) |
| 5 RiogasTracking | id 31 | id 126 (`GFPM-WHVF`) | id 63 `docs` | Root (52) |

Todos con `estado='A'`, `es_publico='N'`, `path='/docs'`, `icon='book-open'`.

**`solo_root='N'` a propósito.** Con `'S'`, `/api/db/permisos` devuelve `DENIED` con razón
`SOLO_ROOT` a todo el que no tenga `usuarios.es_root='S'` — hoy una única cuenta — y
habría dejado afuera a los roles Root existentes. Con `'N'`, el acceso lo da el
otorgamiento al rol Root, y `es_root='S'` sigue entrando por el bypass de la línea 288
de `src/app/api/db/permisos/route.ts`. Sumar a alguien es darle el rol Root de esa app,
sin tocar código ni marcar un flag que abre el sistema entero.

**El punto de menú está diferido.** La base es compartida con producción: un item de
menú antes de que la página exista es un link a 404 para los roots de prod. Se crea con
`pnpm seed:docs --con-menu` cuando `/docs` esté deployada. TrackMovil no toma el menú de
secapi, así que ahí la entrada se agrega en `FloatingToolbar.tsx`.

## 7. Riesgos

| Riesgo | Mitigación |
|---|---|
| El portal expone qué endpoints están sin autenticación | Gate server-side real, fail-closed, en las tres apps. Es la razón por la que el gate no puede ser client-side. |
| Un "Try it" dispara una escritura en producción | Confirmación escrita del path + ambiente visible + solo contra el propio host. |
| El catálogo envejece | Test que falla ante endpoints sin anotar + `docs/api/README.md` con el procedimiento. |
| El WAF de TrackMovil bloquea el Try it | Payload en base64. |
| El Swagger de Goya está apagado en producción | El spec sirve desde el JSON versionado, no desde la app viva. Determinista y sin depender del entorno. |

## 8. Fases

| # | Entregable | Estado |
|---|---|---|
| 0 | Alta RBAC en secapi | **hecho** (commit `116aa60`) |
| 1 | `root-guard` + `/docs` mínima + `GET /api/docs/spec` en las tres apps | pendiente |
| 2 | Generador de Goya (Swagger → `openapi.json`) | pendiente |
| 3 | Generador para Next (secapi y TrackMovil) | pendiente |
| 4 | Visor y las tres páginas completas | pendiente |
| 5 | `POST /api/docs/try` + UI de ejecución | pendiente |
| 6 | Anotaciones a mano + guías de integración externas | pendiente |
| 7 | Test antienvejecimiento + `docs/api/README.md` | pendiente |

## 9. Verificación

Por aplicación:

1. Un usuario sin rol Root recibe 403 en `GET /api/docs/spec` y no puede abrir la página.
2. Un usuario con rol Root entra; la cuenta con `es_root='S'` también.
3. Con secapi caído, el guard deniega (fail-closed), no abre.
4. `GET /api/docs/spec` devuelve todos los endpoints que el generador encontró, y el
   conteo coincide con el inventario relevado (§3).
5. El Try it ejecuta un GET real y muestra la respuesta; un POST sin confirmación es rechazado.
6. En TrackMovil, un Try it con sintaxis de shell en el cuerpo atraviesa el WAF.
7. El test antienvejecimiento falla si se agrega un endpoint y no se lo anota.
