# 🔧 Guía de Status Codes HTTP - APIs de Importación

## 📌 **Problema Resuelto**

**ANTES**: Todos los endpoints devolvían respuestas inconsistentes y GeneXus recibía `StatusCode = 0`.

**AHORA**: Todos los endpoints devuelven status codes HTTP estándar y respuestas consistentes.

---

## 🎯 **Status Codes Implementados**

### ✅ **Códigos de Éxito**

| Código | Nombre | Cuándo se usa |
|--------|--------|---------------|
| **200** | OK | Operación exitosa (GET, PUT, DELETE) |
| **201** | Created | Recurso creado exitosamente (POST) |

### ❌ **Códigos de Error del Cliente**

| Código | Nombre | Cuándo se usa |
|--------|--------|---------------|
| **400** | Bad Request | JSON inválido, campos faltantes, datos incorrectos |
| **401** | Unauthorized | Token de autenticación inválido o faltante |
| **403** | Forbidden | No tiene permisos para esta operación |
| **404** | Not Found | Recurso no encontrado |
| **409** | Conflict | Conflicto (ej: ID duplicado en INSERT) |
| **422** | Unprocessable Entity | Datos válidos pero no procesables |

### 🔥 **Códigos de Error del Servidor**

| Código | Nombre | Cuándo se usa |
|--------|--------|---------------|
| **500** | Internal Server Error | Error inesperado del servidor o base de datos |
| **503** | Service Unavailable | Servicio temporalmente no disponible |

---

## 📦 **Formato de Respuesta Estándar**

Todos los endpoints devuelven un JSON con esta estructura:

### ✅ **Respuesta Exitosa**

```json
{
  "success": true,
  "message": "Operación completada exitosamente",
  "data": {
    "count": 5,
    "moviles": [...]
  },
  "timestamp": "2025-12-23T10:30:00.000Z",
  "statusCode": 200
}
```

### ❌ **Respuesta de Error**

```json
{
  "success": false,
  "message": "Error al procesar la solicitud",
  "error": "Descripción del error",
  "details": {
    "supabaseError": "duplicate key value violates unique constraint",
    "code": "23505"
  },
  "timestamp": "2025-12-23T10:30:00.000Z",
  "statusCode": 500
}
```

---

## 🚀 **Endpoints Actualizados**

### 1. **POST /api/import/moviles** - Insertar móviles

**Request:**
```json
{
  "moviles": [
    {
      "Nro": 123,
      "Matricula": "ABC-1234",
      "EFleteraId": 1,
      "MostrarEnMapa": "S"
    }
  ]
}
```

**Response 200 OK:**
```json
{
  "success": true,
  "message": "1 móvil(es) importado(s) correctamente",
  "data": {
    "count": 1,
    "moviles": [...]
  },
  "statusCode": 200
}
```

**Response 400 Bad Request:**
```json
{
  "success": false,
  "message": "Solicitud incorrecta",
  "error": "Se requiere al menos un móvil en el body",
  "statusCode": 400
}
```

**Response 500 Internal Server Error:**
```json
{
  "success": false,
  "message": "Error interno del servidor",
  "error": "Error al insertar móviles en la base de datos",
  "details": {
    "supabaseError": "duplicate key value...",
    "code": "23505"
  },
  "statusCode": 500
}
```

---

### 2. **PUT /api/import/moviles** - Actualizar móviles (Upsert)

**Request:**
```json
{
  "moviles": [
    {
      "id": "123",
      "Matricula": "XYZ-9999",
      "EstadoNro": 1
    }
  ]
}
```

**Response 200 OK:**
```json
{
  "success": true,
  "message": "1 móvil(es) actualizado(s) correctamente",
  "data": {
    "count": 1,
    "moviles": [...]
  },
  "statusCode": 200
}
```

---

### 3. **DELETE /api/import/moviles** - Eliminar móviles

**Request:**
```json
{
  "movil_ids": ["123", "456", "789"]
}
```

**Response 200 OK:**
```json
{
  "success": true,
  "message": "3 móvil(es) eliminado(s) correctamente",
  "data": {
    "deleted_count": 3,
    "moviles": [...]
  },
  "statusCode": 200
}
```

---

## 🔍 **Cómo Verificar Status Code en GeneXus**

### ❌ **PROBLEMA ACTUAL: StatusCode = 0**

Esto ocurre cuando:
1. **Error de CORS** - El navegador/servidor bloqueó la petición
2. **Error de SSL/TLS** - Certificado inválido en HTTPS
3. **Timeout** - La petición tardó demasiado
4. **Error de red** - No puede conectarse al servidor

### ✅ **SOLUCIÓN IMPLEMENTADA**

#### 1. **Middleware de CORS**
Se agregó `middleware.ts` que permite peticiones desde cualquier origen:

```typescript
// Headers CORS configurados:
'Access-Control-Allow-Origin': '*'
'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
'Access-Control-Allow-Headers': 'Content-Type, Authorization, ...'
```

#### 2. **Headers explícitos en respuestas**
Todas las respuestas incluyen:
```typescript
headers: {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store'
}
```

---

## 🧪 **Testing desde GeneXus**

### **Código GeneXus Actualizado**

