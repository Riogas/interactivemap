# 📚 API Documentation - TrackMovil Import APIs

## 🌐 Base URL
```
http://localhost:3000
```

---

## 📋 Table of Contents
- [Moviles API](#moviles-api)
- [Pedidos API](#pedidos-api)
- [Demoras API](#demoras-api)
- [Punto de Venta API](#punto-de-venta-api)
- [Zonas API](#zonas-api)
- [Error Responses](#error-responses)
- [Field Mappings](#field-mappings)

---

# Moviles API

## POST /api/import/moviles
Inserta uno o más móviles en la base de datos.

### Request

**Method:** `POST`  
**Endpoint:** `/api/import/moviles`  
**Content-Type:** `application/json`

### Request Body

#### Opción 1: Objeto único
```json
{
  "Descripcion": "693",
  "DetalleHTML": "",
  "DistanciaMaxMtsCumpPedidos": 0,
  "EFleteraId": 111,
  "EFleteraNom": "CHRISTIAN NOLLA",
  "EstadoDesc": "",
  "EstadoNro": 3,
  "FchHoraMov": "2025-12-03T16:41:02",
  "FchHoraUPDFireStore": "2025-12-03T16:41:02",
  "Matricula": "SAU5678",
  "MostrarEnMapa": "S",
  "Nro": 693,
  "Obs": "",
  "PedidosPendientes": 0,
  "PermiteBajaMomentanea": "S",
  "PrintScreen": "S",
  "SePuedeActivarDesdeLaApp": "S",
  "SePuedeDesactivarDesdeLaApp": "S",
  "TamanoLote": 6,
  "VisibleEnApp": "S",
  "debugMode": true,
  "gpsN8n": true,
  "grabarPantalla": false,
  "id": "693"
}
```

#### Opción 2: Array de objetos
```json
{
  "moviles": [
    { "id": "693", "Nro": 693, "Descripcion": "693", ... },
    { "id": "694", "Nro": 694, "Descripcion": "694", ... }
  ]
}
```

### Request Fields

| Campo | Tipo | Requerido | Descripción | Mapea a DB |
|-------|------|-----------|-------------|------------|
| `id` | string | ✅ | Identificador único del móvil | `id` (PK) |
| `Nro` | integer | ✅ | Número del móvil | `nro` |
| `Descripcion` | string | ✅ | Descripción del móvil | `descripcion` |
| `DetalleHTML` | string | ❌ | Detalle en formato HTML | `detalle_html` |
| `DistanciaMaxMtsCumpPedidos` | integer | ❌ | Distancia máxima en metros | `distancia_max_mts_cump_pedidos` |
| `EFleteraId` | integer | ✅ | ID de empresa fletera | `empresa_fletera_id` |
| `EFleteraNom` | string | ❌ | Nombre de empresa fletera | `empresa_fletera_nom` |
| `EstadoDesc` | string | ❌ | Descripción del estado | `estado_desc` |
| `EstadoNro` | integer | ❌ | Número de estado | `estado_nro` |
| `FchHoraMov` | datetime | ❌ | Fecha/hora del movimiento | `fch_hora_mov` |
| `FchHoraUPDFireStore` | datetime | ❌ | Fecha/hora de actualización | `fch_hora_upd_firestore` |
| `Matricula` | string | ❌ | Matrícula del vehículo | `matricula` |
| `MostrarEnMapa` | string | ❌ | "S"/"N" - Mostrar en mapa | `mostrar_en_mapa` (boolean) |
| `Obs` | string | ❌ | Observaciones | `obs` |
| `PedidosPendientes` | integer | ❌ | Cantidad de pedidos pendientes | `pedidos_pendientes` |
| `PermiteBajaMomentanea` | string | ❌ | "S"/"N" - Permite baja momentánea | `permite_baja_momentanea` (boolean) |
| `PrintScreen` | string | ❌ | "S"/"N" - Permite captura de pantalla | `print_screen` (boolean) |
| `SePuedeActivarDesdeLaApp` | string | ❌ | "S"/"N" - Se puede activar desde app | `se_puede_activar_desde_la_app` (boolean) |
| `SePuedeDesactivarDesdeLaApp` | string | ❌ | "S"/"N" - Se puede desactivar desde app | `se_puede_desactivar_desde_la_app` (boolean) |
| `TamanoLote` | integer | ❌ | Tamaño del lote | `tamano_lote` |
| `VisibleEnApp` | string | ❌ | "S"/"N" - Visible en app | `visible_en_app` (boolean) |
| `debugMode` | boolean | ❌ | Modo debug | `debug_mode` |
| `gpsN8n` | boolean | ❌ | GPS N8N habilitado | `gps_n8n` |
| `grabarPantalla` | boolean | ❌ | Grabación de pantalla habilitada | `grabar_pantalla` |

### Response 200 OK
```json
{
  "success": true,
  "message": "1 móviles importados correctamente",
  "data": [
    {
      "id": "693",
      "descripcion": "693",
      "empresa_fletera_id": 111,
      "nro": 693,
      "created_at": "2025-12-10T10:30:00Z",
      ...
    }
  ]
}
```

### Response 400 Bad Request
```json
{
  "error": "Se requiere al menos un móvil"
}
```

### Response 500 Internal Server Error
```json
{
  "error": "Error al importar móviles",
  "details": "duplicate key value violates unique constraint \"moviles_pkey\""
}
```

### cURL Example
```bash
curl -X POST http://localhost:3000/api/import/moviles \
  -H "Content-Type: application/json" \
  -d '{
    "id": "693",
    "Nro": 693,
    "Descripcion": "693",
    "EFleteraId": 111,
    "EFleteraNom": "CHRISTIAN NOLLA"
  }'
```

---

## PUT /api/import/moviles
Actualiza móviles existentes o los inserta si no existen (upsert).

### Request

**Method:** `PUT`  
**Endpoint:** `/api/import/moviles`  
**Content-Type:** `application/json`

### Request Body
Mismo formato que POST (ver arriba)

### Behavior
- Si el móvil con el `id` especificado existe, se actualiza
- Si no existe, se inserta como nuevo registro
- Usa `onConflict: 'id'` (PRIMARY KEY)

### Response 200 OK
```json
{
  "success": true,
  "message": "1 móviles actualizados correctamente",
  "data": [...]
}
```

### cURL Example
```bash
curl -X PUT http://localhost:3000/api/import/moviles \
  -H "Content-Type: application/json" \
  -d '{"id": "693", "Descripcion": "693 Actualizado"}'
```

---

## DELETE /api/import/moviles
Elimina uno o más móviles por sus IDs.

### Request

**Method:** `DELETE`  
**Endpoint:** `/api/import/moviles`  
**Content-Type:** `application/json`

### Request Body
```json
{
  "movil_ids": ["693", "694", "695"]
}
```

### Response 200 OK
```json
{
  "success": true,
  "message": "3 móviles eliminados correctamente",
  "deleted_count": 3
}
```

### cURL Example
```bash
curl -X DELETE http://localhost:3000/api/import/moviles \
  -H "Content-Type: application/json" \
  -d '{"movil_ids": ["693"]}'
```

---

# Pedidos API

## POST /api/import/pedidos
Inserta uno o más pedidos en la base de datos.

### Request

**Method:** `POST`  
**Endpoint:** `/api/import/pedidos`  
**Content-Type:** `application/json`

### Request Body

#### Objeto único
```json
{
  "pedido_id": 12345,
  "movil": 693,
  "descripcion": "Entrega en CABA",
  "prioridad": 1,
  "latitud": -34.603722,
  "longitud": -58.381592,
  "escenario_id": 1,
  "fecha_hora_para": "2025-12-10T14:30:00Z"
}
```

#### Array de objetos
```json
{
  "pedidos": [
    { "pedido_id": 12345, ... },
    { "pedido_id": 12346, ... }
  ]
}
```

### Response 200 OK
```json
{
  "success": true,
  "message": "1 pedidos importados correctamente",
  "data": [...]
}
```

### cURL Example
```bash
curl -X POST http://localhost:3000/api/import/pedidos \
  -H "Content-Type: application/json" \
  -d '{"pedido_id": 12345, "movil": 693, "descripcion": "Entrega"}'
```

---

## PUT /api/import/pedidos
Actualiza pedidos existentes o los inserta (upsert).

**Method:** `PUT`  
**Endpoint:** `/api/import/pedidos`  
**onConflict:** `pedido_id`

### cURL Example
```bash
curl -X PUT http://localhost:3000/api/import/pedidos \
  -H "Content-Type: application/json" \
  -d '{"pedido_id": 12345, "descripcion": "Entrega Actualizada"}'
```

---

## DELETE /api/import/pedidos
Elimina pedidos por IDs.

### Request Body
```json
{
  "pedido_ids": [12345, 12346]
}
```

### cURL Example
```bash
curl -X DELETE http://localhost:3000/api/import/pedidos \
  -H "Content-Type: application/json" \
  -d '{"pedido_ids": [12345]}'
```

---

# Demoras API

## POST /api/import/demoras
Inserta una o más demoras.

### Request Body
```json
{
  "demora_id": 789,
  "pedido_id": 12345,
  "motivo": "Tráfico",
  "minutos": 15,
  "fecha_hora": "2025-12-10T14:00:00Z"
}
```

### cURL Example
```bash
curl -X POST http://localhost:3000/api/import/demoras \
  -H "Content-Type: application/json" \
  -d '{"demora_id": 789, "pedido_id": 12345, "motivo": "Tráfico", "minutos": 15}'
```

---

## PUT /api/import/demoras
Actualiza demoras (upsert con `onConflict: 'demora_id'`)

---

## DELETE /api/import/demoras
Elimina demoras por IDs.

### Request Body
```json
{
  "demora_ids": [789, 790]
}
```

---

# Punto de Venta API

## POST /api/import/puntoventa
Inserta puntos de venta.

### Request Body
```json
{
  "puntoventa_id": 101,
  "nombre": "Sucursal Centro",
  "direccion": "Av. Corrientes 1234",
  "latitud": -34.603722,
  "longitud": -58.381592
}
```

### cURL Example
```bash
curl -X POST http://localhost:3000/api/import/puntoventa \
  -H "Content-Type: application/json" \
  -d '{"puntoventa_id": 101, "nombre": "Sucursal Centro"}'
```

---

## PUT /api/import/puntoventa
Actualiza puntos de venta (upsert con `onConflict: 'puntoventa_id'`)

---

## DELETE /api/import/puntoventa
Elimina puntos de venta por IDs.

### Request Body
```json
{
  "puntoventa_ids": [101, 102]
}
```

---

# Zonas API

## POST /api/import/zonas
Inserta zonas.

### Request Body
```json
{
  "zona_id": 1,
  "zona_nombre": "Zona Norte",
  "descripcion": "Cobertura norte de la ciudad"
}
```

### cURL Example
```bash
curl -X POST http://localhost:3000/api/import/zonas \
  -H "Content-Type: application/json" \
  -d '{"zona_id": 1, "zona_nombre": "Zona Norte"}'
```

---

## PUT /api/import/zonas
Actualiza zonas (upsert con `onConflict: 'zona_id'`)

---

## DELETE /api/import/zonas
Elimina zonas por IDs.

### Request Body
```json
{
  "zona_ids": [1, 2]
}
```

---

# Error Responses

## 400 Bad Request
Se devuelve cuando faltan parámetros requeridos o el formato es inválido.

```json
{
  "error": "Se requiere al menos un móvil"
}
```

## 500 Internal Server Error
Se devuelve cuando ocurre un error en el servidor o en la base de datos.

```json
{
  "error": "Error al importar móviles",
  "details": "duplicate key value violates unique constraint"
}
```

---

# Field Mappings

## Moviles - PascalCase → snake_case

| Campo Original | Campo DB | Tipo | Transformación |
|----------------|----------|------|----------------|
| `Descripcion` | `descripcion` | string | Directo |
| `EFleteraId` | `empresa_fletera_id` | integer | Directo |
| `EFleteraNom` | `empresa_fletera_nom` | string | Directo |
| `MostrarEnMapa` | `mostrar_en_mapa` | boolean | "S" → true, resto → false |
| `PermiteBajaMomentanea` | `permite_baja_momentanea` | boolean | "S" → true, resto → false |
| `PrintScreen` | `print_screen` | boolean | "S" → true, resto → false |
| `SePuedeActivarDesdeLaApp` | `se_puede_activar_desde_la_app` | boolean | "S" → true, resto → false |
| `SePuedeDesactivarDesdeLaApp` | `se_puede_desactivar_desde_la_app` | boolean | "S" → true, resto → false |
| `VisibleEnApp` | `visible_en_app` | boolean | "S" → true, resto → false |
| `debugMode` | `debug_mode` | boolean | Directo |
| `gpsN8n` | `gps_n8n` | boolean | Directo |
| `grabarPantalla` | `grabar_pantalla` | boolean | Directo |

## Conflict Resolution (onConflict)

| Tabla | Campo Único | Operación |
|-------|-------------|-----------|
| `moviles` | `id` (PK) | Upsert on conflict |
| `pedidos` | `pedido_id` | Upsert on conflict |
| `demoras` | `demora_id` | Upsert on conflict |
| `puntoventa` | `puntoventa_id` | Upsert on conflict |
| `zonas` | `zona_id` | Upsert on conflict |

---

# Testing

## Postman Collection

### Import Movil
```
POST http://localhost:3000/api/import/moviles
Headers: Content-Type: application/json
Body: { "id": "693", "Nro": 693, "Descripcion": "693", "EFleteraId": 111 }
```

### Update Movil
```
PUT http://localhost:3000/api/import/moviles
Headers: Content-Type: application/json
Body: { "id": "693", "Descripcion": "693 Actualizado" }
```

### Delete Movil
```
DELETE http://localhost:3000/api/import/moviles
Headers: Content-Type: application/json
Body: { "movil_ids": ["693"] }
```

---

# Notes

1. **Formato flexible**: Todos los endpoints aceptan objetos únicos o arrays
2. **Transformación automática**: Los campos PascalCase se convierten a snake_case
3. **Conversión de booleanos**: Los valores "S"/"N" se convierten a true/false
4. **Upsert por defecto**: Usar PUT para insertar o actualizar
5. **Eliminación en lote**: DELETE acepta arrays de IDs

---

**Version:** 1.0.0  
**Last Updated:** December 10, 2025  
**Base URL:** `http://localhost:3000`
