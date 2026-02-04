# 🎯 PROBLEMA ENCONTRADO: 404 en Login

## 📋 Análisis de Logs

### ✅ Lo que FUNCIONA

1. **Next.js está corriendo correctamente**
2. **El proxy `/api/proxy/[...path]` está funcionando**
3. **Los logs muestran TODO el proceso correctamente**

### ❌ EL PROBLEMA REAL

**El backend de GeneXus está retornando 404**, NO es problema de Next.js ni nginx.

```
📥 RESPUESTA DEL BACKEND
────────────────────────────────────────────────────────────────────────────────
📥 Status: 404 Not Found
📥 URL: https://www.riogas.com.uy/gestion/login
📥 Response Text: <!doctype html>
<html lang="es">
<title>Página no encontrada - Riogas</title>
```

### 🔍 Lo que está pasando:

```
🌐 Constructed URL: https://www.riogas.com.uy/gestion/login
🌐 Full URL: https://www.riogas.com.uy/gestion/login
🚀 Ejecutando fetch...
✅ Fetch completado en 4215ms
📥 Status: 404 Not Found
```

**Conclusión**: 
- ✅ Next.js recibe la petición
- ✅ El proxy funciona correctamente
- ✅ Se envía al backend GeneXus
- ❌ **GeneXus retorna una página 404 de WordPress** (!)

## 🎯 La URL Está MAL

Estás enviando a:
```
https://www.riogas.com.uy/gestion/login
```

Pero según tus documentos anteriores, debería ser:
```
https://sgm.glp.riogas.com.uy/gestion/login
```

O posiblemente:
```
https://www.riogas.com.uy/puestos/gestion/login
```

## 🔧 Solución

### Ver la configuración actual del API:

```bash
cd /var/www/track
cat .env.production | grep API_BASE_URL
```

### Verificar qué URL es la correcta:

```bash
# Probar con sgm.glp.riogas.com.uy
curl -X POST https://sgm.glp.riogas.com.uy/gestion/login \
  -H "Content-Type: application/json" \
  -d '{"UserName":"test","Password":"test"}' \
  -v

# O probar con /puestos/
curl -X POST https://www.riogas.com.uy/puestos/gestion/login \
  -H "Content-Type: application/json" \
  -d '{"UserName":"test","Password":"test"}' \
  -v
```

### Corregir el .env.production:

```bash
nano .env.production
```

**Cambiar**:
```env
# Actual (INCORRECTO):
API_BASE_URL=https://www.riogas.com.uy

# Debería ser:
API_BASE_URL=https://sgm.glp.riogas.com.uy
```

O si es con `/puestos`:
```env
API_BASE_URL=https://www.riogas.com.uy/puestos
```

### Restart después de cambiar:

```bash
pm2 restart track
```

## 📊 Evidencia del Problema

Los logs muestran claramente:

1. **Request correcto desde el frontend**:
   ```
   📍 Joined Path: gestion/login
   🌐 Base URL: https://www.riogas.com.uy
   🌐 Constructed URL: https://www.riogas.com.uy/gestion/login
   ```

2. **Respuesta 404 de WordPress**:
   ```
   📥 Status: 404 Not Found
   📥 Content-Type: text/html; charset=UTF-8
   <title>Página no encontrada - Riogas</title>
   ```

Esto significa que:
- La petición llega a un servidor WordPress de Riogas
- Ese servidor NO tiene la ruta `/gestion/login`
- Retorna una página 404 HTML con el template de Riogas

## 🎯 NO es problema de:

- ❌ Next.js (funciona correctamente)
- ❌ Nginx (no interviene en esto)
- ❌ PM2 (el proceso está bien)
- ❌ Seguridad (no está bloqueando)

## ✅ ES problema de:

- ✅ **URL del backend incorrecta en `.env.production`**

---

**SIGUIENTE PASO**: Verificar cuál es la URL correcta del backend GeneXus y actualizar `API_BASE_URL` en `.env.production`
