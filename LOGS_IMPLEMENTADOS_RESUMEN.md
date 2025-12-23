# ✅ LOGS DETALLADOS IMPLEMENTADOS

## 🎯 ¿Qué se agregó?

### 1. **Logs paso a paso en `/api/import/moviles`** ✅

Ahora cada vez que se ejecuta el endpoint, verás **9 pasos detallados**:

1. 📋 Headers de la petición
2. 📦 Parseo del body JSON (con el raw body completo)
3. 🔍 Extracción de móviles
4. ✔️ Validación
5. 📝 Datos recibidos (JSON completo de cada móvil)
6. 🔄 Transformación (JSON transformado de cada móvil)
7. 💾 Inserción en Supabase
8. 🔍 Resultado de Supabase (éxito o error detallado)
9. 📤 Preparación de respuesta

### 2. **Logs del Middleware** ✅

Cada petición a `/api/*` loguea:
- URL completa
- Método HTTP
- Origin
- User-Agent
- Content-Type
- Authorization (si existe)
- Todos los headers (en desarrollo)

### 3. **Logs de Respuesta** ✅

Tanto respuestas exitosas como errores ahora muestran:
- Status code
- Success (true/false)
- Message
- Data/Error
- Timestamp
- Content-Type

---

## 🖥️ Cómo Ver los Logs

### **En el servidor:**

```bash
# Ver logs en tiempo real
pm2 logs trackmovil

# Ver últimas 100 líneas
pm2 logs trackmovil --lines 100

# Limpiar logs antiguos
pm2 flush trackmovil
```

### **Con Docker:**

```bash
# Ver logs en tiempo real
docker logs -f trackmovil-container

# Ver últimas 100 líneas
docker logs --tail 100 trackmovil-container
```

---

## 🧪 Cómo Testear

### 1. **Abrir terminal con logs en tiempo real**

```bash
pm2 logs trackmovil --lines 0
```

### 2. **Ejecutar desde GeneXus**

```genexus
&HttpClient.Execute('POST', 'moviles')
&StatusCode = &HttpClient.StatusCode
&Response = &HttpClient.ToString()

msg('Status: ' + &StatusCode.ToString(), status)
msg('Response: ' + &Response, status)
```

### 3. **Ver logs en la terminal del servidor**

Deberías ver algo como:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🌐 MIDDLEWARE [2025-12-23T...]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📍 URL: /api/import/moviles
🔧 Método: POST
...

================================================================================
🚀 POST /api/import/moviles - INICIO
================================================================================

📋 PASO 1: Headers de la petición
...

✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅
✅ RESPUESTA EXITOSA [200]
✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅
```

---

## 🔍 Diagnóstico Según los Logs

### **Caso 1: No ves NINGÚN log**
→ ❌ Problema de red/firewall. La petición ni llega al servidor.

### **Caso 2: Ves middleware pero NO el endpoint**
→ ❌ Problema de CORS o routing.

### **Caso 3: Falla en PASO 2 (parseo JSON)**
→ ❌ JSON malformado o body vacío.

### **Caso 4: Falla en PASO 8 (Supabase)**
→ ❌ Error de base de datos (constraint, permisos, etc).

### **Caso 5: Todo OK pero GeneXus recibe StatusCode = 0**
→ ❌ Problema en GeneXus (certificado SSL, timeout, etc).

---

## 🚀 Deploy

```bash
# Commit
git add .
git commit -m "feat: Logs detallados paso a paso"
git push

# Restart
pm2 restart trackmovil
```

---

## 📚 Documentación Completa

Ver: **`DEBUGGING_LOGS_GUIDE.md`** para guía detallada.

---

**Ahora ejecuta desde GeneXus y comparte los logs que ves en el servidor.** 🎯

Con estos logs podremos saber EXACTAMENTE en qué paso falla y por qué GeneXus recibe `StatusCode = 0`.
