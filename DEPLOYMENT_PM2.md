# 🚀 Deployment con PM2 en Linux

## 📋 Prerequisitos en el Servidor Linux

```bash
# 1. Instalar Node.js 20 (versión LTS)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# 2. Instalar pnpm
npm install -g pnpm

# 3. Instalar PM2
npm install -g pm2

# 4. Verificar instalaciones
node --version    # Debe ser v20.x.x
pnpm --version
pm2 --version
```

---

## 🔧 Configuración del Proyecto

### 1. **Crear archivo de configuración PM2**

Crea `ecosystem.config.js` en la raíz del proyecto:

```javascript
module.exports = {
  apps: [
    {
      name: 'trackmovil',
      script: 'node_modules/next/dist/bin/next',
      args: 'start',
      cwd: '/home/riogas/trackmovil',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: 3001,
        HOSTNAME: '0.0.0.0'
      },
      env_file: '.env.production',
      error_file: 'logs/pm2-error.log',
      out_file: 'logs/pm2-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
    }
  ]
};
```

### 2. **Script de deployment**

Crea `scripts/deploy-pm2.sh`:

```bash
#!/bin/bash

###############################################################################
# Script: Deploy con PM2
# Propósito: Deployment y actualización de la aplicación usando PM2
###############################################################################

set -e

# Colores
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  TracMovil - Deployment con PM2${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo

# Ir al directorio del proyecto
cd ~/trackmovil

# 1. Git pull
echo -e "${BLUE}📥 Obteniendo últimos cambios...${NC}"
git pull origin main

# 2. Instalar dependencias
echo -e "${BLUE}📦 Instalando dependencias...${NC}"
pnpm install --frozen-lockfile

# 3. Build del proyecto
echo -e "${BLUE}🔨 Building proyecto...${NC}"
pnpm build

# 4. Verificar si PM2 ya está corriendo
if pm2 describe trackmovil > /dev/null 2>&1; then
    echo -e "${BLUE}🔄 Reiniciando aplicación...${NC}"
    pm2 reload trackmovil --update-env
else
    echo -e "${BLUE}🚀 Iniciando aplicación por primera vez...${NC}"
    pm2 start ecosystem.config.js
fi

# 5. Guardar configuración de PM2
pm2 save

# 6. Mostrar status
echo
echo -e "${GREEN}✓ Deployment completado!${NC}"
echo
pm2 status
echo
echo -e "${BLUE}📊 Logs disponibles:${NC}"
echo -e "   Ver logs: ${YELLOW}pm2 logs trackmovil${NC}"
echo -e "   Monitorear: ${YELLOW}pm2 monit${NC}"
echo
echo -e "${BLUE}🌐 Aplicación disponible en: http://192.168.7.14:3001${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
```

### 3. **Script de instalación inicial**

Crea `scripts/install-pm2.sh`:

```bash
#!/bin/bash

###############################################################################
# Script: Instalación inicial con PM2
###############################################################################

set -e

GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  TracMovil - Instalación con PM2${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"

# 1. Clonar repositorio (si no existe)
if [ ! -d "~/trackmovil" ]; then
    echo -e "${BLUE}📥 Clonando repositorio...${NC}"
    cd ~
    git clone https://github.com/Riogas/interactivemap.git trackmovil
fi

cd ~/trackmovil

# 2. Crear .env.production si no existe
if [ ! -f ".env.production" ]; then
    echo -e "${BLUE}📝 Creando .env.production...${NC}"
    cp .env.production.template .env.production
    echo
    echo -e "${YELLOW}⚠️  IMPORTANTE: Edita .env.production con tus credenciales${NC}"
    echo -e "   nano .env.production"
    echo
    read -p "Presiona Enter cuando hayas editado .env.production..."
fi

# 3. Instalar dependencias
echo -e "${BLUE}📦 Instalando dependencias...${NC}"
pnpm install

# 4. Build
echo -e "${BLUE}🔨 Building proyecto...${NC}"
pnpm build

# 5. Crear directorio de logs
mkdir -p logs

# 6. Iniciar con PM2
echo -e "${BLUE}🚀 Iniciando con PM2...${NC}"
pm2 start ecosystem.config.js

# 7. Configurar PM2 para inicio automático
echo -e "${BLUE}⚙️  Configurando inicio automático...${NC}"
pm2 startup
echo -e "${YELLOW}Ejecuta el comando que PM2 te muestra arriba (con sudo)${NC}"
read -p "Presiona Enter cuando hayas ejecutado el comando..."

pm2 save

echo
echo -e "${GREEN}✓ Instalación completada!${NC}"
echo
pm2 status
echo
echo -e "${BLUE}🌐 Aplicación disponible en: http://192.168.7.14:3001${NC}"
```

