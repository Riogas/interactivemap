#!/bin/bash
# Script para cargar y ejecutar imagen Docker en Linux (VERSIÓN ORGANIZADA)
# Ejecutar este script en el servidor Linux después de transferir trackmovil.zip

set -e

echo "🐧 Configurando TracMovil en Linux..."

# Colores
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Directorio de instalación
INSTALL_DIR="$HOME/trackmovil"

# 0. Crear directorio de instalación
echo -e "${YELLOW}📁 Creando directorio de instalación...${NC}"
mkdir -p "$INSTALL_DIR"
echo -e "${GREEN}✓ Directorio creado: $INSTALL_DIR${NC}"

# 1. Mover archivos al directorio de instalación
echo -e "${YELLOW}📦 Moviendo archivos...${NC}"

if [ -f "trackmovil.zip" ]; then
    mv trackmovil.zip "$INSTALL_DIR/"
    echo -e "${GREEN}✓ trackmovil.zip movido${NC}"
fi

if [ -f "trackmovil.tar" ]; then
    mv trackmovil.tar "$INSTALL_DIR/"
    echo -e "${GREEN}✓ trackmovil.tar movido${NC}"
fi

# Cambiar al directorio de instalación
cd "$INSTALL_DIR"
echo -e "${CYAN}📂 Directorio actual: $(pwd)${NC}"

# 2. Descomprimir
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

# 3. Cargar imagen Docker
if [ -f "trackmovil.tar" ]; then
    echo -e "${YELLOW}🐳 Cargando imagen en Docker...${NC}"
    docker load -i trackmovil.tar
    echo -e "${GREEN}✓ Imagen cargada${NC}"
else
    echo -e "${RED}❌ Error: No se encuentra trackmovil.tar${NC}"
    exit 1
fi

# 4. Verificar que existe .env
if [ ! -f ".env" ]; then
    echo -e "${YELLOW}⚠ No se encuentra archivo .env${NC}"
    echo -e "${CYAN}Creando .env de ejemplo...${NC}"
    cat > .env << 'EOF'
# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=https://lgniuhelyyizoursmsmi.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxnbml1aGVseXlpem91cnNtc21pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTc0NDQ5MTUsImV4cCI6MjA3MzAyMDkxNX0.96kkOHRA1EgOYqu6bm0-6nr_a3qpAHUoYA9Z77qUCQI
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxnbml1aGVseXlpem91cnNtc21pIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NzQ0NDkxNSwiZXhwIjoyMDczMDIwOTE1fQ.qR09lu4wr1j-tecWLdH0IZbEj2HUpEt8xHTtOvE_5BE

# Database Configuration (Legacy)
DB_HOST=192.168.1.8
DB_USER=qsecofr
DB_PASSWORD=wwm868
DB_SCHEMA=GXICAGEO
DB_MODE=supabase

# API Externa
EXTERNAL_API_URL=http://localhost:8000

# Node
NODE_ENV=production
PORT=3000
HOSTNAME=0.0.0.0
NEXT_TELEMETRY_DISABLED=1
EOF
    echo -e "${GREEN}✓ Archivo .env creado en $INSTALL_DIR/.env${NC}"
    echo -e "${YELLOW}⚠ IMPORTANTE: Edita el archivo .env si es necesario${NC}"
fi

# 5. Detener contenedor anterior si existe
if docker ps -a | grep -q trackmovil; then
    echo -e "${YELLOW}🛑 Deteniendo contenedor anterior...${NC}"
    docker stop trackmovil 2>/dev/null || true
    docker rm trackmovil 2>/dev/null || true
    echo -e "${GREEN}✓ Contenedor anterior eliminado${NC}"
fi

# 6. Ejecutar nuevo contenedor
echo -e "${YELLOW}🚀 Iniciando contenedor TracMovil...${NC}"
docker run -d \
  --name trackmovil \
  --restart unless-stopped \
  -p 3001:3000 \
  --env-file "$INSTALL_DIR/.env" \
  trackmovil:latest

# 7. Esperar unos segundos
echo -e "${CYAN}⏳ Esperando a que la aplicación inicie...${NC}"
sleep 5

# 8. Verificar estado
if docker ps | grep -q trackmovil; then
    echo -e "${GREEN}✅ ¡Contenedor corriendo exitosamente!${NC}"
    echo ""
    echo -e "${CYAN}📊 Estado del contenedor:${NC}"
    docker ps --filter name=trackmovil --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
    echo ""
    echo -e "${CYAN}📂 Archivos de configuración en:${NC}"
    echo -e "   ${GREEN}$INSTALL_DIR${NC}"
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
    echo "   Editar .env:   nano $INSTALL_DIR/.env"
else
    echo -e "${RED}❌ Error: El contenedor no está corriendo${NC}"
    echo -e "${YELLOW}Ver logs con: docker logs trackmovil${NC}"
fi

# 9. Limpiar archivos temporales (opcional)
echo ""
read -p "¿Eliminar archivos .tar y .zip temporales? (s/n): " -n 1 -r
echo
if [[ $REPLY =~ ^[SsYy]$ ]]; then
    rm -f "$INSTALL_DIR/trackmovil.tar" "$INSTALL_DIR/trackmovil.zip"
    echo -e "${GREEN}✓ Archivos temporales eliminados${NC}"
    echo -e "${CYAN}Archivos conservados: $INSTALL_DIR/.env${NC}"
fi

echo ""
echo -e "${GREEN}🎉 Despliegue completado!${NC}"
echo -e "${CYAN}📁 Todos los archivos están en: $INSTALL_DIR${NC}"
