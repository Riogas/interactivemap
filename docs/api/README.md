# Catálogo de APIs de TrackMovil

Este directorio es la fuente del portal `/docs`: el inventario completo de las APIs que
sirve la app, con método, path, autenticación real y notas.

| Archivo | Qué es | Se edita a mano |
|---|---|---|
| `openapi.json` | OpenAPI 3.1 generado desde el código | **no** |
| `anotaciones.yaml` | descripciones, consumidores, ejemplos, notas | **sí** |
| `README.md` | esto | sí |

El documento que se sirve por `GET /api/docs/spec` es el merge de los dos: **la
anotación siempre gana** sobre lo generado.

---

## Regenerar

```bash
pnpm docs:api
```

Corre `scripts/generate-openapi-spec.mjs`, recorre `app/api/**/route.ts` y reescribe
`openapi.json`. El JSON va commiteado: el portal lo sirve desde el bundle, no desde una
app viva, así que es determinista y no depende del entorno.

El generador **no tiene timestamps ni claves desordenadas a propósito**: correrlo dos
veces sobre el mismo código produce byte a byte el mismo archivo. Si `git diff` marca
cambios después de regenerar, es porque las APIs cambiaron de verdad.

**Sin direcciones internas.** En `servers[]` el generador deja solo el hostname público
(`https://track.glp.riogas.com.uy`): este JSON vive en el repo y el repo se clona, así
que las IPs de la red interna no se versionan. El ambiente en el que se está parado lo
agrega `GET /api/docs/spec` al servir, desde `DOCS_BASE_URL`, `APP_BASE_URL` o el `Host`
del request (`lib/docs/servidores.ts`). Lo mismo vale para `anotaciones.yaml`: los
consumidores se nombran ("Sender de GeneXus / SGM"), no se los direcciona.

Regenerar es obligatorio cuando se agrega, borra o renombra un `route.ts`, cuando se
agrega un método HTTP a uno existente, o cuando se cambia el docblock de cabecera.

### Qué extrae del código

- **Path**: del árbol de carpetas. `app/api/movil/[id]/route.ts` → `/api/movil/{id}`.
- **Métodos**: los `export async function GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS` y los
  `export const GET = ...`.
- **Descripción y query params**: del docblock de cabecera del archivo (ver abajo).
- **Autenticación (`x-auth`)**: los gates que el handler REALMENTE invoca —
  `requireAuth`, `requireApiKey`, `requireFuncionalidad('...')`,
  `requireAllowlistedEmail`, headers `x-track-isroot` / `x-api-key`. Si no encuentra
  ninguno marca `sinGate: true`, que es lo que hace útil al portal y también la razón de
  que sea solo-root.
- **Códigos de respuesta**: los `status: NNN` que aparecen en el archivo, más el 200 que
  Next devuelve por default.

### Docblock que el generador entiende

Se toma el docblock que abre el archivo; si el archivo abre con imports, el que esté
pegado al primer `export`. Un docblock que documenta una función interna se descarta (ese
endpoint queda sin descripción, y el conteo final lo reporta).

```ts
/**
 * GET /api/metricas/desfasaje        ← esta línea se descarta: ya la derivamos del path
 *
 * Franjas de 5 minutos del desfasaje ...   ← primer párrafo = summary
 *
 * Query params:
 *   - escenario (requerido, int)
 *   - dias      (opcional, 7|30|90; default 30) — rango [hoy−(dias−1), hoy]
 *     en fecha Montevideo.                  ← las continuaciones indentadas se pegan
 */
```

La sección de params se reconoce con `Query params:`, `Query string:` o `Parámetros:`, y
un param se marca como requerido si su texto dice "requerido" u "obligatorio".

---

## Anotar un endpoint nuevo

1. Escribí (o mejorá) el docblock de cabecera en el `route.ts`. Es la fuente primaria: lo
   que esté ahí no hay que repetirlo acá.
2. Corré `pnpm docs:api` y confirmá que el endpoint aparece en `openapi.json`.
3. Agregá la entrada en `anotaciones.yaml` para lo que el código no puede saber: **quién
   lo consume**, por qué existe, y un ejemplo real.

