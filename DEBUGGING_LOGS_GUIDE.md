# 🔍 Guía de Debugging con Logs Detallados

## 📋 ¿Qué se implementó?

Se agregaron **logs extremadamente detallados** en cada paso del proceso de importación de móviles para diagnosticar el problema de `StatusCode = 0` en GeneXus.

---

## 🎯 Logs Implementados

### 1. **Middleware (Todas las peticiones)**

El middleware ahora loguea:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🌐 MIDDLEWARE [2025-12-23T10:30:00.000Z]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📍 URL: /api/import/moviles
🔧 Método: POST
🌍 Origin: https://tu-dominio-genexus.com
📱 User-Agent: GeneXus/...
📦 Content-Type: application/json
🔑 Authorization: NO

📋 Headers completos:
  content-type: application/json
  accept: application/json
  origin: https://...
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### 2. **POST /api/import/moviles (9 pasos detallados)**

#### PASO 1: Headers de la petición
```
📋 PASO 1: Headers de la petición
----------------------------------------
{
  "content-type": "application/json",
  "accept": "application/json",
  "origin": "https://...",
  "user-agent": "...",
  "authorization": "NO PRESENTE"
}
```

#### PASO 2: Parseo del body JSON
```
📦 PASO 2: Parseando body JSON
----------------------------------------
Body raw (primeros 500 chars): {"moviles":[{"Nro":123...
Longitud total del body: 1234 caracteres
✅ JSON parseado correctamente
Claves en el body: ["moviles"]
```

**Si hay error de parsing:**
```
❌ ERROR al parsear JSON: Unexpected token } in JSON at position 123
Stack trace: ...
```

#### PASO 3: Extracción de móviles
```
🔍 PASO 3: Extrayendo móviles del body
----------------------------------------
✅ Clave "moviles" encontrada
📊 Cantidad de móviles a procesar: 1
```

#### PASO 4: Validación
```
✔️  PASO 4: Validación de datos
----------------------------------------
✅ Validación exitosa
```

#### PASO 5: Datos recibidos
```
📝 PASO 5: Datos de móviles recibidos
----------------------------------------
Móvil #1: {
  "Nro": 123,
  "Matricula": "ABC-123",
  "EFleteraId": 1,
  ...
}
```

#### PASO 6: Transformación
```
🔄 PASO 6: Transformando datos a formato Supabase
----------------------------------------
Móvil #1 transformado: {
  "id": "123",
  "matricula": "ABC-123",
  "empresa_fletera_id": 1,
  ...
}
✅ Transformación completada
```

#### PASO 7: Inserción en Supabase
```
💾 PASO 7: Insertando en Supabase
----------------------------------------
Conectando a Supabase...
```

#### PASO 8: Resultado de Supabase
```
🔍 PASO 8: Verificando resultado de Supabase
----------------------------------------
✅ Inserción exitosa en Supabase
📊 Registros insertados: 1
📋 IDs insertados: 123
```

**Si hay error de Supabase:**
```
❌ ERROR DE SUPABASE:
  - Mensaje: duplicate key value violates unique constraint "moviles_pkey"
  - Código: 23505
  - Detalles: Key (id)=(123) already exists.
  - Hint: ...
```

#### PASO 9: Preparación de respuesta
```
📤 PASO 9: Preparando respuesta
----------------------------------------
Respuesta a enviar:
  - Success: true
  - Message: 1 móvil(es) importado(s) correctamente
  - Status Code: 200
  - Count: 1

================================================================================
✅ POST /api/import/moviles - ÉXITO
================================================================================
```

### 3. **Respuesta HTTP (successResponse/errorResponse)**

#### Respuesta Exitosa:
```
✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅
✅ RESPUESTA EXITOSA [200]
✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅
📤 Enviando respuesta:
  - Status Code: 200
  - Success: true
  - Message: 1 móvil(es) importado(s) correctamente
  - Data keys: ["count","moviles"]
  - Timestamp: 2025-12-23T10:30:00.000Z
  - Content-Type: application/json
✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅
```

#### Respuesta de Error:
```
❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌
❌ RESPUESTA DE ERROR [400]
❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌
📤 Enviando error:
  - Status Code: 400
  - Success: false
  - Error: Se requiere al menos un móvil en el body
  - Message: Solicitud incorrecta
  - Details: {"received":{},...}
  - Timestamp: 2025-12-23T10:30:00.000Z
❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌
```

---

## 🖥️ Cómo Ver los Logs en Tiempo Real

### **Opción 1: PM2 Logs (Recomendado)**

```bash
# Ver logs en tiempo real (todos)
pm2 logs trackmovil

# Ver solo últimas 50 líneas
pm2 logs trackmovil --lines 50

# Ver solo errores
pm2 logs trackmovil --err

# Ver solo output normal
pm2 logs trackmovil --out

# Limpiar logs antiguos
pm2 flush trackmovil
```

