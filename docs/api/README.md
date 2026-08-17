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
    notas: |                         # → x-notas
      Lo que hay que saber antes de tocarlo.
    ejemplos:                        # → x-ejemplos
      - titulo: curl
        codigo: |
          curl ...
```

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
server-side (`lib/docs/root-guard.ts`): le pregunta a SecuritySuite por el objeto
`docs` / acción `view` de la app 5 en cada request, cachea 5 minutos el sí y 30 segundos
el no, y ante cualquier error **deniega** (fail-closed). No usa `x-track-isroot`: ese
header lo pone el front y es forjable, y este catálogo publica justamente qué endpoints
no validan nada.

El guard de `app/docs/layout.tsx` es cosmético. No puede ser server-side porque el JWT de
SecuritySuite vive en `sessionStorage` (`lib/auth-storage.ts`), no en una cookie, así que
un Server Component no lo ve. La página no tiene catálogo propio: todo lo que muestra se
lo pide a `GET /api/docs/spec`, que sí valida en el servidor.

Para darle acceso a alguien: asignarle el rol **Root** de RiogasTracking en SecuritySuite.
No hay que tocar código ni marcar `usuarios.es_root`.

---

## Referencias

- Diseño: `docs/superpowers/specs/2026-08-17-portal-docs-apis-design.md`
- Guard: `lib/docs/root-guard.ts` · Merge: `lib/docs/merge-spec.ts` · YAML: `lib/docs/yaml-min.ts`
- Generador: `scripts/generate-openapi-spec.mjs`
- Tests del guard: `__tests__/docs-root-guard.test.ts`
