# 🐳 Deployment con Docker desde Cero - Guía Completa

## 📋 Prerequisitos en el Servidor Linux

### 1. Instalar Docker

```bash
# Actualizar el sistema
sudo apt update
sudo apt upgrade -y

# Instalar dependencias
sudo apt install -y \
    apt-transport-https \
    ca-certificates \
    curl \
    gnupg \
    lsb-release

# Agregar la clave GPG oficial de Docker
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg

# Configurar el repositorio de Docker
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu \
  $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# Instalar Docker Engine
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

# Verificar instalación
docker --version
```

### 2. Configurar Docker (sin sudo)

```bash
# Agregar tu usuario al grupo docker
sudo usermod -aG docker $USER

# Aplicar los cambios de grupo (o cerrar sesión y volver a entrar)
newgrp docker

# Verificar que funciona sin sudo
docker ps
```

### 3. Habilitar Docker al inicio

```bash
sudo systemctl enable docker
sudo systemctl start docker
sudo systemctl status docker
```

---

## 📥 Paso 1: Clonar el Repositorio

```bash
# Ir al directorio home
cd ~

# Clonar el repositorio
git clone https://github.com/Riogas/interactivemap.git trackmovil

# Entrar al directorio
cd trackmovil

# Verificar que tienes los archivos
ls -la
```

---

## ⚙️ Paso 2: Configurar Variables de Entorno

### Crear `.env.production`

```bash
# Copiar desde el template
cp .env.production.template .env.production

# Editar el archivo
nano .env.production
```

### Configuración requerida en `.env.production`:

```bash
# Modo de operación
DB_MODE=supabase

# API Externa - URL de Login
# Ajusta según dónde esté tu API:
# Opción 1: Si la API está en localhost:3000
EXTERNAL_API_URL=http://localhost:3000

# Opción 2: Si la API está en otro servidor
# EXTERNAL_API_URL=http://192.168.7.14:3000

# Opción 3: Si es una API externa
# EXTERNAL_API_URL=https://www.riogas.com.uy

NEXT_PUBLIC_EXTERNAL_API_URL=http://localhost:3000

# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=https://lgniuhelyyizoursmsmi.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxnbml1aGVseXlpem91cnNtc21pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTc0NDQ5MTUsImV4cCI6MjA3MzAyMDkxNX0.96kkOHRA1EgOYqu6bm0-6nr_a3qpAHUoYA9Z77qUCQI
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxnbml1aGVseXlpem91cnNtc21pIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NzQ0NDkxNSwiZXhwIjoyMDczMDIwOTE1fQ.qR09lu4wr1j-tecWLdH0IZbEj2HUpEt8xHTtOvE_5BE

# Node
NODE_ENV=production
PORT=3000
HOSTNAME=0.0.0.0

# Next.js
NEXT_TELEMETRY_DISABLED=1
```

**Guardar:** `Ctrl+O`, `Enter`  
**Salir:** `Ctrl+X`

---

## 🔨 Paso 3: Construir la Imagen Docker

```bash
# Asegúrate de estar en el directorio del proyecto
cd ~/trackmovil

# Construir la imagen (esto tomará varios minutos la primera vez)
docker build -t trackmovil:latest .

# Verificar que la imagen se creó
docker images | grep trackmovil
```

**Salida esperada:**
```
trackmovil    latest    abc123def456    2 minutes ago    100MB
```

---

## 🚀 Paso 4: Ejecutar el Contenedor

### Opción A: Ejecución básica (puerto 3001)

```bash
docker run -d \
  --name trackmovil \
  -p 3001:3000 \
  --env-file .env.production \
  --restart unless-stopped \
  trackmovil:latest
```

### Opción B: Con red del host (recomendado si la API está en localhost)

```bash
docker run -d \
  --name trackmovil \
  --network host \
  --env-file .env.production \
  --restart unless-stopped \
  trackmovil:latest
```

⚠️ **Nota:** Con `--network host`, el puerto 3001 no se usa, la app corre en puerto 3000.

### Opción C: Con volúmenes para logs (avanzado)

```bash
docker run -d \
  --name trackmovil \
  -p 3001:3000 \
  --env-file .env.production \
  -v ~/trackmovil-logs:/app/logs \
  --restart unless-stopped \
  trackmovil:latest
```

---

## ✅ Paso 5: Verificar que Funciona

### Verificar que el contenedor está corriendo

```bash
docker ps | grep trackmovil
```

**Salida esperada:**
```
abc123def456   trackmovil:latest   "docker-entrypoint.s…"   30 seconds ago   Up 28 seconds   0.0.0.0:3001->3000/tcp   trackmovil
```

### Ver los logs

```bash
# Ver logs en tiempo real
docker logs -f trackmovil

# Ver últimas 50 líneas
docker logs --tail 50 trackmovil

# Buscar errores
docker logs trackmovil 2>&1 | grep -i error
```

**Logs esperados:**
```
▲ Next.js 15.5.5
- Local:        http://localhost:3000
- Network:      http://0.0.0.0:3000

✓ Starting...
✓ Ready in 2.5s
```

### Probar el acceso

```bash
# Desde el servidor
curl http://localhost:3001

# Desde tu máquina Windows (en el navegador)
# http://192.168.7.14:3001
```

---

## 🔄 Paso 6: Scripts de Gestión (Opcional pero Recomendado)

### Dar permisos de ejecución a los scripts

```bash
cd ~/trackmovil
chmod +x scripts/*.sh
```

### Scripts disponibles:

#### **Para updates:**
```bash
./scripts/update-trackmovil.sh
```

