# 🔧 Fix 404 en Producción - Problema con Nginx

## 🎯 Síntoma
- ✅ Local funciona perfecto (http://localhost:3000)
- ❌ Producción da 404 en `/api/proxy/gestion/login`
- 🔍 Headers muestran: `server: nginx`

## 🔍 Diagnóstico
El problema NO es Next.js, es **Nginx** que no está pasando correctamente las peticiones a Next.js.

---

## ✅ Solución Paso a Paso

### Paso 1: Conectar al servidor

```bash
ssh tu-usuario@track.glp.riogas.com.uy
```

### Paso 2: Ver configuración actual de Nginx

```bash
# Ver qué archivos de configuración existen
ls -la /etc/nginx/sites-available/
ls -la /etc/nginx/sites-enabled/

# Ver el contenido del archivo de configuración
sudo cat /etc/nginx/sites-available/track.glp.riogas.com.uy
# O si está en conf.d:
sudo cat /etc/nginx/conf.d/track.glp.riogas.com.uy.conf
```

### Paso 3: Verificar que Next.js está corriendo

```bash
# Ver procesos de PM2
pm2 list

# Ver logs de Next.js
pm2 logs trackmovil --lines 20

# Verificar que Next.js responde en localhost:3000
curl http://localhost:3000/api/empresas
```

**Esperado**: Si Next.js está corriendo, este curl debería devolver datos (aunque sea 401).
**Si devuelve conexión rechazada**: Next.js no está corriendo.

### Paso 4: Verificar puerto de Next.js

```bash
# Ver qué está escuchando en el puerto 3000
sudo netstat -tulpn | grep :3000
# O con ss:
sudo ss -tulpn | grep :3000
```

**Esperado**: Deberías ver algo como:
```
tcp   0   0 :::3000   :::*   LISTEN   12345/node
```

### Paso 5: Test directo a Next.js (bypass nginx)

```bash
# Desde el servidor, hacer request directo a Next.js
curl -X POST http://localhost:3000/api/proxy/gestion/login \
  -H "Content-Type: application/json" \
  -d '{"UserName":"test","Password":"test"}'
```

**¿Qué esperar?**
- ✅ Si devuelve **500** o respuesta del backend → Next.js funciona, problema es Nginx
- ❌ Si devuelve **404** → Next.js no compiló la ruta correctamente
- ❌ Si da **connection refused** → Next.js no está corriendo

### Paso 6: Si Next.js responde bien → Editar configuración de Nginx

```bash
# Editar archivo de configuración
sudo nano /etc/nginx/sites-available/track.glp.riogas.com.uy

# O con vim:
sudo vim /etc/nginx/sites-available/track.glp.riogas.com.uy
```

**Busca la sección `location /api/`** y asegúrate de que tenga:

```nginx
location /api/ {
    proxy_pass http://localhost:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_cache_bypass $http_upgrade;
    
    # No cachear APIs
    add_header Cache-Control "no-cache, no-store, must-revalidate";
    proxy_no_cache 1;
    proxy_cache_bypass 1;
}
```

**⚠️ IMPORTANTE**: No debe haber ninguna regla que bloquee `/api/proxy/`

### Paso 7: Verificar sintaxis de Nginx

```bash
sudo nginx -t
```

**Esperado**:
```
nginx: the configuration file /etc/nginx/nginx.conf syntax is ok
nginx: configuration file /etc/nginx/nginx.conf test is successful
```

### Paso 8: Recargar Nginx

```bash
sudo systemctl reload nginx
# O:
sudo service nginx reload
```

### Paso 9: Verificar logs de Nginx

```bash
# Ver últimas peticiones
sudo tail -f /var/log/nginx/track.glp.riogas.com.uy.access.log

# Ver errores
sudo tail -f /var/log/nginx/track.glp.riogas.com.uy.error.log
```

### Paso 10: Test desde tu navegador

Refresca la página de login y mira los logs en tiempo real:

```bash
# En una terminal del servidor:
sudo tail -f /var/log/nginx/track.glp.riogas.com.uy.access.log
```

---

## 🔍 Posibles Problemas Comunes

### Problema 1: Nginx cachea el 404

**Solución**: Limpiar cache de Nginx

```bash
sudo rm -rf /var/cache/nginx/*
sudo systemctl reload nginx
```

### Problema 2: Firewall bloqueando

```bash
# Verificar firewall (UFW)
sudo ufw status

# Verificar iptables
sudo iptables -L -n
```

### Problema 3: Next.js corriendo en puerto diferente

```bash
# Ver qué puerto usa PM2
pm2 info trackmovil

# Ver variables de entorno
pm2 env 0
```

### Problema 4: Archivo de configuración equivocado

```bash
# Ver qué archivo está usando nginx
sudo nginx -T | grep -A 20 "server_name track.glp.riogas.com.uy"
```

---

## 🚨 Solución Rápida (Si tienes prisa)

```bash
# 1. Conectar
ssh tu-usuario@track.glp.riogas.com.uy

# 2. Test directo a Next.js
curl -v http://localhost:3000/api/proxy/gestion/login

# 3. Si responde OK → Problema es Nginx
# Editar config:
sudo nano /etc/nginx/sites-available/track.glp.riogas.com.uy

# 4. Asegurar que tenga:
#    location /api/ {
#        proxy_pass http://localhost:3000;
#        ...
#    }

# 5. Test y reload
sudo nginx -t
sudo systemctl reload nginx

# 6. Ver logs
sudo tail -f /var/log/nginx/track.glp.riogas.com.uy.error.log
```

---

## 📊 Tabla de Diagnóstico

| Test | Comando | Resultado Esperado | Qué Significa |
|------|---------|-------------------|---------------|
| Next.js corre | `pm2 list` | `trackmovil` → `online` | ✅ App corriendo |
| Puerto ocupado | `sudo ss -tulpn \| grep :3000` | Muestra proceso Node | ✅ App escuchando |
| Test directo | `curl localhost:3000/api/empresas` | Respuesta (no 404) | ✅ Next.js funciona |
| Test nginx | `curl https://track.glp.riogas.com.uy/api/empresas` | Respuesta (no 404) | ✅ Nginx configurado |
| Logs nginx | `sudo tail /var/log/nginx/*.error.log` | Sin errores 404 | ✅ Todo OK |

---

## ✅ Verificación Final

Después de los cambios, deberías ver:

```bash
# En el navegador:
POST https://track.glp.riogas.com.uy/api/proxy/gestion/login
Status: 200 OK (o 500, pero NO 404)

# En los logs de nginx:
"POST /api/proxy/gestion/login HTTP/2.0" 200 ...
```

---

## 💡 Tip: Archivo de Configuración Ejemplo

He creado un archivo `nginx-config-example.conf` en tu proyecto con una configuración completa y probada.

Puedes copiarla al servidor:

```bash
# Desde tu máquina local:
scp nginx-config-example.conf tu-usuario@track.glp.riogas.com.uy:/tmp/

# En el servidor:
sudo cp /tmp/nginx-config-example.conf /etc/nginx/sites-available/track.glp.riogas.com.uy
sudo nginx -t
sudo systemctl reload nginx
```
