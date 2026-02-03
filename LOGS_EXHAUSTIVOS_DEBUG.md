# 🔍 Sistema de Logging Exhaustivo - Debug Error 500

**Fecha:** Febrero 3, 2026
**Objetivo:** Identificar por qué el login devuelve 500 después de implementar seguridad

---

## 📝 Logs Agregados

### 1. **proxy.ts** (Middleware Global)
Logs en cada request que pasa por el middleware:
- ✅ Timestamp y URL completa
- ✅ Origin, Referer, User-Agent
- ✅ Verificación de actividad sospechosa (con detalles)
- ✅ Verificación de rate limits (con tipo detectado)
- ✅ Configuración de CORS (allowed origins)
- ✅ Headers de seguridad agregados

### 2. **lib/rate-limit.ts**
Logs en las funciones de seguridad:

**`detectSuspiciousActivity()`:**
- ✅ IP del cliente
- ✅ Pathname analizado
- ✅ User-Agent
- ✅ Patrones verificados
- ✅ Alerta roja si se detecta algo sospechoso

**`autoRateLimit()`:**
- ✅ Pathname analizado
- ✅ Tipo de endpoint detectado (auth, import, proxy, public, default)
- ✅ Configuración aplicada (max requests, window)
- ✅ Resultado del check

**`checkRateLimit()`:**
- ✅ IP del cliente
- ✅ Tipo de límite
- ✅ Key generada
- ✅ Record existente (count, resetTime, blockedUntil)
- ✅ Estado de bloqueo

### 3. **app/api/proxy/[...path]/route.ts** (Proxy Handler)
Logs exhaustivos en cada fase:

**Fase 1: Inicio**
- ✅ Timestamp
- ✅ Method, Path Segments, Full URL
- ✅ Path unido

**Fase 2: Autenticación**
- ✅ Verificar si es login path
- ✅ Si no es login: resultado de requireAuth()
- ✅ Si es login: mensaje de skip auth

**Fase 3: Whitelist**
- ✅ Validación contra ALLOWED_PATHS
- ✅ Lista de rutas permitidas si falla

**Fase 4: Construcción de Request**
- ✅ Base URL, Constructed URL
- ✅ Query parameters
- ✅ Full URL final
- ✅ Authorization header (si existe)
- ✅ Todos los headers incoming relevantes

**Fase 5: Body (POST/PUT/PATCH)**
- ✅ Indicador de método que requiere body
- ✅ Body parseado (type, keys, values)
- ✅ Body stringified (length y contenido)
- ✅ Errores de parsing (con detalles de Content-Type)
- ✅ Intento de lectura como texto si falla JSON

**Fase 6: Envío al Backend**
- ✅ Separador visual
- ✅ Method, URL, Headers, Body completos

**Fase 7: Respuesta del Backend**
- ✅ Tiempo de respuesta
- ✅ Status, StatusText, OK, Type
- ✅ URL final, Redirected
- ✅ Todos los response headers
- ✅ Content-Type
- ✅ Response data (parseado o como texto)
- ✅ Set-Cookie header si existe

**Fase 8: Retorno al Cliente**
- ✅ Status final
- ✅ Headers a enviar
- ✅ Data final

**Fase 9: Errores**
- ✅ Separador visual de alerta
- ✅ Error type, message, stack trace

---

## 🎯 Flujo de Logs Esperado

### Para un Login Normal:

```
🌐 ╔══════════════════════════════════════════════════════════════════════════════╗
🌐 ║ PROXY/MIDDLEWARE - Request Received
🌐 ╚══════════════════════════════════════════════════════════════════════════════╝
🕐 Timestamp: 2026-02-03T18:14:13.378Z
📍 Method: POST
📍 Pathname: /api/proxy/gestion/login
📍 Search: 
📍 Full URL: /api/proxy/gestion/login
📍 Origin: http://localhost:3001
📍 Referer: http://localhost:3001/login

🔍 Verificando actividad sospechosa...
🔍 detectSuspiciousActivity:
   - IP: ::1
   - Pathname: /api/proxy/gestion/login
   - User-Agent: Mozilla/5.0...
   ✅ No se detectó actividad sospechosa
✅ Actividad normal - no sospechosa

🚦 Verificando rate limits...
🚦 autoRateLimit:
   - Pathname: /api/proxy/gestion/login
   - Tipo detectado: PROXY
   - Config: 50 req / 60000ms

🚦 checkRateLimit:
   - IP: ::1
   - Type: proxy
   - Config: 50 req / 60000ms
   - Key: ::1:proxy
   - Record exists: false (primer intento)
   ✅ Rate limit OK
✅ Rate limit OK

🔒 Configurando CORS...
🔒 Allowed Origins (7): [http://localhost:3000, http://localhost:3001, ...]
🔒 Request Origin: http://localhost:3001
🔒 Is Allowed: true
✅ Origin permitido - configurando CORS para: http://localhost:3001
🔒 CORS Headers configurados: { Access-Control-Allow-Origin: 'http://localhost:3001', ... }

➡️ Continuando al handler de ruta...
🔒 Agregando security headers...
✅ Security headers agregados
────────────────────────────────────────────────────────────────────────────────

════════════════════════════════════════════════════════════════════════════════
🚀 PROXY REQUEST INICIADO
════════════════════════════════════════════════════════════════════════════════
⏰ Timestamp: 2026-02-03T18:14:13.380Z
📍 Method: POST
📍 Path Segments: [ 'gestion', 'login' ]
📍 Full URL: http://localhost:3001/api/proxy/gestion/login
📍 Joined Path: gestion/login
🔐 Is Login Path: true
⚠️ SALTANDO autenticación (es login path)

🔍 Validando ruta contra lista blanca...
✅ Ruta permitida

🌐 Base URL: https://sgm.glp.riogas.com.uy
🌐 Constructed URL: https://sgm.glp.riogas.com.uy/gestion/login
🌐 Query String: (none)
🌐 Full URL: https://sgm.glp.riogas.com.uy/gestion/login
⚠️ No Authorization header

📥 Request Headers (incoming):
   content-type: application/json
   
📦 Método requiere body (POST)
📦 Body parseado exitosamente:
   - Type: object
   - Keys: [Usuario, Contrasenia]
   - Values: { Usuario: 'admin', Contrasenia: 'password123' }
📦 Body stringified (49 chars): {"Usuario":"admin","Contrasenia":"password123"}

────────────────────────────────────────────────────────────────────────────────
🔄 Enviando request al backend...
────────────────────────────────────────────────────────────────────────────────
📤 Method: POST
📤 URL: https://sgm.glp.riogas.com.uy/gestion/login
📤 Headers: { Content-Type: 'application/json', Accept: 'application/json' }
📤 Body (49 chars): {"Usuario":"admin","Contrasenia":"password123"}

🚀 Ejecutando fetch...
✅ Fetch completado en 523ms

────────────────────────────────────────────────────────────────────────────────
📥 RESPUESTA DEL BACKEND
────────────────────────────────────────────────────────────────────────────────
📥 Status: 500 Internal Server Error  ← ⚠️ AQUÍ ESTÁ EL PROBLEMA
📥 OK: false
📥 Type: cors
📥 URL: https://sgm.glp.riogas.com.uy/gestion/login
📥 Redirected: false

📥 Response Headers:
   content-type: application/json
   server: Apache
   ...

📥 Content-Type: application/json
📥 Parseando como JSON...
📥 Response Data (parsed JSON): {
  "error": {
    "code": 500,
    "message": "Internal Server Error"
  }
}

────────────────────────────────────────────────────────────────────────────────
📤 RETORNANDO AL CLIENTE
────────────────────────────────────────────────────────────────────────────────
📤 Status: 500
📤 Headers: { Content-Type: 'application/json' }
📤 Data: {
  "error": {
    "code": 500,
    "message": "Internal Server Error"
  }
}
════════════════════════════════════════════════════════════════════════════════
```

