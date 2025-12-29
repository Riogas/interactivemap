#!/bin/bash

###############################################################################
# Script: Actualizar .env.production con la API correcta
# Propósito: Configurar automáticamente la URL de la API de login
# Uso: ./scripts/update-env-api.sh
###############################################################################

set -e

# Colores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuración
ENV_FILE=".env.production"
API_URL="https://sgm.glp.riogas.com.uy"

echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Actualización de API Configuration${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo

# Verificar que estamos en el directorio correcto
if [ ! -f "package.json" ]; then
    echo -e "${RED}❌ Error: No estamos en el directorio del proyecto trackmovil${NC}"
    echo -e "${YELLOW}   Ejecuta: cd ~/trackmovil${NC}"
    exit 1
fi

# Verificar si existe .env.production
if [ ! -f "$ENV_FILE" ]; then
    echo -e "${YELLOW}⚠️  Advertencia: $ENV_FILE no existe${NC}"
    echo -e "${YELLOW}   Creando desde .env.production.template...${NC}"
    
    if [ -f ".env.production.template" ]; then
        cp .env.production.template .env.production
        echo -e "${GREEN}✓ Creado $ENV_FILE desde template${NC}"
    else
        echo -e "${RED}❌ Error: .env.production.template tampoco existe${NC}"
        echo -e "${YELLOW}   Por favor, crea el archivo manualmente${NC}"
        exit 1
    fi
fi

echo -e "${BLUE}📝 Configuración actual:${NC}"
echo

# Mostrar configuración actual
if grep -q "EXTERNAL_API_URL" "$ENV_FILE"; then
    CURRENT_URL=$(grep "^EXTERNAL_API_URL=" "$ENV_FILE" | cut -d= -f2)
    echo -e "   URL actual: ${YELLOW}$CURRENT_URL${NC}"
else
    echo -e "   ${YELLOW}EXTERNAL_API_URL no configurada${NC}"
fi

echo
echo -e "${BLUE}🔧 Nueva configuración:${NC}"
echo -e "   URL nueva: ${GREEN}$API_URL${NC}"
echo

# Preguntar confirmación
read -p "¿Deseas actualizar la configuración? (s/n): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[SsYy]$ ]]; then
    echo -e "${YELLOW}❌ Operación cancelada${NC}"
    exit 0
fi

# Crear backup
BACKUP_FILE="${ENV_FILE}.backup.$(date +%Y%m%d_%H%M%S)"
cp "$ENV_FILE" "$BACKUP_FILE"
echo -e "${GREEN}✓ Backup creado: $BACKUP_FILE${NC}"

# Actualizar o agregar EXTERNAL_API_URL
if grep -q "^EXTERNAL_API_URL=" "$ENV_FILE"; then
    # Reemplazar línea existente
    sed -i "s|^EXTERNAL_API_URL=.*|EXTERNAL_API_URL=$API_URL|" "$ENV_FILE"
    echo -e "${GREEN}✓ EXTERNAL_API_URL actualizada${NC}"
else
    # Agregar nueva línea
    echo "" >> "$ENV_FILE"
    echo "# API Externa - Configuración actualizada $(date)" >> "$ENV_FILE"
    echo "EXTERNAL_API_URL=$API_URL" >> "$ENV_FILE"
    echo -e "${GREEN}✓ EXTERNAL_API_URL agregada${NC}"
fi

# Actualizar o agregar NEXT_PUBLIC_EXTERNAL_API_URL
if grep -q "^NEXT_PUBLIC_EXTERNAL_API_URL=" "$ENV_FILE"; then
    sed -i "s|^NEXT_PUBLIC_EXTERNAL_API_URL=.*|NEXT_PUBLIC_EXTERNAL_API_URL=$API_URL|" "$ENV_FILE"
    echo -e "${GREEN}✓ NEXT_PUBLIC_EXTERNAL_API_URL actualizada${NC}"
else
    echo "NEXT_PUBLIC_EXTERNAL_API_URL=$API_URL" >> "$ENV_FILE"
    echo -e "${GREEN}✓ NEXT_PUBLIC_EXTERNAL_API_URL agregada${NC}"
fi

echo
echo -e "${BLUE}📋 Configuración final:${NC}"
echo "─────────────────────────────────────────────────────────"
grep "EXTERNAL_API_URL" "$ENV_FILE" | grep -v "^#"
echo "─────────────────────────────────────────────────────────"
echo

echo -e "${GREEN}✓ Configuración actualizada exitosamente${NC}"
echo

# Preguntar si desea reconstruir el contenedor
read -p "¿Deseas reconstruir y reiniciar el contenedor ahora? (s/n): " -n 1 -r
echo
if [[ $REPLY =~ ^[SsYy]$ ]]; then
    echo
    echo -e "${BLUE}🔨 Reconstruyendo imagen Docker...${NC}"
    docker build -t trackmovil:latest .
    
    echo
    echo -e "${BLUE}🛑 Deteniendo contenedor actual...${NC}"
    docker stop trackmovil 2>/dev/null || true
    docker rm trackmovil 2>/dev/null || true
    
    echo
    echo -e "${BLUE}🚀 Iniciando nuevo contenedor...${NC}"
    docker run -d \
        --name trackmovil \
        -p 3001:3000 \
        --env-file .env.production \
        --restart unless-stopped \
        trackmovil:latest
    
    echo
    echo -e "${GREEN}✓ Contenedor reiniciado${NC}"
    echo
    echo -e "${BLUE}📊 Estado del contenedor:${NC}"
    docker ps | grep trackmovil
    
    echo
    echo -e "${BLUE}📝 Últimas líneas del log:${NC}"
    echo "─────────────────────────────────────────────────────────"
    docker logs --tail 20 trackmovil
    echo "─────────────────────────────────────────────────────────"
    
    echo
    echo -e "${GREEN}✓ Todo listo!${NC}"
    echo -e "${BLUE}🌐 Aplicación disponible en: http://192.168.7.14:3001${NC}"
    echo -e "${BLUE}🔑 API de login: $API_URL/puestos/gestion/login${NC}"
else
    echo
    echo -e "${YELLOW}⚠️  Recuerda reconstruir el contenedor manualmente:${NC}"
    echo -e "   ${BLUE}docker build -t trackmovil:latest .${NC}"
    echo -e "   ${BLUE}docker stop trackmovil && docker rm trackmovil${NC}"
    echo -e "   ${BLUE}docker run -d --name trackmovil -p 3001:3000 --env-file .env.production --restart unless-stopped trackmovil:latest${NC}"
fi

echo
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
