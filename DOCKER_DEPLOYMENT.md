# 🐳 Guía de Despliegue con Docker

## Requisitos Previos

### En tu máquina local (Windows):
- Docker Desktop instalado
- Git
- Acceso SFTP al servidor Linux

### En el servidor Linux:
- Docker Engine instalado
- Docker Compose instalado
- Puerto 3000 disponible
- Acceso SSH/SFTP

---

## 📦 Paso 1: Preparar la Aplicación para Producción

### 1.1 Configurar Next.js para standalone output

Edita `next.config.ts` o `next.config.mjs` y agrega:

```typescript
const nextConfig = {
  output: 'standalone',
  // ... resto de configuración
};
```

### 1.2 Configurar variables de entorno

Edita `.env.production` con tus valores reales:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://lgniuhelyyizoursmsmi.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=tu-key-real
SUPABASE_SERVICE_ROLE_KEY=tu-service-role-key-real
```

---

## 🏗️ Paso 2: Build Local (Opcional - para probar)

### Construir imagen Docker localmente:

```powershell
# Construir imagen
docker build -t trackmovil-app:latest .

# Probar localmente
docker run -p 3000:3000 --env-file .env.production trackmovil-app:latest
```

Abre `http://localhost:3000` para verificar.

---

## 📤 Paso 3: Transferir al Servidor Linux

### Opción A: Transferir código fuente (RECOMENDADO)

```powershell
# Desde tu carpeta del proyecto
# Crear un archivo comprimido excluyendo node_modules y .next

# Con PowerShell:
Compress-Archive -Path * -DestinationPath trackmovil-deploy.zip -Force `
  -Exclude node_modules,.next,.git,*.log

# Transferir por SFTP
sftp usuario@servidor-linux
put trackmovil-deploy.zip /home/usuario/
exit
```

### Opción B: Transferir imagen Docker (más pesado)

```powershell
# Guardar imagen a archivo
docker save trackmovil-app:latest | gzip > trackmovil-app.tar.gz

# Transferir por SFTP
sftp usuario@servidor-linux
put trackmovil-app.tar.gz /home/usuario/
exit
```

---

## 🚀 Paso 4: Desplegar en el Servidor Linux

### SSH al servidor:

```bash
ssh usuario@servidor-linux
```

### Si transferiste código fuente (Opción A):

```bash
# Extraer archivos
cd /home/usuario
unzip trackmovil-deploy.zip -d trackmovil
cd trackmovil

# Crear archivo .env (copia de .env.production con valores reales)
nano .env

# Construir y levantar con Docker Compose
docker-compose up -d --build

# Ver logs
docker-compose logs -f trackmovil-app
```

### Si transferiste imagen Docker (Opción B):

```bash
# Cargar imagen
gunzip -c trackmovil-app.tar.gz | docker load

# Crear directorio para deploy
mkdir -p /home/usuario/trackmovil
cd /home/usuario/trackmovil

# Crear docker-compose.yml simple
cat > docker-compose.yml << 'EOF'
version: '3.8'
services:
  app:
    image: trackmovil-app:latest
    container_name: trackmovil-app
    restart: unless-stopped
    ports:
      - "3000:3000"
    env_file:
      - .env
EOF

# Crear archivo .env
nano .env
# (pegar variables de entorno)

# Levantar contenedor
docker-compose up -d

# Ver logs
docker-compose logs -f app
```

---

## 🔍 Paso 5: Verificar Despliegue

```bash
# Verificar que el contenedor está corriendo
docker ps

# Verificar logs
docker-compose logs -f

# Probar API
curl http://localhost:3000/api/all-positions

