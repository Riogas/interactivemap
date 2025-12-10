# 📚 API Documentation - TrackMovil Import APIs

## 🌐 Base URL
```
http://localhost:3000
```

---

## 📋 Table of Contents
- [Moviles API](#moviles-api)
- [Pedidos API](#pedidos-api)
- [GPS Tracking API](#gps-tracking-api)
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
  "id": 16469323,
  "escenario": 1000,
  "ClienteCiudad": "MONTEVIDEO",
  "ClienteDireccion": "CAMINO FRANCISCO LECOCQ 1013, entre LATERAL --CONCILIACION--",
  "ClienteDireccionEsq1": "CAMINO FRANCISCO LECOCQ 1013, entre LATERAL --CONCILIACION--",
  "ClienteDireccionObs": "",
  "ClienteNombre": "",
  "ClienteNro": 1671990,
  "ClienteObs": "",
  "ClienteTel": "99327670",
  "DemoraInformada": 0,
  "DetalleHTML": "",
  "EFleteraId": 0,
  "EFleteraNom": "",
  "EstadoNro": 1,
  "FPagoObs1": "",
  "FchHoraMaxEntComp": "0000-00-00T00:00:00",
  "FchHoraMov": "2025-10-09T11:52:30",
  "FchHoraPara": "2025-09-23T09:52:59",
  "FchHoraUPDFireStore": "2025-12-10T00:00:00",
  "FchPara": "",
  "GoogleMapsURL": "",
  "ImpBruto": "1267.00",
  "ImpFlete": "0.00",
  "Movil": 0,
  "OrdenCancelacion": "N",
  "OtrosProductos": "N",
  "PedidoObs": "NO TOCAR, PRUEBA DE SISTEMAS",
  "Precio": "1267.00",
  "Prioridad": 7,
  "ProductoCant": 1,
  "ProductoCod": "1002013",
  "ProductoNom": "",
  "ServicioNombre": "",
  "SubEstadoDesc": "6",
  "SubEstadoNro": 1,
  "Tipo": "",
  "VisibleEnApp": "S",
  "WazeURL": "",
  "ZonaNro": 0,
  "ubicacion": ""
}
```

#### Array de objetos
```json
{
  "pedidos": [
    { "id": 16469323, "escenario": 1000, ... },
    { "id": 16469324, "escenario": 1000, ... }
  ]
}
```

### Request Fields

| Campo | Tipo | Requerido | Descripción | Mapea a DB |
|-------|------|-----------|-------------|------------|
| `id` | bigint | ✅ | Identificador único del pedido | `id` (PK) |
| `escenario` | integer | ✅ | ID del escenario | `escenario` |
| **Datos del Cliente** | | | |
| `ClienteCiudad` | string | ❌ | Ciudad del cliente | `cliente_ciudad` |
| `ClienteDireccion` | string | ❌ | Dirección del cliente | `cliente_direccion` |
| `ClienteDireccionEsq1` | string | ❌ | Dirección esquina 1 | `cliente_direccion_esq1` |
| `ClienteDireccionObs` | string | ❌ | Observaciones de dirección | `cliente_direccion_obs` |
| `ClienteNombre` | string | ❌ | Nombre del cliente | `cliente_nombre` |
| `ClienteNro` | bigint | ❌ | Número de cliente | `cliente_nro` |
| `ClienteObs` | string | ❌ | Observaciones del cliente | `cliente_obs` |
| `ClienteTel` | string | ❌ | Teléfono del cliente | `cliente_tel` |
| **Info del Pedido** | | | |
| `DemoraInformada` | integer | ❌ | Demora informada en minutos | `demora_informada` |
| `DetalleHTML` | string | ❌ | Detalle en HTML | `detalle_html` |
| `EFleteraId` | integer | ❌ | ID de empresa fletera | `empresa_fletera_id` |
| `EFleteraNom` | string | ❌ | Nombre de empresa fletera | `empresa_fletera_nom` |
| `EstadoNro` | integer | ❌ | Número de estado | `estado_nro` |
| `FPagoObs1` | string | ❌ | Observaciones de forma de pago | `fpago_obs1` |
| **Fechas** | | | |
| `FchHoraMaxEntComp` | datetime | ❌ | Fecha/hora máxima entrega comprometida | `fch_hora_max_ent_comp` |
| `FchHoraMov` | datetime | ❌ | Fecha/hora movimiento | `fch_hora_mov` |
| `FchHoraPara` | datetime | ❌ | Fecha/hora para entrega | `fch_hora_para` |
| `FchHoraUPDFireStore` | datetime | ❌ | Fecha/hora actualización | `fch_hora_upd_firestore` |
| `FchPara` | date | ❌ | Fecha para entrega | `fch_para` |
| **URLs y Precios** | | | |
| `GoogleMapsURL` | string | ❌ | URL de Google Maps | `google_maps_url` |
| `ImpBruto` | decimal | ❌ | Importe bruto | `imp_bruto` |
| `ImpFlete` | decimal | ❌ | Importe flete | `imp_flete` |
| **Asignación** | | | |
| `Movil` | integer | ❌ | ID del móvil asignado | `movil` |
| `OrdenCancelacion` | string | ❌ | "N"/"S" - Orden de cancelación | `orden_cancelacion` |
| `OtrosProductos` | string | ❌ | "N"/"S" - Otros productos | `otros_productos` |
| `PedidoObs` | string | ❌ | Observaciones del pedido | `pedido_obs` |
| `Precio` | decimal | ❌ | Precio | `precio` |
| `Prioridad` | integer | ❌ | Prioridad (default: 0) | `prioridad` |
| **Producto** | | | |
| `ProductoCant` | decimal | ❌ | Cantidad de producto | `producto_cant` |
| `ProductoCod` | string | ❌ | Código de producto | `producto_cod` |
| `ProductoNom` | string | ❌ | Nombre de producto | `producto_nom` |
| `ServicioNombre` | string | ❌ | Nombre del servicio | `servicio_nombre` |
| **Sub Estado** | | | |
| `SubEstadoDesc` | string | ❌ | Descripción sub estado | `sub_estado_desc` |
| `SubEstadoNro` | integer | ❌ | Número sub estado | `sub_estado_nro` |
| **Otros** | | | |
| `Tipo` | string | ❌ | Tipo de pedido | `tipo` |
| `VisibleEnApp` | string | ❌ | "S"/"N" - Visible en app | `visible_en_app` |
| `WazeURL` | string | ❌ | URL de Waze | `waze_url` |
| `ZonaNro` | integer | ❌ | Número de zona | `zona_nro` |
| `ubicacion` | string | ❌ | Ubicación | `ubicacion` |

### Special Cases

- **Fechas "0000-00-00T00:00:00"**: Se convierten automáticamente a `null`
- **Strings con espacios**: Se aplica `.trim()` automáticamente
- **Campos numéricos**: Strings como "1267.00" se convierten a `decimal`

### Response 200 OK
```json
{
  "success": true,
  "message": "1 pedidos importados correctamente",
  "data": [
    {
      "id": 16469323,
      "escenario": 1000,
      "cliente_direccion": "CAMINO FRANCISCO LECOCQ 1013, entre LATERAL --CONCILIACION--",
      "prioridad": 7,
      "created_at": "2025-12-10T10:30:00Z",
      ...
    }
  ]
}
```

### Response 400 Bad Request
```json
{
  "error": "Se requiere al menos un pedido"
}
```

### Response 500 Internal Server Error
```json
{
  "error": "Error al importar pedidos",
  "details": "duplicate key value violates unique constraint \"pedidos_pkey\""
}
```

### cURL Example
```bash
curl -X POST http://localhost:3000/api/import/pedidos \
  -H "Content-Type: application/json" \
  -d '{
    "id": 16469323,
    "escenario": 1000,
    "ClienteNro": 1671990,
    "ClienteDireccion": "CAMINO FRANCISCO LECOCQ 1013",
    "Prioridad": 7
  }'
```

---

## PUT /api/import/pedidos
Actualiza pedidos existentes o los inserta si no existen (upsert).

### Request

**Method:** `PUT`  
**Endpoint:** `/api/import/pedidos`  
**Content-Type:** `application/json`

### Request Body
Mismo formato que POST (ver arriba)

### Behavior
- Si el pedido con el `id` especificado existe, se actualiza
- Si no existe, se inserta como nuevo registro
- Usa `onConflict: 'id'` (PRIMARY KEY)

### Response 200 OK
```json
{
  "success": true,
  "message": "1 pedidos actualizados correctamente",
  "data": [...]
}
```

### cURL Example
```bash
curl -X PUT http://localhost:3000/api/import/pedidos \
  -H "Content-Type: application/json" \
  -d '{"id": 16469323, "Prioridad": 10}'
```

---

## DELETE /api/import/pedidos
Elimina uno o más pedidos por sus IDs.

### Request

**Method:** `DELETE`  
**Endpoint:** `/api/import/pedidos`  
**Content-Type:** `application/json`

### Request Body
```json
{
  "pedido_ids": [16469323, 16469324]
}
```

### Response 200 OK
```json
{
  "success": true,
  "message": "2 pedidos eliminados correctamente",
  "deleted_count": 2
}
```

### cURL Example
```bash
curl -X DELETE http://localhost:3000/api/import/pedidos \
  -H "Content-Type: application/json" \
  -d '{"pedido_ids": [16469323]}'
```

---

# GPS Tracking API

## POST /api/import/gps
Inserta registros de seguimiento GPS con información extendida del dispositivo.

### Request

**Method:** `POST`  
**Endpoint:** `/api/import/gps`  
**Content-Type:** `application/json`

### Request Body

#### Objeto único
```json
{
  "movil": "693",
  "escenario": 1000,
  "latitud": -34.8,
  "longitud": -56.2,
  "accuracy": 10.5,
  "altitude": 45.2,
  "bearing": 180.5,
  "provider": "gps",
  "speed_accuracy": 2.5,
  "is_mock_location": false,
  "location_age_ms": 1500,
  "satellites_used": 8,
  "satellites_total": 12,
  "satellites_avg_snr": 25.5,
  "velocidad": 35.5,
  "distancia_recorrida": 1250.75,
  "movement_type": "MOVING",
  "app_state": "FOREGROUND",
  "app_version": "1.1",
  "permission_fine_location": true,
  "permission_coarse_location": true,
  "permission_background_location": true,
  "notifications_enabled": true,
  "gps_enabled": true,
  "battery_level": 84,
  "battery_charging": false,
  "battery_status": "DISCHARGING",
  "battery_saver_on": false,
  "battery_optimization_ignored": true,
  "doze_mode_active": false,
  "network_type": "CELLULAR",
  "network_connected": true,
  "device_manufacturer": "samsung",
  "device_model": "SM-A146M",
  "device_brand": "samsung",
  "android_version": 35,
  "android_release": "15",
  "memory_available_mb": 942,
  "memory_total_mb": 3450,
  "memory_low": false,
  "execution_counter": 1,
  "last_reset_reason": "",
  "timestamp_local": "2025-12-10T11:19:25-0300",
  "timestamp_utc": "2025-12-10T14:19:25.320Z"
}
```

#### Array de objetos
```json
{
  "gps": [
    { "movil": "693", "escenario": 1000, ... },
    { "movil": "694", "escenario": 1000, ... }
  ]
}
```

### Request Fields

| Campo | Tipo | Requerido | Descripción |
|-------|------|-----------|-------------|
| **IDs y Referencias** | | | |
| `movil` | string | ✅ | ID del móvil |
| `pedido_id` | bigint | ❌ | ID del pedido asociado |
| `escenario` | integer | ❌ | ID del escenario |
| `device_id` | string | ❌ | ID único del dispositivo |
| `usuario` | string | ❌ | Usuario asociado |
| **Ubicación Básica** | | | |
| `latitud` | decimal | ✅ | Latitud GPS |
| `longitud` | decimal | ✅ | Longitud GPS |
| `utm_x` | decimal | ❌ | Coordenada UTM X |
| `utm_y` | decimal | ❌ | Coordenada UTM Y |
| **Precisión GPS** | | | |
| `accuracy` | decimal | ❌ | Precisión en metros |
| `altitude` | decimal | ❌ | Altitud en metros |
| `bearing` | decimal | ❌ | Rumbo en grados |
| `provider` | string | ❌ | Proveedor GPS (gps, network) |
| `speed_accuracy` | decimal | ❌ | Precisión de velocidad |
| `is_mock_location` | boolean | ❌ | Ubicación simulada |
| `location_age_ms` | bigint | ❌ | Edad de la ubicación en ms |
| **Satélites** | | | |
| `satellites_used` | integer | ❌ | Satélites usados |
| `satellites_total` | integer | ❌ | Satélites totales |
| `satellites_avg_snr` | decimal | ❌ | SNR promedio |
| **Movimiento** | | | |
| `velocidad` | decimal | ❌ | Velocidad en km/h |
| `distancia_recorrida` | decimal | ❌ | Distancia en metros |
| `movement_type` | string | ❌ | MOVING, STATIONARY, etc. |
| **App** | | | |
| `app_state` | string | ❌ | FOREGROUND, BACKGROUND |
| `app_version` | string | ❌ | Versión de la app |
| **Permisos** | | | |
| `permission_fine_location` | boolean | ❌ | Permiso ubicación precisa |
| `permission_coarse_location` | boolean | ❌ | Permiso ubicación aproximada |
| `permission_background_location` | boolean | ❌ | Permiso ubicación en background |
| `notifications_enabled` | boolean | ❌ | Notificaciones habilitadas |
| `gps_enabled` | boolean | ❌ | GPS habilitado |
| **Batería** | | | |
| `battery_level` | integer | ❌ | Nivel de batería (0-100) |
| `battery_charging` | boolean | ❌ | Cargando |
| `battery_status` | string | ❌ | CHARGING, DISCHARGING, etc. |
| `battery_saver_on` | boolean | ❌ | Ahorro de batería activo |
| `battery_optimization_ignored` | boolean | ❌ | Optimización ignorada |
| `doze_mode_active` | boolean | ❌ | Modo Doze activo |
| **Red** | | | |
| `network_type` | string | ❌ | WIFI, CELLULAR, etc. |
| `network_connected` | boolean | ❌ | Red conectada |
| **Dispositivo** | | | |
| `device_manufacturer` | string | ❌ | Fabricante |
| `device_model` | string | ❌ | Modelo |
| `device_brand` | string | ❌ | Marca |
| `android_version` | integer | ❌ | Versión Android (API level) |
| `android_release` | string | ❌ | Release (ej: "15") |
| **Memoria** | | | |
| `memory_available_mb` | integer | ❌ | Memoria disponible en MB |
| `memory_total_mb` | integer | ❌ | Memoria total en MB |
| `memory_low` | boolean | ❌ | Memoria baja |
| **Ejecución** | | | |
| `execution_counter` | integer | ❌ | Contador de ejecuciones |
| `last_reset_reason` | string | ❌ | Razón del último reset |
| **Timestamps** | | | |
| `timestamp_local` | timestamptz | ❌ | Timestamp local con zona horaria |
| `timestamp_utc` | timestamptz | ❌ | Timestamp UTC |

### Response 200 OK
```json
{
  "success": true,
  "message": "1 registros GPS insertados correctamente",
  "data": [
    {
      "id": 12345,
      "movil_id": "693",
      "escenario": 1000,
      "latitud": -34.8,
      "longitud": -56.2,
      "battery_level": 84,
      "created_at": "2025-12-10T14:19:25Z",
      ...
    }
  ]
}
```

### Response 400 Bad Request
```json
{
  "error": "Se requiere al menos un registro GPS"
}
```

### Response 500 Internal Server Error
```json
{
  "error": "Error al insertar GPS",
  "details": "violates foreign key constraint \"fk_gps_movil\""
}
```

### cURL Example
```bash
curl -X POST http://localhost:3000/api/import/gps \
  -H "Content-Type: application/json" \
  -d '{
    "movil": "693",
    "escenario": 1000,
    "latitud": -34.8,
    "longitud": -56.2,
    "battery_level": 84,
    "timestamp_local": "2025-12-10T11:19:25-0300"
  }'
