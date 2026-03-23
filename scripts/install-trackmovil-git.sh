#!/bin/bash
# Script de instalación inicial para TracMovil con Git
# Ejecutar UNA SOLA VEZ en el servidor Linux

set -e

# Colores
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RED='\033[0;31m'
NC='\033[0m'

REPO_URL="https://github.com/Riogas/interactivemap.git"
PROJECT_DIR="$HOME/trackmovil"
CONTAINER_NAME="trackmovil"

echo -e "${CYAN}🚀 Instalación inicial de TracMovil desde Git${NC}"

# 1. Verificar que Docker está instalado
if ! command -v docker &> /dev/null; then
    echo -e "${RED}❌ Docker no está instalado${NC}"
    exit 1
fi

# 2. Clonar repositorio
if [ -d "$PROJECT_DIR" ]; then
    echo -e "${YELLOW}⚠ El directorio $PROJECT_DIR ya existe${NC}"
    read -p "¿Eliminar y volver a clonar? (s/n): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[SsYy]$ ]]; then
        rm -rf "$PROJECT_DIR"
    else
        echo -e "${YELLOW}Usando directorio existente${NC}"
        cd "$PROJECT_DIR"
        git pull origin main
    fi
fi

if [ ! -d "$PROJECT_DIR" ]; then
    echo -e "${YELLOW}📦 Clonando repositorio...${NC}"
    git clone "$REPO_URL" "$PROJECT_DIR"
    echo -e "${GREEN}✓ Repositorio clonado${NC}"
fi

cd "$PROJECT_DIR"

# 3. Crear archivo .env.production
if [ ! -f ".env.production" ]; then
    echo -e "${YELLOW}📝 Creando archivo .env.production...${NC}"
    cat > .env.production << 'EOF'
# Supabase Configuration (Self-Hosted)
NEXT_PUBLIC_SUPABASE_URL=https://supabase.glp.riogas.com.uy
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzcyNzMxNzIxLCJleHAiOjE5MzA0MTE3MjF9.ICWtp1n4l4NwGMYC4C3Fca2g8-ljAztQYmnToBcIavw
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaXNzIjoic3VwYWJhc2UiLCJpYXQiOjE3NzI3MzE3MjEsImV4cCI6MTkzMDQxMTcyMX0.Hun0belX86NLjc4eLT0HWjq_FlA_zL7DtYaH4f1-DZY

# Database Configuration (Legacy)
DB_HOST=192.168.1.8
DB_USER=qsecofr
DB_PASSWORD=wwm868
DB_SCHEMA=GXICAGEO
DB_MODE=supabase

# API Externa
EXTERNAL_API_URL=https://sgm.glp.riogas.com.uy
NEXT_PUBLIC_EXTERNAL_API_URL=https://sgm.glp.riogas.com.uy

# Security
INTERNAL_API_KEY=96c596ab9a239195c517000e92101c89fed22da7f13843440357493b0d911cd3
GPS_TRACKING_TOKEN=IcA.FwL.1710.!
ENABLE_SECURITY_CHECKS=true

# Node
NODE_ENV=production
PORT=3000
HOSTNAME=0.0.0.0
NEXT_TELEMETRY_DISABLED=1
# NODE_TLS_REJECT_UNAUTHORIZED=0  # REMOVIDO POR SEGURIDAD — habilitar solo si el cert es auto-firmado
EOF
    echo -e "${GREEN}✓ Archivo .env.production creado${NC}"
else
    echo -e "${GREEN}✓ .env.production ya existe${NC}"
fi

# 4. Build imagen Docker
echo -e "${YELLOW}🏗️ Construyendo imagen Docker (puede tomar 3-5 minutos)...${NC}"
docker build -t trackmovil:latest .
echo -e "${GREEN}✓ Imagen construida${NC}"

# 5. Detener contenedor anterior si existe
if docker ps -a | grep -q "$CONTAINER_NAME"; then
    echo -e "${YELLOW}🛑 Deteniendo contenedor anterior...${NC}"
    docker stop "$CONTAINER_NAME" 2>/dev/null || true
    docker rm "$CONTAINER_NAME" 2>/dev/null || true
fi

# 6. Iniciar contenedor
echo -e "${YELLOW}🚀 Iniciando contenedor...${NC}"
docker run -d \
  --name "$CONTAINER_NAME" \
  --restart unless-stopped \
  -p 3001:3000 \
  --env-file "$PROJECT_DIR/.env.production" \
  trackmovil:latest

# 7. Esperar y verificar
echo -e "${CYAN}⏳ Esperando a que la aplicación inicie...${NC}"
sleep 5

if docker ps | grep -q "$CONTAINER_NAME"; then
    echo -e "${GREEN}✅ ¡Instalación completada exitosamente!${NC}"
    echo ""
    echo -e "${CYAN}📊 Estado del contenedor:${NC}"
    docker ps --filter name="$CONTAINER_NAME" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
    echo ""
    echo -e "${CYAN}📂 Código fuente en:${NC}"
    echo -e "   ${GREEN}$PROJECT_DIR${NC}"
    echo ""
    LOCAL_IP=$(hostname -I | awk '{print $1}')
    echo -e "${CYAN}🌐 Acceso:${NC}"
    echo -e "   Local: ${GREEN}http://localhost:3001${NC}"
    echo -e "   Red:   ${GREEN}http://${LOCAL_IP}:3001${NC}"
    echo ""
    echo -e "${CYAN}📋 Comandos útiles:${NC}"
    echo "   Ver logs:       docker logs -f $CONTAINER_NAME"
    echo "   Actualizar app: cd $PROJECT_DIR && ./update-trackmovil.sh"
    echo "   Reiniciar:      docker restart $CONTAINER_NAME"
    echo "   Detener:        docker stop $CONTAINER_NAME"
else
    echo -e "${RED}❌ Error: El contenedor no está corriendo${NC}"
    echo -e "${YELLOW}Ver logs: docker logs $CONTAINER_NAME${NC}"
    exit 1
fi

# 8. Crear script de actualización
if [ ! -f "$PROJECT_DIR/update-trackmovil.sh" ]; then
    echo -e "${YELLOW}📝 Descargando script de actualización...${NC}"
    echo "Necesitas transferir update-trackmovil.sh desde Windows"
fi

echo ""
echo -e "${GREEN}🎉 Instalación completada!${NC}"
echo -e "${CYAN}💡 Para actualizar en el futuro:${NC}"
echo -e "   ${GREEN}cd $PROJECT_DIR && ./update-trackmovil.sh${NC}"