---

## 📚 Comandos Útiles de PM2

```bash
# Ver estado de aplicaciones
pm2 status

# Ver logs en tiempo real
pm2 logs trackmovil

# Ver logs con filtro
pm2 logs trackmovil --lines 100

# Monitorear recursos (CPU, memoria)
pm2 monit

# Reiniciar aplicación
pm2 restart trackmovil

# Detener aplicación
pm2 stop trackmovil

# Eliminar aplicación de PM2
pm2 delete trackmovil

# Ver información detallada
pm2 show trackmovil

# Limpiar logs
pm2 flush
```

---

## 🔄 Workflow de Actualización

### **Desarrollo → Producción:**

```bash
# En Windows (tu máquina)
git add .
git commit -m "feat: nueva funcionalidad"
git push origin main

# En Linux (servidor)
ssh riogas@node
cd ~/trackmovil
./scripts/deploy-pm2.sh
```

**Listo!** PM2 hace reload sin downtime.

---

## 🆚 Comparación: Docker vs PM2

| Característica | Docker | PM2 |
|---------------|--------|-----|
| **Setup inicial** | Más complejo | Más simple |
| **Uso de recursos** | Mayor (~300MB) | Menor (~150MB) |
| **Velocidad de inicio** | Más lento (build) | Más rápido |
| **Aislamiento** | Total | Compartido |
| **Hot reload** | No | Sí |
| **Logs** | `docker logs` | `pm2 logs` |
| **Monitoring** | Requiere herramientas extras | Built-in |
| **Updates** | Rebuild completo | Reload rápido |
| **Portabilidad** | Muy alta | Media |

---

## 🎯 Mi Recomendación

### **Usa PM2 si:**
- ✅ Quieres updates más rápidos
- ✅ Prefieres herramientas nativas de Node.js
- ✅ Necesitas monitoring integrado
- ✅ Quieres menos uso de recursos

### **Mantén Docker si:**
- ✅ Necesitas múltiples ambientes aislados
- ✅ Vas a escalar a Kubernetes
- ✅ Quieres garantía de portabilidad
- ✅ Prefieres infraestructura como código

---

## 🔧 Migración de Docker a PM2

Si decides cambiar de Docker a PM2:

```bash
# 1. Detener y eliminar contenedor Docker
docker stop trackmovil
docker rm trackmovil

# 2. Ejecutar instalación de PM2
cd ~/trackmovil
chmod +x scripts/install-pm2.sh
./scripts/install-pm2.sh

# 3. Configurar .env.production
nano .env.production

# Cambiar:
EXTERNAL_API_URL=http://localhost:3000
NEXT_PUBLIC_EXTERNAL_API_URL=http://localhost:3000

# 4. Iniciar con PM2
pm2 start ecosystem.config.js
pm2 save
```

---

## 📊 Configuración de Nginx (Opcional pero recomendado)

Para añadir HTTPS y mejor gestión de tráfico:

```nginx
# /etc/nginx/sites-available/trackmovil

upstream trackmovil_upstream {
    server localhost:3001;
    keepalive 64;
}

server {
    listen 80;
    server_name trackmovil.riogas.com.uy;

    location / {
        proxy_pass http://trackmovil_upstream;
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

```bash
# Habilitar sitio
sudo ln -s /etc/nginx/sites-available/trackmovil /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx

# Añadir SSL con Let's Encrypt
sudo certbot --nginx -d trackmovil.riogas.com.uy
```

---

**¿Qué opción prefieres? Docker actual optimizado o migrar a PM2?**