# Verificar health check
curl http://localhost:3000/api/doc
```

---

## 🌐 Paso 6: Configurar Nginx (Opcional - Recomendado)

### Instalar Nginx:

```bash
sudo apt update
sudo apt install nginx
```

### Configurar proxy reverso:

```bash
sudo nano /etc/nginx/sites-available/trackmovil
```

Contenido:

```nginx
server {
    listen 80;
    server_name tu-dominio.com;  # o IP del servidor

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Activar configuración:

```bash
sudo ln -s /etc/nginx/sites-available/trackmovil /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

---

## 🔄 Actualizar la Aplicación

### Desde tu máquina local:

```powershell
# 1. Hacer cambios y commit
git add .
git commit -m "Update: descripción de cambios"

# 2. Crear nuevo archivo comprimido
Compress-Archive -Path * -DestinationPath trackmovil-update.zip -Force `
  -Exclude node_modules,.next,.git,*.log

# 3. Transferir
sftp usuario@servidor-linux
put trackmovil-update.zip /home/usuario/
exit
```

### En el servidor:

```bash
cd /home/usuario/trackmovil

# Detener contenedores
docker-compose down

# Backup (opcional)
mv ../trackmovil ../trackmovil-backup-$(date +%Y%m%d)

# Extraer nueva versión
unzip /home/usuario/trackmovil-update.zip -d /home/usuario/trackmovil

# Reconstruir y levantar
docker-compose up -d --build

# Ver logs
docker-compose logs -f
```

---

## 🛠️ Comandos Útiles

### Gestión de contenedores:

```bash
# Ver contenedores corriendo
docker ps

# Ver todos los contenedores
docker ps -a

# Ver logs en tiempo real
docker-compose logs -f

# Reiniciar servicio
docker-compose restart trackmovil-app

# Detener servicios
docker-compose down

# Detener y eliminar volúmenes
docker-compose down -v

# Reconstruir sin caché
docker-compose build --no-cache
```

### Limpieza:

```bash
# Limpiar imágenes no usadas
docker image prune -a

# Limpiar contenedores detenidos
docker container prune

# Limpiar todo
docker system prune -a
```

### Debugging:

```bash
# Entrar al contenedor
docker exec -it trackmovil-app sh

# Ver variables de entorno
docker exec trackmovil-app env

# Ver uso de recursos
docker stats

# Inspeccionar contenedor
docker inspect trackmovil-app
```

---

## 🔐 Seguridad

### 1. Firewall:

```bash
# Permitir solo puerto 80 (HTTP) y 443 (HTTPS)
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

### 2. HTTPS con Certbot (Let's Encrypt):

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d tu-dominio.com
```

### 3. Limitar acceso a API:

```nginx
# En configuración de Nginx
location /api/ {
    # Limitar IPs permitidas
    allow 192.168.1.0/24;
    deny all;
    
    proxy_pass http://localhost:3000;
}
```

---

## 📊 Monitoreo

### Logs:

```bash
# Logs de aplicación
docker-compose logs -f --tail=100 trackmovil-app

# Logs de Nginx
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log
```

### Healthcheck:

```bash
# Verificar salud del contenedor
docker inspect --format='{{.State.Health.Status}}' trackmovil-app
```

---

## ❌ Troubleshooting

### Contenedor no inicia:

```bash
# Ver logs completos
docker-compose logs trackmovil-app

# Verificar variables de entorno
docker exec trackmovil-app env

# Verificar archivo .env
cat .env
```

### Error de permisos:

```bash
# Cambiar ownership
sudo chown -R $USER:$USER /home/usuario/trackmovil
```

### Puerto 3000 en uso:

```bash
# Ver qué proceso usa el puerto
sudo lsof -i :3000

# Matar proceso
sudo kill -9 <PID>
```

### Problemas de DNS:

```bash
# Verificar conectividad a Supabase
curl https://lgniuhelyyizoursmsmi.supabase.co
```

---

## 📋 Checklist Pre-Deploy

- [ ] Variables de entorno configuradas en `.env.production`
- [ ] `next.config` tiene `output: 'standalone'`
- [ ] Supabase accesible desde servidor Linux
- [ ] Docker y Docker Compose instalados en servidor
- [ ] Puerto 3000 disponible o Nginx configurado
- [ ] Firewall configurado
- [ ] Backup de versión anterior (si existe)

---

## 🎯 Resultado Final

Una vez completado, tu aplicación estará:

✅ Corriendo en Docker container
✅ Con reinicio automático (`restart: unless-stopped`)
✅ Accesible en `http://servidor-linux:3000`
✅ O en `http://tu-dominio.com` (con Nginx)
✅ Con logs centralizados
✅ Fácil de actualizar y escalar

---

## 📞 Soporte

Si tienes problemas:

1. Revisa los logs: `docker-compose logs -f`
2. Verifica variables de entorno: `docker exec trackmovil-app env`
3. Prueba conectividad a Supabase: `curl https://tu-proyecto.supabase.co`
4. Verifica firewall: `sudo ufw status`