```yaml
endpoints:
  POST /api/import/pedidos:          # la clave es "MÉTODO ruta", exactamente como en openapi.json
    resumen: Una línea.              # → summary
    descripcion: |                   # → description (opcional; pisa el docblock)
      Texto largo.
    consumidores:                    # → x-consumidores
      - Sender de GeneXus / SGM
    auth: |                          # → x-auth-nota (el x-auth generado NO se pisa)
      Cómo se autentica de verdad.
    auth_badges:                     # → x-auth-badges (opcional; ver abajo)
      - x-api-key
      - token en body
    parametros:                      # → parameters[] (mergea por nombre+en)
      - nombre: escenario
        en: query                    # query | path
        tipo: int
        requerido: true
        descripcion: Escenario operativo.
        ejemplo: 1000                # prellena el formulario del "Try it"
    cuerpo:                          # → requestBody
      contentType: application/json  # default: application/json
      requerido: true
      descripcion: |
        Qué forma tiene el cuerpo.
      campos:                        # → tabla de campos del visor
        - nombre: pedidos
          tipo: array
          requerido: true
          descripcion: Uno o más pedidos.
      ejemplo: |
        { "pedidos": [] }
    respuestas:                      # → completa responses[código]
      "200":
        descripcion: Qué devuelve.
        ejemplo: |
          { "success": true }
    errores:                         # → x-errores (tabla "errores conocidos")
      - codigo: 403
        code: API_KEY_MISSING
        cuando: Falta el header x-api-key.
        solucion: Agregarlo. La key es por ambiente.
    notas: |                         # → x-notas
      Lo que hay que saber antes de tocarlo.
    ejemplos:                        # → x-ejemplos (se suman a los generados)
      - titulo: curl
        codigo: |
          curl ...
```

**`auth_badges`** solo cambia la ETIQUETA que muestra el visor, nunca lo que el portal
reporta como gates. Valores conocidos: `jwt`, `x-api-key`, `token en body`, `sesion`,
`sin auth`. Se usa cuando el gate real no se deduce del nombre de la función — el caso
típico es `/api/import/gps`, que acepta el token adentro del cuerpo. Marcar un endpoint
como `x-api-key` **no** lo saca de la lista de "sin ningún gate": esa lista sale de
`x-auth`, que se lee del código y no se puede pisar desde acá.

**Ejemplos `curl` / `fetch` / VB6**: el visor los genera solo, contra el host del
ambiente en el que se está parado (`window.location.origin`) y con los valores que haya
cargados en el formulario. El de VB6 aparece **solo si algún consumidor anotado dice
"VB6"** (o "Visual Basic"). Los de `ejemplos:` se suman al final: son llamadas reales,
no plantillas.

También se pueden describir módulos (el primer segmento después de `/api`), y eso se
vuelca en los tags del documento:

```yaml
modulos:
  import:
    descripcion: |
      Ingesta desde sistemas externos.
```

Una anotación cuya clave no matchea ningún endpoint **no se descarta en silencio**: sale
en `x-anotaciones.huerfanas` y se ve en el portal. Es la señal de que un endpoint se
renombró o se borró.

### El test que impide que esto envejezca

`__tests__/docs-anotaciones-cobertura.test.ts` falla si:

1. `anotaciones.yaml` no parsea (el portal seguiría andando, sirviendo solo lo generado
   — el test es lo que hace que alguien se entere);
2. hay una anotación huérfana;
3. **hay un endpoint en `openapi.json` sin entrada en `anotaciones.yaml`**;
4. sobra una excepción (un endpoint listado como "sin anotar" que ya está anotado o que
   ya no existe);
5. algún `/api/import/*` se quedó sin anotar o sin `consumidores`.

El punto 3 tiene una lista explícita de excepciones, `SIN_ANOTAR_HOY`, con los 73
endpoints que al 2026-08-17 salen solo con lo que el generador infiere. Esa lista existe
para que el test arranque en verde y falle **solo con los nuevos**.

**La lista solo se achica.** Cuando anotes uno, sacalo de ahí (el punto 4 te obliga). Si
de verdad hay que sumar uno, el motivo va escrito en el PR — no se agrega para "que pase
el test".

```bash
pnpm vitest run __tests__/docs-anotaciones-cobertura.test.ts
```

### YAML soportado

`anotaciones.yaml` lo lee `lib/docs/yaml-min.ts`, un parser de un subconjunto de YAML
escrito para este archivo (el repo no tiene ninguna dependencia de YAML y no se agregó
una para leer un solo archivo de autoría interna).

