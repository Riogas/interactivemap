# 🚀 Solución Definitiva: Nginx con Configuración Explícita

## 📋 Archivo a Editar
`/etc/nginx/sites-available/track.glp.riogas.com.uy`

## 🔧 Pasos de Aplicación

### 1. Crear Backup
```bash
sudo cp /etc/nginx/sites-available/track.glp.riogas.com.uy /etc/nginx/sites-available/track.glp.riogas.com.uy.backup-$(date +%Y%m%d-%H%M%S)
```

### 2. Aplicar Nueva Configuración

Ejecuta este comando completo (copia TODO el bloque):

```bash
sudo tee /etc/nginx/sites-available/track.glp.riogas.com.uy > /dev/null << 'EOF'
server {
    listen 80;
    listen [::]:80;
    server_name track.glp.riogas.com.uy;

    location / {
        return 301 https://$host$request_uri;
    }
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name track.glp.riogas.com.uy;

    # SSL Configuration
    ssl_certificate      /etc/ssl/private/cert.pem;
    ssl_certificate_key  /etc/ssl/private/cert.key;
    ssl_session_timeout  5m;
    ssl_session_cache shared:SSL:50m;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers 'ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305:DHE-RSA-AES128-GCM-SHA256:DHE-RSA-AES256-GCM-SHA384';
    ssl_prefer_server_ciphers on;
    ssl_dhparam /etc/ssl/private/dhparams.pem;
    
    # Security Headers
    add_header X-Content-Type-Options nosniff;
    server_tokens off;
    proxy_set_header X-Forwarded-Proto https;

    # WAF BÁSICO: Bloquear command injection
    if ($args ~* "(;|\|\||\$\(|`|wget|curl|bash|sh|nc|python|perl|ruby|lua|java|base64|eval|exec|system|popen|proc_open|chattr|ufw|iptables)") {
        return 403;
    }
    
    if ($request_body ~* "(;|\|\||\$\(|`|wget|curl|bash|sh|nc|python|perl|ruby|lua|java|base64|eval|exec|system|popen|proc_open|chattr|ufw|iptables)") {
        return 403;
    }

    # Logs
    access_log /var/log/nginx/track.glp.riogas.com.uy.access.log;
    error_log /var/log/nginx/track.glp.riogas.com.uy.error.log;

    # Proxy a Next.js en Puerto 3002
    location / {
        proxy_pass http://127.0.0.1:3002;
        
        # WebSocket support
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        
        # Additional headers
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # Timeouts
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
        
        # Body size
        client_max_body_size 10M;
    }
}
EOF
```

### 3. Verificar Sintaxis
```bash
sudo nginx -t
```

**Salida esperada:**
```
nginx: the configuration file /etc/nginx/nginx.conf syntax is ok
nginx: configuration file /etc/nginx/nginx.conf test is successful
```

### 4. Recargar Nginx
```bash
sudo systemctl reload nginx
```

### 5. Verificar que Nginx Recargó Bien
```bash
sudo systemctl status nginx
```

**Salida esperada:**
```
● nginx.service - nginx - high performance web server
   Active: active (running) since ...
```

## ✅ Tests de Verificación

### Test 1: Localhost (puerto 3002 directo)
```bash
curl -X POST http://localhost:3002/api/proxy/gestion/login \
  -H "Content-Type: application/json" \
  -d '{"UserName":"test","Password":"test"}'
```

**Respuesta esperada:** JSON con error de credenciales (NO 404)

### Test 2: HTTPS a través de Nginx
```bash
curl -X POST https://track.glp.riogas.com.uy/api/proxy/gestion/login \
  -H "Content-Type: application/json" \
  -d '{"UserName":"test","Password":"test"}'
```

**Respuesta esperada:** JSON con error de credenciales (NO 404)

### Test 3: GPS (debe seguir funcionando)
```bash
curl -X POST https://track.glp.riogas.com.uy/api/import/gps \
  -H "Content-Type: application/json" \
  -d '{"token":"IcA.FwL.1710.!","movil":"693","latitud":-34.8,"longitud":-56.2}'
```

**Respuesta esperada:**
```json
{
  "success": true,
  "message": "1 registros GPS insertados correctamente"
}
```

## 📊 Monitoreo en Tiempo Real

Abre dos terminales en el servidor:

**Terminal 1 - Access Log:**
```bash
sudo tail -f /var/log/nginx/track.glp.riogas.com.uy.access.log
```

**Terminal 2 - PM2 Logs:**
```bash
pm2 logs track --lines 50
```

Luego ejecuta los tests desde tu máquina local y observa cómo fluyen las peticiones.

## 🎯 Cambios Realizados

**ANTES (con include):**
```nginx
set $nodeapp_port 3002;
include /etc/nginx/include/nodejs-proxy;  # ← Include externo
```

**DESPUÉS (explícito):**
```nginx
location / {
    proxy_pass http://127.0.0.1:3002;  # ← Directo, sin variables
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_cache_bypass $http_upgrade;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_connect_timeout 60s;
    proxy_send_timeout 60s;
    proxy_read_timeout 60s;
    client_max_body_size 10M;
}
```

## 🔍 Si Aún Falla

### Verificar que Next.js está corriendo
```bash
pm2 list
sudo ss -tulpn | grep :3002
```

### Verificar configuración cargada
```bash
sudo nginx -T | grep -A 50 "track.glp.riogas.com.uy"
```

### Reiniciar Nginx (hard restart)
```bash
sudo systemctl restart nginx
```

### Ver errores de Nginx
```bash
sudo tail -100 /var/log/nginx/error.log
```

## 📝 Rollback (si es necesario)

Si algo sale mal, revertir:

```bash
# Restaurar backup
sudo cp /etc/nginx/sites-available/track.glp.riogas.com.uy.backup-* /etc/nginx/sites-available/track.glp.riogas.com.uy

# Recargar
sudo nginx -t && sudo systemctl reload nginx
```

## ✨ Resultado Final Esperado

Después de estos cambios:

1. ✅ Login funciona: `POST /api/proxy/gestion/login` → 401/500 (no 404)
2. ✅ GPS funciona: `POST /api/import/gps` → 200 OK
3. ✅ Dashboard carga: `GET /dashboard` → 200 OK
4. ✅ Sync session funciona: `POST /api/auth/sync-session` → 200 OK
5. ✅ Todo Next.js responde correctamente a través de Nginx

---

**Fecha:** 2026-02-03  
**Estado:** Configuración lista para aplicar  
**Tiempo estimado:** 2 minutos
