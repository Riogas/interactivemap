# 🧪 Script de Testing para APIs de Importación

## 📝 Descripción
Este script permite probar todos los endpoints de importación y verificar los status codes.

---

## 🚀 Ejecutar Tests

### 1. **Test de Móviles - POST (Insertar)**

```powershell
$body = @{
    moviles = @(
        @{
            Nro = 999
            Matricula = "TEST-999"
            Descripcion = "Móvil de prueba"
            EFleteraId = 1
            EFleteraNom = "Empresa Test"
            MostrarEnMapa = "S"
            VisibleEnApp = "S"
        }
    )
} | ConvertTo-Json -Depth 10

$response = Invoke-WebRequest `
    -Uri "https://track.riogas.com.uy/api/import/moviles" `
    -Method POST `
    -ContentType "application/json" `
    -Body $body `
    -UseBasicParsing

Write-Host "Status Code: $($response.StatusCode)"
Write-Host "Response: $($response.Content)"
```

**Resultado Esperado:**
```
Status Code: 200
Response: {"success":true,"message":"1 móvil(es) importado(s) correctamente"...}
```

---

### 2. **Test de Móviles - PUT (Actualizar)**

```powershell
$body = @{
    moviles = @(
        @{
            id = "999"
            Matricula = "TEST-999-UPDATED"
            Descripcion = "Móvil actualizado"
        }
    )
} | ConvertTo-Json -Depth 10

$response = Invoke-WebRequest `
    -Uri "https://track.riogas.com.uy/api/import/moviles" `
    -Method PUT `
    -ContentType "application/json" `
    -Body $body `
    -UseBasicParsing

Write-Host "Status Code: $($response.StatusCode)"
Write-Host "Response: $($response.Content)"
```

**Resultado Esperado:**
```
Status Code: 200
Response: {"success":true,"message":"1 móvil(es) actualizado(s) correctamente"...}
```

---

### 3. **Test de Móviles - DELETE (Eliminar)**

```powershell
$body = @{
    movil_ids = @("999")
} | ConvertTo-Json -Depth 10

$response = Invoke-WebRequest `
    -Uri "https://track.riogas.com.uy/api/import/moviles" `
    -Method DELETE `
    -ContentType "application/json" `
    -Body $body `
    -UseBasicParsing

Write-Host "Status Code: $($response.StatusCode)"
Write-Host "Response: $($response.Content)"
```

**Resultado Esperado:**
```
Status Code: 200
Response: {"success":true,"message":"1 móvil(es) eliminado(s) correctamente"...}
```

---

### 4. **Test de Error 400 (Bad Request)**

```powershell
# Enviar body vacío
$body = @{} | ConvertTo-Json

try {
    $response = Invoke-WebRequest `
        -Uri "https://track.riogas.com.uy/api/import/moviles" `
        -Method POST `
        -ContentType "application/json" `
        -Body $body `
        -UseBasicParsing
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    $responseBody = $_.ErrorDetails.Message
    
    Write-Host "Status Code: $statusCode"
    Write-Host "Response: $responseBody"
}
```

**Resultado Esperado:**
```
Status Code: 400
Response: {"success":false,"error":"Se requiere al menos un móvil en el body"...}
```

---

### 5. **Test de Error 500 (Simular error de DB)**

```powershell
# Enviar datos inválidos que causan error de DB
$body = @{
    moviles = @(
        @{
            # ID duplicado o campos inválidos
            id = "INVALID_ID_FORMAT"
            Nro = "NOT_A_NUMBER"
        }
    )
} | ConvertTo-Json -Depth 10

try {
    $response = Invoke-WebRequest `
        -Uri "https://track.riogas.com.uy/api/import/moviles" `
        -Method POST `
        -ContentType "application/json" `
        -Body $body `
        -UseBasicParsing
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    $responseBody = $_.ErrorDetails.Message
    
    Write-Host "Status Code: $statusCode"
    Write-Host "Response: $responseBody"
}
```

**Resultado Esperado:**
```
Status Code: 500
Response: {"success":false,"error":"Error al insertar móviles en la base de datos"...}
```

---

## 🧪 Test Completo (Ejecutar todo de una vez)

```powershell
# Script completo de testing

Write-Host "🧪 Iniciando tests de API de Importación..." -ForegroundColor Cyan
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host ""

# Test 1: POST - Insertar móvil
Write-Host "✅ Test 1: POST /api/import/moviles (Insertar)" -ForegroundColor Green
$body = @{
    moviles = @(@{
        Nro = 999
        Matricula = "TEST-999"
        Descripcion = "Móvil de prueba"
        EFleteraId = 1
        MostrarEnMapa = "S"
    })
} | ConvertTo-Json -Depth 10

