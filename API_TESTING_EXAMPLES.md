# 🧪 Testing de APIs - Ejemplos cURL

## � GPS Tracking API - Ejemplos Completos

### POST - Insertar Registro GPS Completo
```powershell
curl -X POST http://localhost:3000/api/import/gps `
  -H "Content-Type: application/json" `
  -d '{
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
  }'
```

### POST - Registro GPS Mínimo
```powershell
curl -X POST http://localhost:3000/api/import/gps `
  -H "Content-Type: application/json" `
  -d '{
    "movil": "693",
    "escenario": 1000,
    "latitud": -34.603722,
    "longitud": -58.381592,
    "battery_level": 80
  }'
```

### DELETE - Eliminar Registros GPS
```powershell
curl -X DELETE http://localhost:3000/api/import/gps `
  -H "Content-Type: application/json" `
  -d '{"gps_ids": [12345, 12346]}'
```

---

## �📦 Pedidos API - Ejemplos Completos

### POST - Insertar Pedido Completo
```powershell
curl -X POST http://localhost:3000/api/import/pedidos `
  -H "Content-Type: application/json" `
  -d '{
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
  }'
```

### PUT - Actualizar Pedido (Upsert)
```powershell
curl -X PUT http://localhost:3000/api/import/pedidos `
  -H "Content-Type: application/json" `
  -d '{
    "id": 16469323,
    "escenario": 1000,
    "Prioridad": 10,
    "PedidoObs": "PEDIDO ACTUALIZADO",
    "EstadoNro": 2
  }'
```

### DELETE - Eliminar Pedido
```powershell
curl -X DELETE http://localhost:3000/api/import/pedidos `
  -H "Content-Type: application/json" `
  -d '{"pedido_ids": [16469323]}'
```

---

## 🚗 Moviles API - Ejemplos Completos

### POST - Insertar Móvil
```powershell
curl -X POST http://localhost:3000/api/import/moviles `
  -H "Content-Type: application/json" `
  -d '{
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
  }'
```

### PUT - Actualizar Móvil
```powershell
curl -X PUT http://localhost:3000/api/import/moviles `
  -H "Content-Type: application/json" `
  -d '{
    "id": "693",
    "Descripcion": "693 ACTUALIZADO",
    "EstadoNro": 1
  }'
```

### DELETE - Eliminar Móvil
```powershell
curl -X DELETE http://localhost:3000/api/import/moviles `
  -H "Content-Type: application/json" `
  -d '{"movil_ids": ["693"]}'
```

---

## ✅ Respuestas Esperadas

### Success (200 OK)
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
      "created_at": "2025-12-10T12:00:00Z",
      "updated_at": "2025-12-10T12:00:00Z"
    }
  ]
}
```

### Error (400 Bad Request)
```json
{
  "error": "Se requiere al menos un pedido"
}
```

### Error (500 Internal Server Error)
```json
{
  "error": "Error al importar pedidos",
  "details": "duplicate key value violates unique constraint \"pedidos_pkey\""
}
```

---

## 🔍 Verificación en Supabase

### Verificar pedido insertado
```sql
SELECT * FROM pedidos WHERE id = 16469323;
```

### Verificar móvil insertado
```sql
SELECT * FROM moviles WHERE id = '693';
```

### Verificar transformación de campos
```sql
-- Ver que los campos PascalCase se convirtieron a snake_case
SELECT 
  id,
  cliente_direccion,  -- era ClienteDireccion
  prioridad,          -- era Prioridad
  visible_en_app      -- era VisibleEnApp
FROM pedidos 
WHERE id = 16469323;
```

### Verificar fechas nulas
```sql
-- Verificar que "0000-00-00T00:00:00" se convirtió a NULL
SELECT 
  id,
  fch_hora_max_ent_comp,  -- debe ser NULL
  fch_hora_para           -- debe tener fecha real
FROM pedidos 
WHERE id = 16469323;
```

---

## 🧪 Tests de Validación

### Test 1: Insertar pedido mínimo
```powershell
curl -X POST http://localhost:3000/api/import/pedidos `
  -H "Content-Type: application/json" `
  -d '{"id": 999999, "escenario": 1000}'
```

**Esperado:** ✅ Success con campos opcionales en NULL

### Test 2: Upsert (insertar primero, luego actualizar)
```powershell
# Primera vez (INSERT)
curl -X PUT http://localhost:3000/api/import/pedidos `
  -H "Content-Type: application/json" `
  -d '{"id": 888888, "escenario": 1000, "Prioridad": 5}'

# Segunda vez (UPDATE)
curl -X PUT http://localhost:3000/api/import/pedidos `
  -H "Content-Type: application/json" `
  -d '{"id": 888888, "escenario": 1000, "Prioridad": 10}'
```

**Esperado:** ✅ Primera vez crea, segunda vez actualiza Prioridad a 10

### Test 3: Fecha inválida
```powershell
curl -X POST http://localhost:3000/api/import/pedidos `
  -H "Content-Type: application/json" `
  -d '{"id": 777777, "escenario": 1000, "FchHoraMaxEntComp": "0000-00-00T00:00:00"}'
```

**Esperado:** ✅ `fch_hora_max_ent_comp` debe ser NULL en DB

### Test 4: Strings con espacios
```powershell
curl -X POST http://localhost:3000/api/import/pedidos `
  -H "Content-Type: application/json" `
  -d '{"id": 666666, "escenario": 1000, "ClienteCiudad": "MONTEVIDEO                    "}'
```

**Esperado:** ✅ `cliente_ciudad` debe ser "MONTEVIDEO" (sin espacios)

### Test 5: Conversión de decimales
```powershell
curl -X POST http://localhost:3000/api/import/pedidos `
  -H "Content-Type: application/json" `
  -d '{"id": 555555, "escenario": 1000, "ImpBruto": "1234.56", "Precio": "789.00"}'
```

**Esperado:** ✅ `imp_bruto` = 1234.56 (decimal), `precio` = 789.00 (decimal)

---

## 📊 Postman Collection

### Importar en Postman

1. **Crear Collection:** "TrackMovil Import APIs"
2. **Agregar Request:**
   - **Name:** POST Import Pedido
   - **Method:** POST
   - **URL:** `http://localhost:3000/api/import/pedidos`
   - **Headers:** `Content-Type: application/json`
   - **Body (raw):** Copiar JSON de ejemplo

3. **Variables de Colección:**
   - `base_url`: `http://localhost:3000`
   - `pedido_id`: `16469323`
   - `escenario`: `1000`

---

## 🚀 Scripts de Automatización

### Insertar múltiples pedidos (PowerShell)
```powershell
$pedidos = 16469323..16469330

foreach ($id in $pedidos) {
  curl -X POST http://localhost:3000/api/import/pedidos `
    -H "Content-Type: application/json" `
    -d "{`"id`":$id,`"escenario`":1000,`"Prioridad`":5}"
  
  Start-Sleep -Milliseconds 100
}
```

### Eliminar múltiples pedidos
```powershell
curl -X DELETE http://localhost:3000/api/import/pedidos `
  -H "Content-Type: application/json" `
  -d '{"pedido_ids": [16469323, 16469324, 16469325]}'
```

---

**Version:** 1.0.0  
**Last Updated:** December 10, 2025
