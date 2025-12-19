#!/bin/bash

###############################################################################
# Script: Instalación Completa de TracMovil con Docker desde Cero
# Propósito: Setup completo del proyecto en un servidor Linux nuevo
# Uso: curl -sSL https://raw.githubusercontent.com/Riogas/interactivemap/main/scripts/install-docker-full.sh | bash
###############################################################################

set -e

# Colores
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  TracMovil - Instalación Completa con Docker${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo

# Verificar que se ejecuta en Linux
if [[ "$OSTYPE" != "linux-gnu"* ]]; then
    echo -e "${RED}❌ Este script solo funciona en Linux${NC}"
    exit 1
fi

# ============================================================================
# Paso 1: Instalar Docker
# ============================================================================

echo -e "${CYAN}📦 Paso 1/6: Instalando Docker...${NC}"
echo

if command -v docker &> /dev/null; then
    echo -e "${GREEN}✓ Docker ya está instalado: $(docker --version)${NC}"
else
    echo -e "${YELLOW}Instalando Docker Engine...${NC}"
    
    # Actualizar sistema
    sudo apt update
    sudo apt upgrade -y
    
    # Instalar dependencias
    sudo apt install -y \
        apt-transport-https \
        ca-certificates \
        curl \
        gnupg \
        lsb-release
    
    # Agregar clave GPG de Docker
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg
    
    # Configurar repositorio
    echo \
      "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu \
      $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
    
    # Instalar Docker
    sudo apt update
    sudo apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
    
    echo -e "${GREEN}✓ Docker instalado: $(docker --version)${NC}"
fi

# Configurar usuario sin sudo
if groups $USER | grep -q '\bdocker\b'; then
    echo -e "${GREEN}✓ Usuario ya está en el grupo docker${NC}"
else
    echo -e "${YELLOW}Agregando usuario al grupo docker...${NC}"
    sudo usermod -aG docker $USER
    echo -e "${GREEN}✓ Usuario agregado al grupo docker${NC}"
    echo -e "${YELLOW}⚠️  Necesitarás cerrar sesión y volver a entrar para que el cambio tenga efecto${NC}"
fi

# Habilitar Docker al inicio
sudo systemctl enable docker
sudo systemctl start docker

echo

# ============================================================================
# Paso 2: Clonar Repositorio
# ============================================================================

echo -e "${CYAN}📥 Paso 2/6: Clonando repositorio...${NC}"
echo

PROJECT_DIR="$HOME/trackmovil"

if [ -d "$PROJECT_DIR" ]; then
    echo -e "${YELLOW}⚠️  El directorio $PROJECT_DIR ya existe${NC}"
    read -p "¿Deseas eliminarlo y clonar de nuevo? (s/n): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[SsYy]$ ]]; then
        rm -rf "$PROJECT_DIR"
        git clone https://github.com/Riogas/interactivemap.git "$PROJECT_DIR"
        echo -e "${GREEN}✓ Repositorio clonado${NC}"
    else
        echo -e "${YELLOW}Usando directorio existente${NC}"
    fi
else
    git clone https://github.com/Riogas/interactivemap.git "$PROJECT_DIR"
    echo -e "${GREEN}✓ Repositorio clonado en $PROJECT_DIR${NC}"
fi

cd "$PROJECT_DIR"
echo

# ============================================================================
# Paso 3: Configurar Variables de Entorno
# ============================================================================

echo -e "${CYAN}⚙️  Paso 3/6: Configurando variables de entorno...${NC}"
echo

if [ ! -f ".env.production" ]; then
    if [ -f ".env.production.template" ]; then
        cp .env.production.template .env.production
        echo -e "${GREEN}✓ .env.production creado desde template${NC}"
        echo
        echo -e "${YELLOW}═══════════════════════════════════════════════════════════${NC}"
        echo -e "${YELLOW}  ⚠️  CONFIGURACIÓN REQUERIDA${NC}"
        echo -e "${YELLOW}═══════════════════════════════════════════════════════════${NC}"
        echo
        echo -e "Debes editar ${CYAN}.env.production${NC} con tus credenciales:"
        echo
        echo -e "1. ${BLUE}EXTERNAL_API_URL${NC} - URL de tu API de login"
        echo -e "   Ejemplos:"
        echo -e "   ${GREEN}http://localhost:3000${NC} (si la API está en el mismo servidor)"
        echo -e "   ${GREEN}http://192.168.7.14:3000${NC} (si está en otra máquina)"
        echo
        echo -e "2. ${BLUE}NEXT_PUBLIC_SUPABASE_URL${NC} - URL de Supabase"
        echo -e "3. ${BLUE}NEXT_PUBLIC_SUPABASE_ANON_KEY${NC} - Key pública de Supabase"
        echo -e "4. ${BLUE}SUPABASE_SERVICE_ROLE_KEY${NC} - Key privada de Supabase"
        echo
        echo -e "${YELLOW}═══════════════════════════════════════════════════════════${NC}"
        echo
        
        # Preguntar si quiere editar ahora
        read -p "¿Deseas editar .env.production ahora? (s/n): " -n 1 -r
        echo
        if [[ $REPLY =~ ^[SsYy]$ ]]; then
            nano .env.production
            echo -e "${GREEN}✓ Configuración guardada${NC}"
        else
            echo -e "${YELLOW}⚠️  Recuerda editar .env.production antes de continuar:${NC}"
            echo -e "   ${CYAN}nano ~/trackmovil/.env.production${NC}"
            echo
            read -p "Presiona Enter cuando hayas editado el archivo..."
        fi
    else
        echo -e "${RED}❌ No se encontró .env.production.template${NC}"
        exit 1
    fi
else
    echo -e "${GREEN}✓ .env.production ya existe${NC}"
fi

echo

# ============================================================================
# Paso 4: Dar permisos a scripts
# ============================================================================

echo -e "${CYAN}🔐 Paso 4/6: Configurando permisos de scripts...${NC}"
echo

chmod +x scripts/*.sh
echo -e "${GREEN}✓ Permisos configurados${NC}"
echo

# ============================================================================
# Paso 5: Construir Imagen Docker
# ============================================================================

echo -e "${CYAN}🔨 Paso 5/6: Construyendo imagen Docker...${NC}"
echo -e "${YELLOW}Esto puede tomar varios minutos la primera vez...${NC}"
echo

docker build -t trackmovil:latest .

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Imagen Docker construida exitosamente${NC}"
else
    echo -e "${RED}❌ Error al construir la imagen Docker${NC}"
    exit 1
fi

echo

# ============================================================================
# Paso 6: Ejecutar Contenedor
# ============================================================================

echo -e "${CYAN}🚀 Paso 6/6: Iniciando contenedor...${NC}"
echo

# Preguntar qué configuración de red usar
echo -e "${YELLOW}¿Cómo quieres configurar la red del contenedor?${NC}"
echo
echo -e "1. ${GREEN}Puerto 3001${NC} (mapea 3001:3000) - ${BLUE}Recomendado para producción${NC}"
echo -e "2. ${GREEN}Red del host${NC} (usa localhost directamente) - ${BLUE}Útil si la API está en localhost${NC}"
echo
read -p "Selecciona una opción (1 o 2): " -n 1 -r
echo
echo

# Detener contenedor anterior si existe
if docker ps -a | grep -q trackmovil; then
    echo -e "${YELLOW}Deteniendo contenedor anterior...${NC}"
    docker stop trackmovil 2>/dev/null || true
    docker rm trackmovil 2>/dev/null || true
fi

if [[ $REPLY == "2" ]]; then
    # Opción 2: Red del host
    echo -e "${BLUE}Iniciando con red del host...${NC}"
    docker run -d \
      --name trackmovil \
      --network host \
      --env-file .env.production \
      --restart unless-stopped \
      trackmovil:latest
    
    echo -e "${GREEN}✓ Contenedor iniciado en red del host${NC}"
    echo -e "${BLUE}🌐 Aplicación disponible en: http://localhost:3000${NC}"
else
    # Opción 1: Puerto 3001 (por defecto)
    echo -e "${BLUE}Iniciando en puerto 3001...${NC}"
    docker run -d \
      --name trackmovil \
      -p 3001:3000 \
      --env-file .env.production \
      --restart unless-stopped \
      trackmovil:latest
    
    echo -e "${GREEN}✓ Contenedor iniciado en puerto 3001${NC}"
    echo -e "${BLUE}🌐 Aplicación disponible en: http://localhost:3001${NC}"
fi

echo

# Esperar un momento para que el contenedor inicie
sleep 3

# ============================================================================
# Verificación Final
# ============================================================================

echo -e "${CYAN}✅ Verificación final...${NC}"
echo

if docker ps | grep -q trackmovil; then
    echo -e "${GREEN}✓ Contenedor corriendo exitosamente${NC}"
    echo
    
    echo -e "${BLUE}📊 Estado del contenedor:${NC}"
    docker ps | grep trackmovil
    echo
    
    echo -e "${BLUE}📝 Últimas líneas del log:${NC}"
    echo -e "${YELLOW}─────────────────────────────────────────────────────────${NC}"
    docker logs --tail 20 trackmovil
    echo -e "${YELLOW}─────────────────────────────────────────────────────────${NC}"
else
    echo -e "${RED}❌ El contenedor no está corriendo${NC}"
    echo -e "${YELLOW}Ver logs con: docker logs trackmovil${NC}"
    exit 1
fi

echo

# ============================================================================
# Resumen Final
# ============================================================================

echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  ✓ Instalación completada exitosamente!${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
echo

echo -e "${BLUE}📁 Ubicación del proyecto:${NC}"
echo -e "   ${CYAN}$PROJECT_DIR${NC}"
echo

echo -e "${BLUE}📝 Comandos útiles:${NC}"
echo -e "   Ver logs:      ${YELLOW}docker logs -f trackmovil${NC}"
echo -e "   Reiniciar:     ${YELLOW}docker restart trackmovil${NC}"
echo -e "   Detener:       ${YELLOW}docker stop trackmovil${NC}"
echo -e "   Estado:        ${YELLOW}docker ps | grep trackmovil${NC}"
echo

echo -e "${BLUE}🔄 Para actualizar la aplicación:${NC}"
echo -e "   ${YELLOW}cd ~/trackmovil${NC}"
echo -e "   ${YELLOW}./scripts/update-trackmovil.sh${NC}"
echo

echo -e "${BLUE}🌐 URLs de acceso:${NC}"
if [[ $REPLY == "2" ]]; then
    echo -e "   Localhost:     ${GREEN}http://localhost:3000${NC}"
    echo -e "   Red local:     ${GREEN}http://$(hostname -I | awk '{print $1}'):3000${NC}"
else
    echo -e "   Localhost:     ${GREEN}http://localhost:3001${NC}"
    echo -e "   Red local:     ${GREEN}http://$(hostname -I | awk '{print $1}'):3001${NC}"
fi

echo

echo -e "${BLUE}📚 Documentación:${NC}"
echo -e "   ${CYAN}cat ~/trackmovil/DOCKER_DEPLOYMENT_DESDE_CERO.md${NC}"
echo

echo -e "${YELLOW}⚠️  Si agregaste tu usuario al grupo docker por primera vez,${NC}"
echo -e "${YELLOW}    necesitas cerrar sesión y volver a entrar para que funcione sin sudo.${NC}"
echo

echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
