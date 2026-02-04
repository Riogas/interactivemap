# 🔍 Diagnóstico: Routing Selectivo en Nginx

## 📋 Resumen del Problema

**Fecha**: 2026-02-03  
**Síntoma**: Login 404, pero GPS funciona  
**Causa**: Nginx enruta diferentes endpoints de `/api/` a servidores distintos

## 🧪 Resultados de los Tests

### ✅ Test GPS: FUNCIONANDO
```bash
curl -X POST http://localhost:3002/api/import/gps \
  -H "Content-Type: application/json" \
  -d '{"token":"IcA.FwL.1710.!","movil":"693","latitud":-34.8,"longitud":-56.2}'

# Respuesta (200 OK):
{
  "success": true,
  "message": "1 registros GPS insertados correctamente",
  "data": [{
    "id": 3810,
    "movil_id": "693",
    "latitud": -34.8,
    "longitud": -56.2,
    "created_at": "2026-02-03T19:54:14.859+00:00"
  }]
}
```

**Análisis**: 
- ✅ Next.js (puerto 3002) está funcionando correctamente
- ✅ Autenticación por token funcionó
- ✅ Base de datos insertó el registro
- ✅ Endpoint `/api/import/gps` está bien enrutado

### ❌ Test Login: FALLANDO
```bash
curl -X POST http://localhost:3002/api/proxy/gestion/login \
  -H "Content-Type: application/json" \
  -d '{"UserName":"test","Password":"test"}'

# Respuesta (404 Not Found):
<!doctype html>
<html lang="es">
<head>
  <title>Página no encontrada - Riogas</title>
  ...HTML de WordPress...
```

**Análisis**:
- ❌ Respuesta es HTML de WordPress (sitio principal de Riogas)
- ❌ Nginx NO está enviando la petición a Next.js (3002)
- ❌ Está sirviendo contenido de otro sitio (posiblemente puerto 3000 o carpeta estática)

## 🎯 Causa Raíz: Configuración Nginx con Routing Selectivo

Nginx tiene **múltiples bloques `location`** que enrutan diferentes paths a diferentes backends:

```nginx
# Configuración ACTUAL (hipotética basada en comportamiento):

server {
    server_name track.glp.riogas.com.uy;
    
    # Este bloque captura /api/import/* y va a Next.js correcto
    location /api/import/ {
        proxy_pass http://localhost:3002;  # ✅ CORRECTO
    }
    
    # Este bloque captura el resto de /api/* y va a lugar INCORRECTO
    location /api/ {
        proxy_pass http://localhost:3000;  # ❌ WordPress u otro Next.js
        # O peor: root /var/www/html;  # Carpeta estática
    }
    
    # O puede haber un bloque genérico
    location / {
        proxy_pass http://localhost:3000;  # ❌ INCORRECTO
    }
}
```

## 🔍 Por Qué GPS Funciona y Login No

### Orden de Evaluación de Nginx:
1. Nginx evalúa bloques `location` de **MÁS ESPECÍFICO a MENOS ESPECÍFICO**
2. `/api/import/gps` coincide primero con `location /api/import/` → Va a 3002 ✅
3. `/api/proxy/gestion/login` NO coincide con `/api/import/` → Cae en `location /api/` o `location /` → Va a 3000 ❌

### Tabla de Routing:

| URL Request | Bloque Nginx Coincidente | Destino | Resultado |
|-------------|-------------------------|---------|-----------|
| `/api/import/gps` | `location /api/import/` | localhost:3002 | ✅ 200 OK |
| `/api/proxy/gestion/login` | `location /api/` o `location /` | localhost:3000 | ❌ 404 (WordPress) |
| `/api/auth/sync-session` | `location /api/` o `location /` | localhost:3000 | ❌ 404 (WordPress) |

## 📝 Solución: Configuración Correcta de Nginx

### Opción 1: Un Solo Bloque para Toda la API (RECOMENDADO)

```nginx
server {
    listen 443 ssl http2;
    server_name track.glp.riogas.com.uy;

    ssl_certificate /etc/letsencrypt/live/track.glp.riogas.com.uy/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/track.glp.riogas.com.uy/privkey.pem;

    # TODA la API va a Next.js en puerto 3002
    location / {
        proxy_pass http://localhost:3002;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        
        # Timeouts importantes para Next.js
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }
}

# Redirección HTTP a HTTPS
server {
    listen 80;
    server_name track.glp.riogas.com.uy;
    return 301 https://$host$request_uri;
}
```

