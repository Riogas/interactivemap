#!/bin/bash

###############################################################################
# Script: Instalación inicial con PM2
# Propósito: Setup completo del proyecto usando PM2 en servidor Linux
# Uso: ./scripts/install-pm2.sh
###############################################################################

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  TracMovil - Instalación con PM2${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo

# Verificar que Node.js está instalado
if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ Node.js no está instalado${NC}"
    echo -e "${YELLOW}Instalando Node.js 20...${NC}"
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi

echo -e "${GREEN}✓ Node.js version: $(node --version)${NC}"

# Verificar que pnpm está instalado
if ! command -v pnpm &> /dev/null; then
    echo -e "${YELLOW}Instalando pnpm...${NC}"
    npm install -g pnpm
fi

echo -e "${GREEN}✓ pnpm version: $(pnpm --version)${NC}"

# Verificar que PM2 está instalado
if ! command -v pm2 &> /dev/null; then
    echo -e "${YELLOW}Instalando PM2...${NC}"
    npm install -g pm2
fi

echo -e "${GREEN}✓ PM2 version: $(pm2 --version)${NC}"
echo

# Verificar que estamos en el directorio correcto
if [ ! -f "package.json" ]; then
    echo -e "${RED}❌ Error: No estamos en el directorio del proyecto${NC}"
    echo -e "${YELLOW}   Este script debe ejecutarse desde ~/trackmovil${NC}"
    exit 1
fi

# Crear .env.production si no existe
if [ ! -f ".env.production" ]; then
    echo -e "${BLUE}📝 Creando .env.production desde template...${NC}"
    if [ -f ".env.production.template" ]; then
        cp .env.production.template .env.production
        echo -e "${GREEN}✓ .env.production creado${NC}"
        echo
        echo -e "${YELLOW}⚠️  IMPORTANTE: Debes editar .env.production con tus credenciales${NC}"
        echo -e "   ${BLUE}nano .env.production${NC}"
        echo
        echo -e "Asegúrate de configurar:"
        echo -e "  - EXTERNAL_API_URL (URL de la API de login)"
        echo -e "  - NEXT_PUBLIC_SUPABASE_URL"
        echo -e "  - NEXT_PUBLIC_SUPABASE_ANON_KEY"
        echo -e "  - SUPABASE_SERVICE_ROLE_KEY"
        echo
        read -p "Presiona Enter cuando hayas editado .env.production..."
    else
        echo -e "${RED}❌ No se encontró .env.production.template${NC}"
        exit 1
    fi
else
    echo -e "${GREEN}✓ .env.production ya existe${NC}"
fi

# Instalar dependencias
echo
echo -e "${BLUE}📦 Instalando dependencias...${NC}"
pnpm install --frozen-lockfile
echo

# Build del proyecto
echo -e "${BLUE}🔨 Building proyecto Next.js...${NC}"
pnpm build
echo

# Crear directorio de logs
mkdir -p logs
echo -e "${GREEN}✓ Directorio de logs creado${NC}"

# Iniciar con PM2
echo
echo -e "${BLUE}🚀 Iniciando aplicación con PM2...${NC}"
pm2 start ecosystem.config.js
echo

# Configurar PM2 para inicio automático en reinicio del servidor
echo -e "${BLUE}⚙️  Configurando PM2 para inicio automático...${NC}"
echo -e "${YELLOW}Ejecuta el siguiente comando para configurar el inicio automático:${NC}"
echo
pm2 startup
echo
echo -e "${YELLOW}Copia y ejecuta el comando que PM2 muestra arriba (con sudo)${NC}"
read -p "Presiona Enter cuando hayas ejecutado el comando de startup..."

# Guardar configuración
pm2 save
echo

echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  ✓ Instalación completada exitosamente!${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
echo

pm2 status
echo

echo -e "${BLUE}📝 Comandos útiles:${NC}"
echo -e "   Ver logs:      ${YELLOW}pm2 logs trackmovil${NC}"
echo -e "   Monitorear:    ${YELLOW}pm2 monit${NC}"
echo -e "   Reiniciar:     ${YELLOW}pm2 restart trackmovil${NC}"
echo -e "   Detener:       ${YELLOW}pm2 stop trackmovil${NC}"
echo -e "   Status:        ${YELLOW}pm2 status${NC}"
echo

echo -e "${BLUE}🔄 Para actualizar la aplicación en el futuro:${NC}"
echo -e "   ${YELLOW}./scripts/deploy-pm2.sh${NC}"
echo

echo -e "${BLUE}🌐 Aplicación disponible en:${NC}"
echo -e "   ${GREEN}http://192.168.7.14:3001${NC}"
echo