```

---

## DELETE /api/import/gps
Elimina registros GPS por IDs.

### Request

**Method:** `DELETE`  
**Endpoint:** `/api/import/gps`  
**Content-Type:** `application/json`

### Request Body
```json
{
  "gps_ids": [12345, 12346]
}
```

### Response 200 OK
```json
{
  "success": true,
  "message": "2 registros GPS eliminados correctamente",
  "deleted_count": 2
}
```

### cURL Example
```bash
curl -X DELETE http://localhost:3000/api/import/gps \
  -H "Content-Type: application/json" \
  -d '{"gps_ids": [12345]}'
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

## Pedidos - PascalCase → snake_case

| Campo Original | Campo DB | Tipo | Transformación |
|----------------|----------|------|----------------|
| `id` | `id` | bigint | Directo (PK) |
| `escenario` | `escenario` | integer | Directo |
| **Cliente** | | | |
| `ClienteCiudad` | `cliente_ciudad` | string | trim() |
| `ClienteDireccion` | `cliente_direccion` | string | trim() |
| `ClienteDireccionEsq1` | `cliente_direccion_esq1` | string | trim() |
| `ClienteDireccionObs` | `cliente_direccion_obs` | string | trim() |
| `ClienteNombre` | `cliente_nombre` | string | trim() |
| `ClienteNro` | `cliente_nro` | bigint | Directo |
| `ClienteObs` | `cliente_obs` | string | trim() |
| `ClienteTel` | `cliente_tel` | string | trim() |
| **Pedido** | | | |
| `DemoraInformada` | `demora_informada` | integer | Directo |
| `DetalleHTML` | `detalle_html` | string | Directo |
| `EFleteraId` | `empresa_fletera_id` | integer | Directo |
| `EFleteraNom` | `empresa_fletera_nom` | string | trim() |
| `EstadoNro` | `estado_nro` | integer | Directo |
| `FPagoObs1` | `fpago_obs1` | string | trim() |
| **Fechas** | | | |
| `FchHoraMaxEntComp` | `fch_hora_max_ent_comp` | timestamptz | "0000-00-00T00:00:00" → null |
| `FchHoraMov` | `fch_hora_mov` | timestamptz | parseDate() |
| `FchHoraPara` | `fch_hora_para` | timestamptz | parseDate() |
| `FchHoraUPDFireStore` | `fch_hora_upd_firestore` | timestamptz | parseDate() |
| `FchPara` | `fch_para` | date | parseDate() |
| **Precios** | | | |
| `GoogleMapsURL` | `google_maps_url` | string | Directo |
| `ImpBruto` | `imp_bruto` | decimal | parseFloat("1267.00") → 1267.00 |
| `ImpFlete` | `imp_flete` | decimal | parseFloat() |
| `Precio` | `precio` | decimal | parseFloat() |
| **Producto** | | | |
| `ProductoCant` | `producto_cant` | decimal | parseFloat() |
| `ProductoCod` | `producto_cod` | string | trim() |
| `ProductoNom` | `producto_nom` | string | trim() |
| `ServicioNombre` | `servicio_nombre` | string | trim() |
| **Otros** | | | |
| `Movil` | `movil` | integer | Directo |
| `OrdenCancelacion` | `orden_cancelacion` | char(1) | Default: "N" |
| `OtrosProductos` | `otros_productos` | char(1) | Default: "N" |
| `PedidoObs` | `pedido_obs` | string | trim() |
| `Prioridad` | `prioridad` | integer | Default: 0 |
| `SubEstadoDesc` | `sub_estado_desc` | string | trim() |
| `SubEstadoNro` | `sub_estado_nro` | integer | Directo |
| `Tipo` | `tipo` | string | Directo |
| `VisibleEnApp` | `visible_en_app` | char(1) | Default: "S" |
| `WazeURL` | `waze_url` | string | Directo |
| `ZonaNro` | `zona_nro` | integer | Directo |
| `ubicacion` | `ubicacion` | string | Directo |

## Conflict Resolution (onConflict)

| Tabla | Campo Único | Operación |
|-------|-------------|-----------|
| `moviles` | `id` (PK) | Upsert on conflict |
| `pedidos` | `id` (PK) | Upsert on conflict |
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