Esto hace automáticamente:
1. `git pull origin main`
2. `docker build -t trackmovil:latest .`
3. `docker stop trackmovil && docker rm trackmovil`
4. `docker run ...` (reiniciar contenedor)

#### **Para actualizar solo el .env:**
```bash
./scripts/update-env-api.sh
```

---

## 🛠️ Comandos Útiles de Docker

### Gestión del contenedor

```bash
# Ver estado
docker ps

# Detener
docker stop trackmovil

# Iniciar
docker start trackmovil

# Reiniciar
docker restart trackmovil

# Eliminar
docker rm trackmovil

# Forzar eliminación (si está corriendo)
docker rm -f trackmovil
```

### Logs y debugging

```bash
# Ver logs
docker logs trackmovil

# Logs en tiempo real
docker logs -f trackmovil

# Últimas 100 líneas
docker logs --tail 100 trackmovil

# Logs desde hace 10 minutos
docker logs --since 10m trackmovil

# Buscar errores
docker logs trackmovil 2>&1 | grep -E "Error|error|ERROR"
```

### Entrar al contenedor

```bash
# Abrir shell dentro del contenedor
docker exec -it trackmovil sh

# Ver variables de entorno
docker exec trackmovil printenv

# Ver archivos
docker exec trackmovil ls -la

# Ver proceso Node.js
docker exec trackmovil ps aux
```

### Gestión de imágenes

```bash
# Ver imágenes
docker images

# Eliminar imagen vieja
docker rmi trackmovil:old

# Limpiar imágenes sin usar
docker image prune -a

# Ver espacio usado
docker system df
```

---

## 🔧 Troubleshooting

### Problema: El contenedor no inicia

```bash
# Ver logs detallados
docker logs trackmovil

# Ver estado del contenedor
docker ps -a | grep trackmovil

# Verificar el Dockerfile
cat Dockerfile

# Reconstruir sin cache
docker build --no-cache -t trackmovil:latest .
```

### Problema: No puedo acceder a la aplicación

```bash
# Verificar que el puerto está mapeado correctamente
docker port trackmovil

# Verificar que el contenedor tiene la IP correcta
docker inspect trackmovil | grep IPAddress

# Verificar firewall
sudo ufw status
sudo ufw allow 3001/tcp
```

### Problema: Login no funciona

```bash
# Ver variables de entorno
docker exec trackmovil printenv | grep API

# Verificar conectividad a la API
docker exec trackmovil wget -O- --timeout=5 http://localhost:3000

# Ver logs del proxy
docker logs trackmovil 2>&1 | grep -i proxy
```

### Problema: Espacio en disco lleno

```bash
# Ver espacio usado por Docker
docker system df

# Limpiar contenedores detenidos
docker container prune

# Limpiar imágenes sin usar
docker image prune -a

# Limpiar todo (cuidado!)
docker system prune -a
```

---

## 📊 Monitoreo

### Ver uso de recursos

```bash
# CPU y memoria en tiempo real
docker stats trackmovil

# Solo una lectura
docker stats --no-stream trackmovil
```

### Healthcheck

```bash
# Ver estado de salud
docker inspect trackmovil | grep -A 10 Health

# Ejecutar healthcheck manual
docker exec trackmovil wget -O- --quiet http://localhost:3000
```

---

## 🔄 Workflow Completo de Update

### Cuando hagas cambios en el código (Windows):

```powershell
# En tu máquina Windows
git add .
git commit -m "feat: nueva funcionalidad"
git push origin main
```

### En el servidor Linux:

```bash
ssh riogas@node
cd ~/trackmovil

# Opción 1: Script automático (recomendado)
./scripts/update-trackmovil.sh

# Opción 2: Manual
git pull origin main
docker build -t trackmovil:latest .
docker stop trackmovil
docker rm trackmovil
docker run -d --name trackmovil -p 3001:3000 --env-file .env.production --restart unless-stopped trackmovil:latest
docker logs -f trackmovil
```

---

## 🎯 Checklist de Instalación

- [ ] Docker instalado y funcionando
- [ ] Usuario agregado al grupo docker (sin sudo)
- [ ] Repositorio clonado en `~/trackmovil`
- [ ] `.env.production` creado y configurado
- [ ] Imagen Docker construida exitosamente
- [ ] Contenedor ejecutándose (`docker ps`)
- [ ] Logs muestran "Ready" sin errores
- [ ] Aplicación accesible desde el navegador
- [ ] Scripts con permisos de ejecución
- [ ] Login funciona correctamente

---

## 📱 URLs de Acceso

Según tu configuración de red:

```
# Desde el servidor mismo
http://localhost:3001

# Desde tu red local
http://192.168.7.14:3001

# Con dominio (requiere Nginx)
http://trackmovil.riogas.com.uy
```

---

## 🚨 Backup y Rollback

### Crear backup antes de actualizar

```bash
# Crear tag de la imagen actual
docker tag trackmovil:latest trackmovil:backup-$(date +%Y%m%d)

# Ver backups
docker images | grep trackmovil
```

### Rollback a versión anterior

```bash
# Detener contenedor actual
docker stop trackmovil
docker rm trackmovil

# Volver a versión anterior
docker run -d --name trackmovil -p 3001:3000 --env-file .env.production --restart unless-stopped trackmovil:backup-20251219
```

---

## ✅ Próximos Pasos Opcionales

1. **Configurar Nginx como proxy inverso** (para HTTPS)
2. **Configurar SSL con Let's Encrypt**
3. **Setup de Docker Compose** (para múltiples servicios)
4. **Configurar logging externo** (ELK Stack, Loki, etc.)
5. **Setup de CI/CD** (GitHub Actions para deploy automático)

¿Necesitas ayuda con alguno de estos? 🚀