```genexus
&HttpClient.Host = 'track.riogas.com.uy'
&HttpClient.Secure = 1
&HttpClient.Port = 443
&HttpClient.BaseUrl = '/api/import'
&HttpClient.AddHeader('Content-Type', 'application/json')
&HttpClient.AddHeader('Accept', 'application/json')

// Ejecutar petición
&HttpClient.AddString(&json)
&HttpClient.Execute('POST', &Endpoint)

// ✅ NUEVO: Verificar status code correctamente
&StatusCode = &HttpClient.StatusCode
&Response = &HttpClient.ToString()

msg('Status Code: ' + &StatusCode.ToString(), status)
msg('Response: ' + &Response, status)

// Interpretar respuesta
if &StatusCode = 200 or &StatusCode = 201
    // ✅ ÉXITO
    &Code = 'S'
    &Message = 'Operación exitosa'
else if &StatusCode = 400
    // ❌ ERROR: Datos inválidos
    &Code = 'E'
    &Message = 'Error de validación: ' + &Response
else if &StatusCode = 500
    // ❌ ERROR: Servidor
    &Code = 'E'
    &Message = 'Error del servidor: ' + &Response
else if &StatusCode = 0
    // ❌ ERROR: No hubo respuesta
    &Code = 'E'
    &Message = 'Error de conexión: No se pudo conectar con el servidor'
else
    // ❌ ERROR: Otro
    &Code = 'E'
    &Message = 'Error HTTP ' + &StatusCode.ToString() + ': ' + &Response
endif
```

---

## 🐛 **Debugging: Si Sigues Recibiendo StatusCode = 0**

### **1. Verificar CORS en el navegador**

Abre las DevTools (F12) en el navegador y ve a la pestaña "Network". Busca la petición y verifica:

- ❌ **Si dice "CORS error"**: El servidor bloqueó la petición
- ✅ **Si dice "200 OK"**: La petición fue exitosa

### **2. Verificar SSL/TLS**

Si usas HTTPS, asegúrate de que:
- El certificado SSL es válido
- El certificado no está expirado
- El dominio coincide con el certificado

### **3. Probar con cURL**

Desde la terminal/PowerShell:

```bash
# POST a móviles
curl -X POST https://track.riogas.com.uy/api/import/moviles \
  -H "Content-Type: application/json" \
  -d '{"moviles":[{"Nro":123,"Matricula":"TEST-123"}]}' \
  -v

# Verificar status code en la respuesta:
# < HTTP/1.1 200 OK  ← Aquí está el status code
```

### **4. Probar con Postman**

1. Crear nueva petición POST
2. URL: `https://track.riogas.com.uy/api/import/moviles`
3. Headers: `Content-Type: application/json`
4. Body (raw JSON):
```json
{
  "moviles": [
    {
      "Nro": 123,
      "Matricula": "TEST-123",
      "EFleteraId": 1
    }
  ]
}
```
5. Enviar y verificar: **Status: 200 OK**

---

## 📊 **Logs del Servidor**

Ahora todos los endpoints generan logs estructurados:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🌐 API REQUEST [2025-12-23T10:30:00.000Z]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Method: POST
Path: /api/import/moviles
Body: {
  "moviles": [...]
}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📦 Importando 5 móvil(es)...
✅ [200] 5 móvil(es) importado(s) correctamente
```

---

## 🔒 **Seguridad**

### **Headers de Seguridad Agregados**

```typescript
'Cache-Control': 'no-store, no-cache, must-revalidate'
'Content-Type': 'application/json'
'Access-Control-Allow-Origin': '*' // Cambiar a dominio específico en producción
```

### **Recomendaciones de Producción**

1. **Cambiar CORS a dominio específico:**
```typescript
// En middleware.ts
'Access-Control-Allow-Origin': 'https://tu-dominio-genexus.com'
```

2. **Agregar API Key:**
```typescript
// Header requerido:
'X-API-Key': 'tu-api-key-secreta'
```

3. **Rate Limiting:**
```typescript
// Implementar límite de peticiones (siguiente paso)
```

---

## 📝 **Próximos Pasos (Sugerencias)**

1. ✅ **HECHO**: Middleware CORS
2. ✅ **HECHO**: Respuestas estandarizadas
3. ✅ **HECHO**: Status codes correctos
4. ✅ **HECHO**: Logs estructurados
5. ⏳ **PENDIENTE**: Refactorizar `/api/import/pedidos`
6. ⏳ **PENDIENTE**: Refactorizar `/api/import/gps`
7. ⏳ **PENDIENTE**: Agregar autenticación con API Key
8. ⏳ **PENDIENTE**: Agregar rate limiting
9. ⏳ **PENDIENTE**: Agregar validación con Zod

---

## 🎯 **Resumen**

| Componente | Estado |
|------------|--------|
| Status codes HTTP | ✅ Implementado |
| Respuestas estandarizadas | ✅ Implementado |
| CORS middleware | ✅ Implementado |
| Logs estructurados | ✅ Implementado |
| Endpoint `/api/import/moviles` | ✅ Refactorizado |
| Endpoint `/api/import/pedidos` | ⏳ Pendiente |
| Endpoint `/api/import/gps` | ⏳ Pendiente |

---

## 🆘 **Soporte**

Si después de implementar esto sigues recibiendo `StatusCode = 0` en GeneXus:

1. Verifica el certificado SSL
2. Verifica que el dominio sea accesible desde GeneXus
3. Verifica los logs del servidor Next.js
4. Prueba con cURL o Postman primero
5. Revisa las reglas de firewall del servidor

---

**Última actualización**: 23 de diciembre de 2025
**Versión**: 1.0.0
