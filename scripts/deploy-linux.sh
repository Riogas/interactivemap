#!/bin/bash
# Script para cargar y ejecutar imagen Docker en Linux
# Ejecutar este script en el servidor Linux después de transferir trackmovil.zip

set -e

echo "🐧 Configurando TracMovil en Linux..."

# Colores
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# 1. Descomprimir
if [ -f "trackmovil.zip" ]; then
    echo -e "${YELLOW}📦 Descomprimiendo trackmovil.zip...${NC}"
    
    # Intentar con unzip primero
    if command -v unzip &> /dev/null; then
        unzip -o trackmovil.zip
    # Si no hay unzip, intentar con Python
    elif command -v python3 &> /dev/null; then
        python3 -m zipfile -e trackmovil.zip .
    elif command -v python &> /dev/null; then
        python -m zipfile -e trackmovil.zip .
    else
        echo -e "${YELLOW}⚠ No se encontró unzip ni Python. Instalando unzip...${NC}"
        sudo apt update && sudo apt install -y unzip
        unzip -o trackmovil.zip
    fi
    
    echo -e "${GREEN}✓ Descomprimido${NC}"
else
    echo -e "${YELLOW}⚠ No se encuentra trackmovil.zip, asumiendo que trackmovil.tar ya existe${NC}"
fi

# 2. Cargar imagen Docker
if [ -f "trackmovil.tar" ]; then
    echo -e "${YELLOW}🐳 Cargando imagen en Docker...${NC}"
    docker load -i trackmovil.tar
    echo -e "${GREEN}✓ Imagen cargada${NC}"
else
    echo -e "${RED}❌ Error: No se encuentra trackmovil.tar${NC}"
    exit 1
fi

# 3. Verificar que existe .env
if [ ! -f ".env" ]; then
    echo -e "${YELLOW}⚠ No se encuentra archivo .env${NC}"
    echo -e "${CYAN}Creando .env de ejemplo...${NC}"
    cat > .env << 'EOF'
# Supabase Configuration (Self-Hosted)
NEXT_PUBLIC_SUPABASE_URL=https://supabase.glp.riogas.com.uy
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzcxNjExNDY2LCJleHAiOjE5MjkyOTE0NjZ9.qD9ZTsX9Pn7zf2tAdeidForoM20mlBqfYcQ_PXYZAmk
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaXNzIjoic3VwYWJhc2UiLCJpYXQiOjE3NzE2MTE0NjYsImV4cCI6MTkyOTI5MTQ2Nn0.ejNj65ClpKHiszUdkVz6ZY_XMeiaGYhQeAplbUoJ7GA

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
ENABLE_SECURITY_CHECKS=false

# Node
NODE_ENV=production
PORT=3000
HOSTNAME=0.0.0.0
NEXT_TELEMETRY_DISABLED=1
NODE_TLS_REJECT_UNAUTHORIZED=0
EOF
    echo -e "${GREEN}✓ Archivo .env creado${NC}"
    echo -e "${YELLOW}⚠ IMPORTANTE: Edita el archivo .env si es necesario${NC}"
fi

# 4. Detener contenedor anterior si existe
if docker ps -a | grep -q trackmovil; then
    echo -e "${YELLOW}🛑 Deteniendo contenedor anterior...${NC}"
    docker stop trackmovil 2>/dev/null || true
    docker rm trackmovil 2>/dev/null || true
    echo -e "${GREEN}✓ Contenedor anterior eliminado${NC}"
fi

# 5. Ejecutar nuevo contenedor
echo -e "${YELLOW}🚀 Iniciando contenedor TracMovil...${NC}"
docker run -d \
  --name trackmovil \
  --restart unless-stopped \
  -p 3001:3000 \
  --env-file .env \
  trackmovil:latest

# 6. Esperar unos segundos
echo -e "${CYAN}⏳ Esperando a que la aplicación inicie...${NC}"
sleep 5

# 7. Verificar estado
if docker ps | grep -q trackmovil; then
    echo -e "${GREEN}✅ ¡Contenedor corriendo exitosamente!${NC}"
    echo ""
    echo -e "${CYAN}📊 Estado del contenedor:${NC}"
    docker ps --filter name=trackmovil --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
    echo ""
    echo -e "${CYAN}🌐 Acceso:${NC}"
    echo -e "   Local: ${GREEN}http://localhost:3001${NC}"
    LOCAL_IP=$(hostname -I | awk '{print $1}')
    echo -e "   Red:   ${GREEN}http://${LOCAL_IP}:3001${NC}"
    echo ""
    echo -e "${CYAN}📋 Comandos útiles:${NC}"
    echo "   Ver logs:      docker logs -f trackmovil"
    echo "   Reiniciar:     docker restart trackmovil"
    echo "   Detener:       docker stop trackmovil"
    echo "   Eliminar:      docker rm -f trackmovil"
else
    echo -e "${RED}❌ Error: El contenedor no está corriendo${NC}"
    echo -e "${YELLOW}Ver logs con: docker logs trackmovil${NC}"
fi

# 8. Limpiar archivos temporales (opcional)
read -p "¿Eliminar archivos .tar y .zip? (s/n): " -n 1 -r
echo
if [[ $REPLY =~ ^[SsYy]$ ]]; then
    rm -f trackmovil.tar trackmovil.zip
    echo -e "${GREEN}✓ Archivos temporales eliminados${NC}"
fi

echo ""
echo -e "${GREEN}🎉 Despliegue completado!${NC}"
