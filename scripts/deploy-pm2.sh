#!/bin/bash

###############################################################################
# Script: Deploy con PM2
# Propósito: Deployment y actualización de la aplicación usando PM2
# Uso: ./scripts/deploy-pm2.sh
###############################################################################

set -e

# Colores
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  TracMovil - Deployment con PM2${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo

# Verificar que estamos en el directorio correcto
if [ ! -f "package.json" ]; then
    echo -e "${RED}❌ Error: No estamos en el directorio del proyecto${NC}"
    echo -e "${YELLOW}   Ejecuta: cd ~/trackmovil${NC}"
    exit 1
fi

# 1. Git pull
echo -e "${BLUE}📥 Obteniendo últimos cambios...${NC}"
git pull origin main
echo

# 2. Instalar/actualizar dependencias
echo -e "${BLUE}📦 Instalando dependencias...${NC}"
pnpm install --frozen-lockfile
echo

# 3. Build del proyecto
echo -e "${BLUE}🔨 Building proyecto Next.js...${NC}"
pnpm build
echo

# 4. Crear directorio de logs si no existe
mkdir -p logs

# 5. Verificar si PM2 ya está corriendo la aplicación
if pm2 describe trackmovil > /dev/null 2>&1; then
    echo -e "${BLUE}🔄 Reiniciando aplicación con PM2...${NC}"
    pm2 reload trackmovil --update-env
else
    echo -e "${BLUE}🚀 Iniciando aplicación por primera vez con PM2...${NC}"
    pm2 start pm2.config.js
fi
echo

# 6. Guardar configuración de PM2
pm2 save

# 7. Mostrar status
echo
echo -e "${GREEN}✓ Deployment completado exitosamente!${NC}"
echo
echo -e "${BLUE}📊 Estado de la aplicación:${NC}"
pm2 status
echo

echo -e "${BLUE}📝 Comandos útiles:${NC}"
echo -e "   Ver logs:      ${YELLOW}pm2 logs trackmovil${NC}"
echo -e "   Ver logs tail: ${YELLOW}pm2 logs trackmovil --lines 100${NC}"
echo -e "   Monitorear:    ${YELLOW}pm2 monit${NC}"
echo -e "   Reiniciar:     ${YELLOW}pm2 restart trackmovil${NC}"
echo -e "   Detener:       ${YELLOW}pm2 stop trackmovil${NC}"
echo

echo -e "${BLUE}🌐 Aplicación disponible en:${NC}"
echo -e "   ${GREEN}http://192.168.7.14:3001${NC}"
echo
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