Soporta: mapas anidados por indentación con espacios, listas en bloque (`- item`), listas
de mapas (`- clave: valor`), listas/mapas en flujo (`[a, b]`, `{a: 1}`), escalares en
bloque (`|`, `|-`, `>`, `>-`), comillas simples y dobles, comentarios `#`,
`true`/`false`/`null`/`~` y números.

**No** soporta anclas ni aliases (`&`, `*`), tags (`!!`), documentos múltiples (`---`),
claves complejas (`? `) ni tabs de indentación. Si el archivo no parsea, el portal sirve
el catálogo generado igual y publica el error en `x-anotaciones.error` — nunca se cae.

---

## Qué quedó fuera del catálogo, y por qué

| Fuera | Motivo |
|---|---|
| `app/api/proxy/[...path]/route.ts` | Catch-all que reenvía a la API legacy de GeneXus (`EXTERNAL_API_URL`). Se documenta que el proxy existe y a dónde apunta, no cada endpoint del otro lado. |
| `app/api/doc/route.ts` | **Endpoint roto.** Lee `API_DOCUMENTATION.md`, un archivo que ya no existe en el repo: devuelve 500 siempre. Se dejó en su lugar a propósito (no se borra en esta fase); hay que decidir si se elimina o se reescribe como redirect a `/docs`. |
| `as400-api/` | Servicio Express aparte, no forma parte de la app Next. Tiene su propio README. |
| Páginas y Server Actions | El catálogo es de APIs HTTP, no de rutas de UI. |

Los dos primeros salen igual en el documento, en `x-excluidos`, con su motivo. El portal
los muestra al final: que estén fuera del detalle no significa que no existan.

---

## Acceso

`/docs` y `GET /api/docs/spec` son **solo para usuarios root**. El gate real es
server-side (`lib/docs/root-guard.ts`) y hace dos cosas, en este orden:

1. **Verifica el JWT** (`jwt.verify`, HS256): firma y vencimiento. Es local, sin red.
2. **Le pregunta a SecuritySuite** por el objeto `docs` / acción `view` de la app 5, en
   cada request. Cachea 5 minutos el sí y 30 segundos el no, y ante cualquier error
   **deniega** (fail-closed).

No usa `x-track-isroot`: ese header lo pone el front y es forjable, y este catálogo
publica justamente qué endpoints no validan nada.

### `JWT_SECRET` es obligatoria para que `/docs` abra

**Hay que setear `JWT_SECRET` con el mismo valor con el que firma SecuritySuite.** Si la
variable falta, está vacía, o vale el default que trae el código de secapi
(`security-suite-secret-key`), el guard responde **503 `SECRETO_NO_CONFIGURADO`** y el
portal no se abre. No hay modo degradado.

```bash
# .env.production / .env.local
JWT_SECRET=<el mismo secreto que tiene secapi en su .env>
```

Por qué tan duro:

- **Ninguna app del ecosistema verifica hoy la firma del token.** La decodifican con
  base64 y le creen al payload. Con eso,
  `Bearer <header>.<base64 de {"username":"dmedaglia"}>.<lo que sea>` alcanza para
  hacerse pasar por cualquiera. El portal `/docs` publica el inventario completo de las
  APIs y marca cuáles no validan nada: es el peor lugar posible para dejar ese agujero,
  así que acá se cierra (y solo acá — la autenticación del resto de la app no se tocó).
- **Verificar contra el default del repo es no verificar.** `security-suite-secret-key`
  está escrito en el código de secapi, que está en un repo: cualquiera que lo lea firma
  tokens válidos. Aceptarlo daría una falsa sensación de blindaje, que es peor que no
  tener ninguno.
- **Fail-closed ante mala configuración.** Un deploy al que se le olvidó la variable
  tiene que romper visible (503) y no abrir el catálogo "hasta que alguien lo note".

Códigos que devuelve el gate: `NO_TOKEN` (401), `TOKEN_INVALIDO` (401, firma o formato),
`TOKEN_VENCIDO` (401), `SECRETO_NO_CONFIGURADO` (503), lo que conteste secapi
(401/403), `SECAPI_ERROR` / `SECAPI_RESPUESTA_INVALIDA` / `SECAPI_INACCESIBLE` (503).

### El guard de la página es cosmético