### **Opción 2: Docker Logs**

```bash
# Ver logs en tiempo real
docker logs -f trackmovil-container

# Ver últimas 100 líneas
docker logs --tail 100 trackmovil-container

# Ver logs con timestamps
docker logs -t trackmovil-container

# Ver logs desde hace 5 minutos
docker logs --since 5m trackmovil-container
```

### **Opción 3: Archivos de Log (si están configurados)**

```bash
# Ver logs en tiempo real
tail -f /var/log/trackmovil/app.log

# Ver últimas 100 líneas
tail -n 100 /var/log/trackmovil/app.log

# Buscar errores específicos
grep "ERROR" /var/log/trackmovil/app.log
grep "StatusCode = 0" /var/log/trackmovil/app.log
```

---

## 🧪 Proceso de Testing con Logs

### 1. **Antes de ejecutar desde GeneXus**

Abre una terminal en el servidor y ejecuta:

```bash
pm2 logs trackmovil --lines 0
```

Esto mostrará los logs en tiempo real **desde ahora**.

### 2. **Ejecutar petición desde GeneXus**

En tu código GeneXus:

```genexus
&HttpClient.Host = 'track.riogas.com.uy'
&HttpClient.Secure = 1
&HttpClient.Port = 443
&HttpClient.BaseUrl = '/api/import'
&HttpClient.AddHeader('Content-Type', 'application/json')
&HttpClient.AddHeader('Accept', 'application/json')

msg('Enviando petición...', status)

&HttpClient.AddString(&json)
&HttpClient.Execute('POST', 'moviles')

&StatusCode = &HttpClient.StatusCode
&Response = &HttpClient.ToString()

msg('Status Code: ' + &StatusCode.ToString(), status)
msg('Response: ' + &Response, status)
```

### 3. **Verificar logs en el servidor**

Inmediatamente deberías ver en la terminal:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🌐 MIDDLEWARE [2025-12-23T...]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📍 URL: /api/import/moviles
🔧 Método: POST
...
```

---

## 🔍 Qué Buscar en los Logs

### **Caso 1: La petición ni siquiera llega**

**Síntoma**: No ves NINGÚN log del middleware.

**Significa**:
- ❌ Problema de red/firewall
- ❌ URL incorrecta
- ❌ Puerto bloqueado

**Solución**:
```bash
# Verificar que el servidor esté escuchando
netstat -tulpn | grep 3000