try {
    $response = Invoke-WebRequest `
        -Uri "https://track.riogas.com.uy/api/import/moviles" `
        -Method POST `
        -ContentType "application/json" `
        -Body $body `
        -UseBasicParsing
    
    Write-Host "   Status: $($response.StatusCode) ✅" -ForegroundColor Green
    $json = $response.Content | ConvertFrom-Json
    Write-Host "   Message: $($json.message)" -ForegroundColor Gray
} catch {
    Write-Host "   Status: $($_.Exception.Response.StatusCode.value__) ❌" -ForegroundColor Red
    Write-Host "   Error: $($_.ErrorDetails.Message)" -ForegroundColor Red
}
Write-Host ""

# Test 2: PUT - Actualizar móvil
Write-Host "✅ Test 2: PUT /api/import/moviles (Actualizar)" -ForegroundColor Green
$body = @{
    moviles = @(@{
        id = "999"
        Matricula = "TEST-999-UPDATED"
    })
} | ConvertTo-Json -Depth 10

try {
    $response = Invoke-WebRequest `
        -Uri "https://track.riogas.com.uy/api/import/moviles" `
        -Method PUT `
        -ContentType "application/json" `
        -Body $body `
        -UseBasicParsing
    
    Write-Host "   Status: $($response.StatusCode) ✅" -ForegroundColor Green
    $json = $response.Content | ConvertFrom-Json
    Write-Host "   Message: $($json.message)" -ForegroundColor Gray
} catch {
    Write-Host "   Status: $($_.Exception.Response.StatusCode.value__) ❌" -ForegroundColor Red
}
Write-Host ""

# Test 3: DELETE - Eliminar móvil
Write-Host "✅ Test 3: DELETE /api/import/moviles (Eliminar)" -ForegroundColor Green
$body = @{
    movil_ids = @("999")
} | ConvertTo-Json -Depth 10

try {
    $response = Invoke-WebRequest `
        -Uri "https://track.riogas.com.uy/api/import/moviles" `
        -Method DELETE `
        -ContentType "application/json" `
        -Body $body `
        -UseBasicParsing
    
    Write-Host "   Status: $($response.StatusCode) ✅" -ForegroundColor Green
    $json = $response.Content | ConvertFrom-Json
    Write-Host "   Message: $($json.message)" -ForegroundColor Gray
} catch {
    Write-Host "   Status: $($_.Exception.Response.StatusCode.value__) ❌" -ForegroundColor Red
}
Write-Host ""

# Test 4: Error 400 - Bad Request
Write-Host "⚠️ Test 4: POST /api/import/moviles (Error 400)" -ForegroundColor Yellow
$body = @{} | ConvertTo-Json

try {
    $response = Invoke-WebRequest `
        -Uri "https://track.riogas.com.uy/api/import/moviles" `
        -Method POST `
        -ContentType "application/json" `
        -Body $body `
        -UseBasicParsing
    
    Write-Host "   Status: $($response.StatusCode) ❌ (Debería ser 400)" -ForegroundColor Red
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    if ($statusCode -eq 400) {
        Write-Host "   Status: 400 ✅ (Error esperado)" -ForegroundColor Green
        $json = $_.ErrorDetails.Message | ConvertFrom-Json
        Write-Host "   Error: $($json.error)" -ForegroundColor Gray
    } else {
        Write-Host "   Status: $statusCode ❌" -ForegroundColor Red
    }
}
Write-Host ""

Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host "🎉 Tests completados!" -ForegroundColor Cyan
```

---

## 🔍 Verificar CORS

```powershell
# Test de preflight OPTIONS
$response = Invoke-WebRequest `
    -Uri "https://track.riogas.com.uy/api/import/moviles" `
    -Method OPTIONS `
    -UseBasicParsing

Write-Host "CORS Headers:"
$response.Headers.GetEnumerator() | Where-Object { $_.Key -like "*Access-Control*" } | ForEach-Object {
    Write-Host "  $($_.Key): $($_.Value)"
}
```

**Resultado Esperado:**
```
CORS Headers:
  Access-Control-Allow-Origin: *
  Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS
  Access-Control-Allow-Headers: Content-Type, Authorization, ...
```

---

## 📊 Verificar Logs en el Servidor

Después de ejecutar los tests, verifica los logs del servidor Next.js:

```bash
# En el servidor
pm2 logs trackmovil --lines 50

# O si usas Docker
docker logs trackmovil-container --tail 50
```

**Logs Esperados:**
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🌐 API REQUEST [2025-12-23T...]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Method: POST
Path: /api/import/moviles
Body: {...}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📦 Importando 1 móvil(es)...
✅ [200] 1 móvil(es) importado(s) correctamente
```

---

## 🐛 Troubleshooting

### Problema: "StatusCode = 0" en GeneXus

**Posibles causas:**
1. CORS bloqueado
2. Certificado SSL inválido
3. Firewall bloqueando peticiones
4. Timeout (petición demoró mucho)

**Solución:**
```powershell
# 1. Verificar conectividad básica
Test-NetConnection -ComputerName track.riogas.com.uy -Port 443

# 2. Verificar certificado SSL
$req = [System.Net.WebRequest]::Create("https://track.riogas.com.uy")
$req.GetResponse()

# 3. Test con cURL (si está instalado)
curl -v https://track.riogas.com.uy/api/import/moviles
```

---

## 📝 Notas

- Todos los tests deben ejecutarse desde PowerShell
- Asegúrate de estar conectado a la red correcta
- Los tests de error (400, 500) DEBEN fallar con ese status code específico
- Si recibes `StatusCode = 0`, verifica CORS y SSL primero

---

**Creado**: 23 de diciembre de 2025
