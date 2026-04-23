# Endpoints DELETE — Tablas afectadas por importaciones

> Todos los endpoints de importación (`/api/import/*`) requieren header **`X-API-Key`**.  
> Los endpoints de gestión (`/api/puntos-interes`, `/api/fleteras-zonas`) requieren **sesión de usuario autenticado**.

---

## 1. `DELETE /api/import/pedidos`

| Campo | Detalle |
|---|---|
| **Tabla** | `pedidos` |
| **PK usada** | `id` |
| **Auth** | `X-API-Key` |
| **Body** | `{ pedido_ids: number[] }` |
| **Efecto** | Elimina los pedidos cuyos IDs se indiquen |

```json
{ "pedido_ids": [1001, 1002, 1003] }
```

---

## 2. `DELETE /api/import/services`

| Campo | Detalle |
|---|---|
| **Tabla** | `services` |
| **PK usada** | `id` |
| **Auth** | `X-API-Key` |
| **Body** | `{ service_ids: number[] }` |
| **Efecto** | Elimina los services indicados |

```json
{ "service_ids": [50, 51] }
```

---

## 3. `DELETE /api/import/moviles`

| Campo | Detalle |
|---|---|
| **Tabla** | `moviles` |
| **PK usada** | `id` |
| **Auth** | `X-API-Key` |
| **Body** | `{ movil_ids: number[] }` |
| **Efecto** | Elimina los móviles indicados |

```json
{ "movil_ids": [305, 306] }
```

---

## 4. `DELETE /api/import/zonas`

| Campo | Detalle |
|---|---|
| **Tabla** | `zonas` |
| **PK usada** | `zona_id` |
| **Auth** | `X-API-Key` |
| **Body** | `{ zona_ids: number[] }` |
| **Efecto** | Elimina las zonas indicadas |

```json
{ "zona_ids": [30, 33] }
```

---

## 5. `DELETE /api/import/puntoventa`

| Campo | Detalle |
|---|---|
| **Tabla** | `puntoventa` |
| **PK usada** | `puntoventa_id` |
| **Auth** | `X-API-Key` |
| **Body** | `{ puntoventa_ids: number[] }` |
| **Efecto** | Elimina los puntos de venta indicados |

```json
{ "puntoventa_ids": [200, 201] }
```

---

## 6. `DELETE /api/import/movZonaServicio`

| Campo | Detalle |
|---|---|
| **Tabla** | `moviles_zonas` |
| **PK usada** | `id` / `movil_id` / `zona_id` |
| **Auth** | `X-API-Key` |
| **Body** | Ver opciones abajo |
| **Efecto** | Elimina asignaciones móvil↔zona |

**Opciones de filtro (excluyentes, en orden de prioridad):**

```json
// Por IDs específicos
{ "ids": [10, 11, 12] }

// Por par móvil + zona
{ "movil_id": 305, "zona_id": 30 }

// Todas las zonas de un móvil
{ "movil_id": 305 }

// Todos los móviles de una zona
{ "zona_id": 30 }
```

---

## 7. `DELETE /api/import/demoras`

| Campo | Detalle |
|---|---|
| **Tabla** | `demoras` |
| **PK usada** | `demora_id` / filtros compuestos |
| **Auth** | `X-API-Key` |
| **Body** | Ver opciones abajo |
| **Efecto** | Elimina registros de demoras por ID o por bloque escenario/tipo |

**Opción 1 — por IDs:**
```json
{ "demora_ids": [1, 2, 3] }
```

**Opción 2 — por filtro compuesto (puede combinar):**
```json
{ "escenario_id": 1000, "zona_tipo": "Distribucion", "descripcion": "Ref X" }
```

---

## 8. `DELETE /api/import/gps`

| Campo | Detalle |
|---|---|
| **Tabla** | `gps_tracking_history` |
| **PK usada** | `id` |
| **Auth** | `X-API-Key` (header) **o** `token` (body) — autenticación flexible |
| **Body** | `{ gps_ids: number[], token?: string }` |
| **Efecto** | Elimina registros de historial GPS |

```json
{ "gps_ids": [9900, 9901], "token": "opcional_si_no_va_header" }
```

---

## 9. `DELETE /api/fleteras-zonas`

| Campo | Detalle |
|---|---|
| **Tabla** | `fleteras_zonas` |
| **PK compuesta** | `escenario_id` + `empresa_fletera_id` + `tipo_de_zona` + `tipo_de_servicio` |
| **Auth** | Sesión de usuario (cookie) |
| **Params** | Query string con los 4 campos de la PK |
| **Efecto** | Elimina la asignación empresa↔zona de un escenario |

```
DELETE /api/fleteras-zonas?escenario_id=1&empresa_fletera_id=5&tipo_de_zona=Distribucion&tipo_de_servicio=URGENTE
```

---

## 10. `DELETE /api/puntos-interes`

| Campo | Detalle |
|---|---|
| **Tabla** | `puntos_interes` |
| **PK usada** | `id` + `usuario_email` (dueño) |
| **Auth** | Sesión de usuario (cookie) |
| **Params** | `?id=123&usuario_email=xxx` |
| **Efecto** | Elimina un punto de interés propio. Falla si el email no coincide con el dueño |

```
DELETE /api/puntos-interes?id=42&usuario_email=admin@empresa.com
```

---

## 11. `DELETE /api/puntos-interes/import-osm`

| Campo | Detalle |
|---|---|
| **Tabla** | `puntos_interes` |
| **Filtro** | `usuario_email` + descripción con patrón `[Categoría] ...` |
| **Auth** | Ninguna (⚠️ solo por query param — considerar proteger) |
| **Params** | `?usuario_email=xxx` y opcionalmente `&categoria=Riogas` |
| **Efecto** | Elimina todos los POIs importados de OSM para el usuario. Si se pasa `categoria`, solo elimina esa categoría |

```
DELETE /api/puntos-interes/import-osm?usuario_email=admin@empresa.com
DELETE /api/puntos-interes/import-osm?usuario_email=admin@empresa.com&categoria=Riogas
```

---

## 12. `DELETE /api/proxy/[...path]`

| Campo | Detalle |
|---|---|
| **Tabla** | N/A (proxy a AS400 API) |
| **Auth** | La que exija el backend AS400 |
| **Efecto** | Retransmite el DELETE al servicio Python `as400-api` en el path indicado |

---

## Resumen rápido

| Endpoint | Tabla | Auth |
|---|---|---|
| `/api/import/pedidos` | `pedidos` | API Key |
| `/api/import/services` | `services` | API Key |
| `/api/import/moviles` | `moviles` | API Key |
| `/api/import/zonas` | `zonas` | API Key |
| `/api/import/puntoventa` | `puntoventa` | API Key |
| `/api/import/movZonaServicio` | `moviles_zonas` | API Key |
| `/api/import/demoras` | `demoras` | API Key |
| `/api/import/gps` | `gps_tracking_history` | API Key / Token |
| `/api/fleteras-zonas` | `fleteras_zonas` | Sesión usuario |
| `/api/puntos-interes` | `puntos_interes` | Sesión usuario |
| `/api/puntos-interes/import-osm` | `puntos_interes` | ⚠️ Sin auth |
| `/api/proxy/[...path]` | AS400 externo | AS400 |