# Verificar firewall
sudo ufw status
```

---

### **Caso 2: Llega el middleware pero no llega al endpoint**

**Síntoma**: Ves el log del middleware pero NO ves `POST /api/import/moviles - INICIO`.

**Significa**:
- ❌ Error de CORS (bloqueado en preflight)
- ❌ Routing incorrecto

**Solución**:
Verifica en los logs si hay un `OPTIONS` (preflight) antes del POST:
```
🔧 Método: OPTIONS
✅ Respondiendo a preflight OPTIONS con CORS headers
```

---

### **Caso 3: Llega al endpoint pero falla en el parseo**

**Síntoma**: Ves `PASO 1` y `PASO 2` pero luego `❌ ERROR al parsear JSON`.

**Significa**:
- ❌ JSON malformado desde GeneXus
- ❌ Content-Type incorrecto
- ❌ Body vacío

**Solución**:
Los logs te mostrarán:
```
Body raw (primeros 500 chars): {malformed json...
❌ ERROR al parsear JSON: Unexpected token...
```

Verifica el JSON que envías desde GeneXus.

---

### **Caso 4: Falla en Supabase**

**Síntoma**: Llegas hasta `PASO 7` pero fallas en `PASO 8`.

**Significa**:
- ❌ Error de base de datos
- ❌ Constrains violados (ID duplicado)
- ❌ Credenciales de Supabase incorrectas

**Solución**:
Los logs te mostrarán el error exacto de Supabase:
```
❌ ERROR DE SUPABASE:
  - Mensaje: duplicate key value...
  - Código: 23505
```

---

### **Caso 5: Todo exitoso pero GeneXus recibe StatusCode = 0**

**Síntoma**: Los logs muestran `✅ POST /api/import/moviles - ÉXITO` pero GeneXus recibe 0.

**Significa**:
- ❌ Problema en la respuesta HTTP (CORS, headers)
- ❌ GeneXus no puede parsear la respuesta
- ❌ Timeout en GeneXus

**Solución**:
```bash
# Test con cURL para verificar que el servidor responde correctamente
curl -X POST https://track.riogas.com.uy/api/import/moviles \
  -H "Content-Type: application/json" \
  -d '{"moviles":[{"Nro":999}]}' \
  -v

# Deberías ver:
< HTTP/1.1 200 OK
< Content-Type: application/json
< Access-Control-Allow-Origin: *
...
{"success":true,...}
```

Si cURL funciona pero GeneXus no, el problema está en GeneXus.

---

## 📊 Ejemplo Completo de Logs Exitosos

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🌐 MIDDLEWARE [2025-12-23T10:30:00.000Z]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📍 URL: /api/import/moviles
🔧 Método: POST
🌍 Origin: https://genexus.example.com
📱 User-Agent: GeneXus HttpClient/1.0
📦 Content-Type: application/json
🔑 Authorization: NO
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

================================================================================
🚀 [2025-12-23T10:30:00.123Z] POST /api/import/moviles - INICIO
================================================================================

📋 PASO 1: Headers de la petición
----------------------------------------
{
  "content-type": "application/json",
  "accept": "application/json",
  "origin": "https://genexus.example.com",
  "user-agent": "GeneXus HttpClient/1.0",
  "authorization": "NO PRESENTE"
}

📦 PASO 2: Parseando body JSON
----------------------------------------
Body raw (primeros 500 chars): {"moviles":[{"Nro":999,"Matricula":"TEST-999"}]}
Longitud total del body: 52 caracteres
✅ JSON parseado correctamente
Claves en el body: ["moviles"]

🔍 PASO 3: Extrayendo móviles del body
----------------------------------------
✅ Clave "moviles" encontrada
📊 Cantidad de móviles a procesar: 1

✔️  PASO 4: Validación de datos
----------------------------------------
✅ Validación exitosa

📝 PASO 5: Datos de móviles recibidos
----------------------------------------
Móvil #1: {
  "Nro": 999,
  "Matricula": "TEST-999"
}

🔄 PASO 6: Transformando datos a formato Supabase
----------------------------------------
Móvil #1 transformado: {
  "id": "999",
  "nro": 999,
  "matricula": "TEST-999",
  ...
}
✅ Transformación completada

💾 PASO 7: Insertando en Supabase
----------------------------------------
Conectando a Supabase...

🔍 PASO 8: Verificando resultado de Supabase
----------------------------------------
✅ Inserción exitosa en Supabase
📊 Registros insertados: 1
📋 IDs insertados: 999

📤 PASO 9: Preparando respuesta
----------------------------------------
Respuesta a enviar:
  - Success: true
  - Message: 1 móvil(es) importado(s) correctamente
  - Status Code: 200
  - Count: 1

================================================================================
✅ POST /api/import/moviles - ÉXITO
================================================================================

✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅
✅ RESPUESTA EXITOSA [200]
✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅
📤 Enviando respuesta:
  - Status Code: 200
  - Success: true
  - Message: 1 móvil(es) importado(s) correctamente
  - Data keys: ["count","moviles"]
  - Timestamp: 2025-12-23T10:30:00.456Z
  - Content-Type: application/json
✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅
```

---

## 🚀 Deploy y Testing

### 1. Deploy

```bash
# Commit
git add .
git commit -m "feat: Logs detallados para debugging de status code 0"
git push

# Restart servidor
pm2 restart trackmovil

# O con Docker
docker-compose restart
```

### 2. Verificar que los logs funcionan

```bash
# Test rápido
curl -X POST https://track.riogas.com.uy/api/import/moviles \
  -H "Content-Type: application/json" \
  -d '{"moviles":[{"Nro":999}]}'

# Ver logs
pm2 logs trackmovil --lines 100
```

Deberías ver TODOS los pasos detallados en los logs.

---

## 📝 Checklist de Debugging

Cuando ejecutes desde GeneXus y recibas `StatusCode = 0`:

1. [ ] ¿Ves el log del **MIDDLEWARE**? 
   - Si NO → Problema de red/firewall
   - Si SÍ → Continúa

2. [ ] ¿Ves el log **"POST /api/import/moviles - INICIO"**?
   - Si NO → Problema de CORS/routing
   - Si SÍ → Continúa

3. [ ] ¿Llega hasta **PASO 2** (parseo JSON)?
   - Si NO → Body vacío o no llegó
   - Si SÍ → Continúa

4. [ ] ¿Pasa el **PASO 2** sin errores?
   - Si NO → JSON malformado
   - Si SÍ → Continúa

5. [ ] ¿Llega hasta **PASO 8** (Supabase)?
   - Si NO → Error de validación o transformación
   - Si SÍ → Continúa

6. [ ] ¿PASO 8 muestra **"✅ Inserción exitosa"**?
   - Si NO → Error de base de datos
   - Si SÍ → Continúa

7. [ ] ¿Ves **"✅ RESPUESTA EXITOSA [200]"**?
   - Si NO → Error al enviar respuesta
   - Si SÍ → El servidor respondió correctamente

Si todos los pasos muestran ✅ pero GeneXus recibe 0, el problema está en GeneXus, no en el servidor.

---

**¡Ahora tienes logs súper detallados!** 🎯

Ejecuta desde GeneXus y comparte los logs para diagnosticar el problema exacto.