### Opción 2: Separar API de Archivos Estáticos (Si Aplica)

```nginx
server {
    listen 443 ssl http2;
    server_name track.glp.riogas.com.uy;

    ssl_certificate /etc/letsencrypt/live/track.glp.riogas.com.uy/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/track.glp.riogas.com.uy/privkey.pem;

    # Archivos estáticos de Next.js (_next/static/*)
    location /_next/static/ {
        proxy_pass http://localhost:3002;
        proxy_cache_valid 200 60m;
        add_header Cache-Control "public, immutable";
    }

    # TODA la aplicación (incluye /api/*)
    location / {
        proxy_pass http://localhost:3002;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

## 🚀 Pasos para Corregir

### 1. Ver Configuración Actual Completa
```bash
cat /etc/nginx/sites-available/track.glp.riogas.com.uy
```

### 2. Identificar Bloques Problemáticos
Buscar:
- ❌ `proxy_pass http://localhost:3000`
- ❌ `root /var/www/html` o similar
- ✅ `proxy_pass http://localhost:3002` (debe ser para TODO `/`)

### 3. Editar Configuración
```bash
sudo nano /etc/nginx/sites-available/track.glp.riogas.com.uy
```

**Cambios necesarios:**
- Eliminar o comentar bloques `location /api/` que apunten a puerto incorrecto
- Asegurar que `location /` apunte a `http://localhost:3002`
- Verificar que NO haya bloques `location /api/proxy/` con configuración diferente

### 4. Validar Sintaxis
```bash
sudo nginx -t
```

**Salida esperada:**
```
nginx: the configuration file /etc/nginx/nginx.conf syntax is ok
nginx: configuration file /etc/nginx/nginx.conf test is successful
```

### 5. Recargar Nginx
```bash
sudo systemctl reload nginx
```

### 6. Verificar Logs en Tiempo Real
```bash
# En una terminal:
sudo tail -f /var/log/nginx/track.glp.riogas.com.uy.access.log

# En otra terminal, hacer un test:
curl -X POST https://track.glp.riogas.com.uy/api/proxy/gestion/login \
  -H "Content-Type: application/json" \
  -d '{"UserName":"test","Password":"test"}'
```

### 7. Test Final desde Cliente
```bash
# Desde PowerShell (tu máquina local):
curl -X POST https://track.glp.riogas.com.uy/api/proxy/gestion/login `
  -H "Content-Type: application/json" `
  -d '{"UserName":"test","Password":"test"}'
```

**Respuesta esperada (401 o 500, NO 404):**
```json
{
  "success": false,
  "error": "Credenciales inválidas"
}
```

## 📊 Tabla de Troubleshooting

| Síntoma | Causa Posible | Solución |
|---------|--------------|----------|
| 404 con HTML de WordPress | `location /api/` apunta a puerto incorrecto | Cambiar `proxy_pass` a `localhost:3002` |
| 502 Bad Gateway | Next.js no está corriendo en 3002 | `pm2 restart track` |
| 504 Gateway Timeout | Timeouts muy cortos | Aumentar `proxy_read_timeout` |
| GPS funciona, Login no | Múltiples bloques `location` conflictivos | Unificar en un solo `location /` |
| Cambios no aplican | Configuración en caché | `sudo systemctl restart nginx` (no solo reload) |

## 🔑 Puntos Clave

1. **Next.js SÍ está funcionando** (confirmado por GPS endpoint)
2. **Puerto 3002 es el correcto** (confirmado por `pm2 show track`)
3. **Problema es 100% de nginx routing** (no de código Next.js)
4. **GPS funciona porque tiene su propio bloque `location`** más específico
5. **Login falla porque cae en bloque genérico** que apunta a lugar incorrecto

## 🎯 Siguiente Acción

Ejecuta en el servidor:
```bash
cat /etc/nginx/sites-available/track.glp.riogas.com.uy
```

Y comparte la salida completa para identificar exactamente qué bloques están causando el problema.