---

## 🔎 Qué Buscar en los Logs

### 1. **Body del Login**
**Esperado:**
```json
{
  "Usuario": "string",
  "Contrasenia": "string"
}
```

**Si los logs muestran:**
- `Keys: []` → El body está vacío ❌
- `Keys: [username, password]` → Los nombres de campos están mal ❌
- `Error parsing body` → El frontend no está enviando JSON ❌

### 2. **Headers Enviados**
**Verificar:**
- `Content-Type: application/json` ✅
- `Authorization: ...` (no debería existir para login)
- Origin permitido en CORS

### 3. **Rate Limiting**
**Verificar:**
- Si detecta tipo `AUTH` o `PROXY`
- Si el `Record count` es alto (podría estar bloqueado)
- Si dice `Rate limit excedido`

### 4. **Actividad Sospechosa**
**Verificar:**
- Si detecta algún patrón sospechoso en `/api/proxy/gestion/login`
- (No debería, pero hay que verificar)

### 5. **Autenticación**
**Debe mostrar:**
```
🔐 Is Login Path: true
⚠️ SALTANDO autenticación (es login path)
```

**Si muestra:**
```
🔐 Requiriendo autenticación (no es login)...
```
→ **¡PROBLEMA! El login está siendo autenticado cuando no debería.**

---

## 🚀 Cómo Usar Este Sistema

### 1. Reiniciar el servidor
```bash
# Detener servidor actual (Ctrl+C)

# Limpiar caché
Remove-Item -Path ".next" -Recurse -Force -ErrorAction SilentlyContinue

# Iniciar con logs
pnpm dev -- --webpack
```

### 2. Intentar login desde el navegador
- Abrir http://localhost:3001/login
- Ingresar credenciales
- Enviar

### 3. Revisar logs en la terminal
Buscar:
- ¿El body tiene los campos correctos?
- ¿Se está saltando la autenticación?
- ¿Hay algún bloqueo de rate limit?
- ¿Qué status retorna el backend?

### 4. Si el body está vacío o mal formado
Revisar el componente de login:
```bash
# Buscar el archivo de login
Get-ChildItem -Path . -Recurse -Filter "*login*" -File | Select-Object FullName
```

### 5. Si el backend sigue dando 500 con body correcto
Probar directamente con curl:
```bash
curl -X POST https://sgm.glp.riogas.com.uy/gestion/login `
  -H "Content-Type: application/json" `
  -d '{"Usuario":"test","Contrasenia":"test"}' `
  -k
```

---

## 📊 Archivos Modificados

```
✅ proxy.ts                              (logs exhaustivos en middleware)
✅ lib/rate-limit.ts                     (logs en detectSuspicious, autoRate, checkRate)
✅ app/api/proxy/[...path]/route.ts     (logs en cada fase del proxy)
```

---

## 🎯 Próximo Paso

**AHORA: Reiniciar el servidor y observar los logs completos del login.**

El sistema está preparado para mostrar EXACTAMENTE qué está pasando en cada paso.

---

## 🐛 Hipótesis a Verificar

1. **Body vacío** → El frontend no está enviando los datos
2. **Nombres de campos incorrectos** → Backend espera otros nombres
3. **Rate limiting de login** → Demasiados intentos previos
4. **Autenticación prematura** → El path no se detecta como login
5. **Backend realmente con error** → El problema no es nuestro código

**Los logs nos dirán cuál es.**