El de `app/docs/layout.tsx` es `'use client'`: corre en el navegador con datos que el
navegador controla, así que **no es seguridad**. No puede ser server-side porque el JWT de
SecuritySuite vive en `sessionStorage` (`lib/auth-storage.ts`), no en una cookie, así que
un Server Component no lo ve. Alcanza porque la página no tiene catálogo propio: todo lo
que muestra se lo pide a `GET /api/docs/spec`, que sí valida en el servidor. Si algún día
la página trae contenido que no pase por ese endpoint, hay que mover el gate al servidor.

Para darle acceso a alguien: asignarle el rol **Root** de RiogasTracking en SecuritySuite.
No hay que tocar código ni marcar `usuarios.es_root`.

---

---

## El portal: qué se ve y qué se puede hacer

`/docs` (componentes en `components/docs/`) muestra, por endpoint: método y path,
badges de autenticación, quién lo consume, parámetros de path y query, cuerpo del
request con su schema, respuestas por código con ejemplo, errores conocidos, y ejemplos
copiables en curl / fetch / VB6. Navegación por módulo y buscador por path, método,
módulo y texto de la descripción.

Arranca en **"Estado de la autenticación"**: cuántos endpoints no validan nada, cuáles
son, y cuáles se apoyan en un header forjable. No está escondido detrás de un acordeón a
propósito — es lo que un root necesita ver primero, y es la razón por la que el portal
tiene el gate que tiene.

### Probar un endpoint (`POST /api/docs/try`)

La llamada **no sale del navegador**: sale del servidor, desde `app/api/docs/try/route.ts`,
que vuelve a pasar por `requireRoot`. Reglas, con sus tests en
`__tests__/docs-try.test.ts`:

| Regla | Por qué |
|---|---|
| Solo paths `/api/...` del propio host. Se rechaza URL absoluta, `//host`, `..`, `%2e`, `\` | Nunca es un proxy abierto. Además del filtro textual, se re-verifica el origen de la URL ya armada. |
| `GET`/`HEAD` directo; `POST`/`PUT`/`PATCH`/`DELETE` exigen `confirmacion` == el path exacto (si no, **428 `CONFIRMACION_REQUERIDA`**) | El ambiente puede ser producción y el que abre el portal es root. |
| `cookie` / `authorization` los pone el servidor con la sesión del root; los que mande el cliente se descartan y se informan en `headersDescartados` | Que el portal no sea una forma de mandar credenciales ajenas. |
| Timeout 30 s (**504 `TIMEOUT`**) y respuesta truncada a 1 MB (`truncado: true`) | Un endpoint colgado no cuelga el portal. |
| El request va **en base64** en `{ payload }` | El WAF de nginx delante de TrackMovil rechaza con 403 los bodies con sintaxis de shell, y un cuerpo de ejemplo legítimo puede tenerla. |

El ejecutor devuelve siempre `200` cuando **pudo** ejecutar: el status del endpoint
llamado viene adentro, en `status`. Un `4xx`/`5xx` de `/api/docs/try` es un problema del
ejecutor (gate, path, confirmación), no del endpoint.

El ambiente que muestra el diálogo de confirmación se deriva del host: si dice `dev` es
DEV, **todo lo demás se muestra como PRODUCCIÓN, en rojo** — incluido `localhost`. El
error caro es ejecutar un DELETE creyendo que se está en desarrollo, no al revés.

---

## Referencias

- Diseño: `docs/superpowers/specs/2026-08-17-portal-docs-apis-design.md`
- Guard: `lib/docs/root-guard.ts` · Merge: `lib/docs/merge-spec.ts` · YAML: `lib/docs/yaml-min.ts`
- Servers en tiempo de servido: `lib/docs/servidores.ts`
- Reglas del "Try it": `lib/docs/try-request.ts`
- Generador: `scripts/generate-openapi-spec.mjs`
- Visor: `components/docs/` (lógica pura en `docs-logic.ts` y `ejemplos.ts`)
- Tests: `__tests__/docs-root-guard.test.ts` · `__tests__/docs-servidores.test.ts` ·
  `__tests__/docs-try.test.ts` · `__tests__/docs-merge-anotaciones.test.ts` ·
  `__tests__/docs-anotaciones-cobertura.test.ts` · `components/docs/docs-logic.test.ts`
