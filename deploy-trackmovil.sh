#!/bin/bash

################################################################################
# 🚀 TrackMovil - Deploy Script (Instalación o Actualización)
################################################################################
# Este script maneja SOLO la aplicación trackmovil
# NO instala Docker, Node.js, ni actualiza el sistema
#
# Requisitos previos:
# - Docker instalado y funcionando
# - Git instalado
# - Usuario con permisos para Docker (en grupo docker)
#
# Uso:
#   ./deploy-trackmovil.sh              # Instalación/Actualización completa
#   ./deploy-trackmovil.sh --quick      # Actualización rápida (solo rebuild)
#   ./deploy-trackmovil.sh --config     # Solo actualizar configuración
################################################################################

set -e  # Exit on error

# Colores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Configuración
REPO_URL="https://github.com/Riogas/interactivemap.git"
APP_DIR="$HOME/trackmovil"
CONTAINER_NAME="trackmovil"
IMAGE_NAME="trackmovil:latest"
PORT_EXTERNAL=3001
PORT_INTERNAL=3000

################################################################################
# Funciones de Utilidad
################################################################################

print_header() {
    echo -e "\n${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${CYAN}  $1${NC}"
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

print_step() {
    echo -e "${YELLOW}▶ $1${NC}"
}

################################################################################
# Verificación de Requisitos
################################################################################

check_prerequisites() {
    print_header "Verificando Requisitos"
    
    local all_ok=true
    
    # Verificar Docker
    print_step "Verificando Docker..."
    if command -v docker &> /dev/null; then
        if docker ps &> /dev/null; then
            print_success "Docker está instalado y funcionando"
        else
            print_error "Docker está instalado pero no tienes permisos"
            print_info "Ejecuta: sudo usermod -aG docker \$USER && newgrp docker"
            all_ok=false
        fi
    else
        print_error "Docker no está instalado"
        print_info "Instala Docker primero: https://docs.docker.com/engine/install/"
        all_ok=false
    fi
    
    # Verificar Git
    print_step "Verificando Git..."
    if command -v git &> /dev/null; then
        print_success "Git está instalado"
    else
        print_error "Git no está instalado"
        print_info "Ejecuta: sudo apt install git"
        all_ok=false
    fi
    
    if [ "$all_ok" = false ]; then
        print_error "Faltan requisitos. Por favor instálalos y vuelve a ejecutar el script."
        exit 1
    fi
}

################################################################################
# Gestión del Repositorio
################################################################################

setup_repository() {
    print_header "Configurando Repositorio"
    
    if [ -d "$APP_DIR" ]; then
        print_warning "El directorio $APP_DIR ya existe"
        
        # Verificar si es un repositorio git
        if [ -d "$APP_DIR/.git" ]; then
            print_step "Actualizando repositorio existente..."
            cd "$APP_DIR"
            
            # Guardar cambios locales si existen
            if ! git diff-index --quiet HEAD -- 2>/dev/null; then
                print_warning "Hay cambios locales. Guardándolos..."
                git stash push -m "Auto-stash antes de deploy $(date '+%Y-%m-%d %H:%M:%S')"
            fi
            
            # Pull latest changes
            print_step "Descargando últimos cambios..."
            git pull origin main
            print_success "Repositorio actualizado"
        else
            print_warning "$APP_DIR existe pero no es un repositorio git"
            echo -n "¿Deseas eliminarlo y clonar de nuevo? (y/N): "
            read -r response
            if [[ "$response" =~ ^[Yy]$ ]]; then
                rm -rf "$APP_DIR"
                clone_repository
            else
                print_error "Abortando. Por favor resuelve manualmente."
                exit 1
            fi
        fi
    else
        clone_repository
    fi
}

clone_repository() {
    print_step "Clonando repositorio..."
    git clone "$REPO_URL" "$APP_DIR"
    cd "$APP_DIR"
    print_success "Repositorio clonado"
}

################################################################################
# Configuración de Environment
################################################################################

setup_environment() {
    print_header "Configuración de Environment"
    
    cd "$APP_DIR"
    
    if [ -f ".env.production" ]; then
        print_info "Ya existe .env.production"
        echo -n "¿Deseas editarlo? (y/N): "
        read -r response
        if [[ "$response" =~ ^[Yy]$ ]]; then
            edit_env_file
        else
            print_info "Manteniendo .env.production existente"
        fi
    else
        print_warning ".env.production no existe. Creándolo..."
        
        if [ -f ".env.production.template" ]; then
            print_step "Copiando desde template..."
            cp .env.production.template .env.production
        else
            print_step "Creando .env.production con valores por defecto..."
            create_default_env
        fi
        
        edit_env_file
    fi
}

create_default_env() {
    cat > .env.production <<EOF
# API Configuration
EXTERNAL_API_URL=http://localhost:3000
NEXT_PUBLIC_EXTERNAL_API_URL=http://localhost:3000

# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here

# Application
NODE_ENV=production
PORT=3000
EOF
    print_success ".env.production creado con valores por defecto"
}

edit_env_file() {
    print_info "Configurando variables de entorno..."
    print_warning "\n⚠️  IMPORTANTE: Configura correctamente la API URL"
    echo ""
    echo "Opciones comunes:"
    echo "  1. Con --network host:  http://localhost:3000"
    echo "  2. Con bridge network:  http://192.168.7.14:3000 (IP del servidor)"
    echo ""
    
    # Detectar editor disponible
    if command -v nano &> /dev/null; then
        nano .env.production
    elif command -v vim &> /dev/null; then
        vim .env.production
    elif command -v vi &> /dev/null; then
        vi .env.production
    else
        print_warning "No se encontró editor de texto"
        print_info "Edita manualmente: $APP_DIR/.env.production"
        echo -n "Presiona Enter cuando hayas terminado de editar..."
        read
    fi
    
    print_success "Configuración guardada"
}

################################################################################
# Docker Build
################################################################################

build_image() {
    print_header "Construyendo Imagen Docker"
    
    cd "$APP_DIR"
    
    print_step "Building Docker image..."
    print_info "Esto puede tomar 2-10 minutos dependiendo de la cache..."
    
    # Build sin cache si se especifica
    if [ "$BUILD_NO_CACHE" = true ]; then
        docker build --no-cache -t "$IMAGE_NAME" .
    else
        docker build -t "$IMAGE_NAME" .
    fi
    
    print_success "Imagen construida: $IMAGE_NAME"
}

################################################################################
# Docker Container Management
################################################################################

stop_container() {
    print_header "Deteniendo Container Existente"
    
    if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
        print_step "Deteniendo container $CONTAINER_NAME..."
        docker stop "$CONTAINER_NAME" 2>/dev/null || true
        
        print_step "Eliminando container $CONTAINER_NAME..."
        docker rm "$CONTAINER_NAME" 2>/dev/null || true
        
        print_success "Container eliminado"
    else
        print_info "No hay container existente"
    fi
}

run_container() {
    print_header "Iniciando Container"
    
    print_info "Selecciona el modo de red:"
    echo "  1. Port Mapping (3001:3000) - Recomendado"
    echo "  2. Host Network (--network host) - Para acceso a localhost"
    echo ""
    echo -n "Opción (1/2) [1]: "
    read -r network_option
    network_option=${network_option:-1}
    
    print_step "Iniciando container..."
    
    if [ "$network_option" = "2" ]; then
        docker run -d \
            --name "$CONTAINER_NAME" \
            --network host \
            --env-file .env.production \
            --restart unless-stopped \
            "$IMAGE_NAME"
        
        print_success "Container iniciado en modo Host Network"
        print_info "Accede en: http://localhost:$PORT_INTERNAL"
    else
        docker run -d \
            --name "$CONTAINER_NAME" \
            -p "$PORT_EXTERNAL:$PORT_INTERNAL" \
            --env-file .env.production \
            --restart unless-stopped \
            "$IMAGE_NAME"
        
        print_success "Container iniciado en Port Mapping"
        print_info "Accede en: http://localhost:$PORT_EXTERNAL"
    fi
}

################################################################################
# Verificación
################################################################################

verify_deployment() {
    print_header "Verificando Deployment"
    
    print_step "Esperando que el container esté listo..."
    sleep 3
    
    # Verificar que el container esté corriendo
    if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
        print_success "Container está corriendo"
        
        # Mostrar logs recientes
        print_step "Logs recientes:"
        echo ""
        docker logs --tail 20 "$CONTAINER_NAME"
        echo ""
        
        # Verificar health
        print_step "Verificando health del container..."
        sleep 2
        
        if docker inspect --format='{{.State.Running}}' "$CONTAINER_NAME" | grep -q "true"; then
            print_success "Container está saludable"
        else
            print_warning "Container puede tener problemas. Verifica los logs."
        fi
    else
        print_error "Container no está corriendo"
        print_info "Verifica los logs: docker logs $CONTAINER_NAME"
        exit 1
    fi
}

################################################################################
# Resumen Final
################################################################################

print_summary() {
    print_header "🎉 Deployment Completado"
    
    # Detectar modo de red
    local access_url
    if docker inspect "$CONTAINER_NAME" 2>/dev/null | grep -q '"NetworkMode": "host"'; then
        access_url="http://localhost:$PORT_INTERNAL"
    else
        access_url="http://localhost:$PORT_EXTERNAL"
        # Intentar detectar IP del servidor
        local server_ip=$(hostname -I | awk '{print $1}')
        if [ -n "$server_ip" ]; then
            echo -e "${CYAN}📍 Acceso Local:${NC}   $access_url"
            echo -e "${CYAN}📍 Acceso Remoto:${NC}  http://$server_ip:$PORT_EXTERNAL"
        fi
    fi
    
    [ -z "$server_ip" ] && echo -e "${CYAN}📍 URL de Acceso:${NC} $access_url"
    
    echo ""
    echo -e "${CYAN}🔧 Comandos Útiles:${NC}"
    echo -e "  ${YELLOW}Ver logs:${NC}       docker logs -f $CONTAINER_NAME"
    echo -e "  ${YELLOW}Reiniciar:${NC}      docker restart $CONTAINER_NAME"
    echo -e "  ${YELLOW}Detener:${NC}        docker stop $CONTAINER_NAME"
    echo -e "  ${YELLOW}Estado:${NC}         docker ps | grep $CONTAINER_NAME"
    echo -e "  ${YELLOW}Actualizar:${NC}     ./deploy-trackmovil.sh"
    echo ""
    echo -e "${GREEN}✨ TrackMovil está listo para usar!${NC}"
}

################################################################################
# Modos de Ejecución
################################################################################

quick_update() {
    print_header "🚀 Actualización Rápida"
    
    check_prerequisites
    
    cd "$APP_DIR"
    
    print_step "Git pull..."
    git pull origin main
    
    print_step "Rebuilding..."
    docker build -t "$IMAGE_NAME" .
    
    print_step "Restarting container..."
    docker stop "$CONTAINER_NAME"
    docker rm "$CONTAINER_NAME"
    
    # Detectar modo de red anterior
    local last_network=$(docker inspect "$CONTAINER_NAME" 2>/dev/null | grep -o '"NetworkMode": "[^"]*"' | cut -d'"' -f4 || echo "bridge")
    
    if [ "$last_network" = "host" ]; then
        docker run -d --name "$CONTAINER_NAME" --network host --env-file .env.production --restart unless-stopped "$IMAGE_NAME"
    else
        docker run -d --name "$CONTAINER_NAME" -p "$PORT_EXTERNAL:$PORT_INTERNAL" --env-file .env.production --restart unless-stopped "$IMAGE_NAME"
    fi
    
    print_success "Actualización completada"
    docker logs --tail 20 "$CONTAINER_NAME"
}

config_only() {
    print_header "⚙️  Actualización de Configuración"
    
    cd "$APP_DIR"
    setup_environment
    
    print_step "Rebuilding con nueva configuración..."
    BUILD_NO_CACHE=true
    build_image
    
    stop_container
    run_container
    verify_deployment
    print_summary
}

full_deploy() {
    print_header "🚀 TrackMovil - Deploy Completo"
    
    check_prerequisites
    setup_repository
    setup_environment
    build_image
    stop_container
    run_container
    verify_deployment
    print_summary
}

################################################################################
# Main
################################################################################

main() {
    case "${1:-}" in
        --quick)
            quick_update
            ;;
        --config)
            config_only
            ;;
        --help|-h)
            echo "Uso: $0 [OPCIÓN]"
            echo ""
            echo "Opciones:"
            echo "  (sin opción)   Deploy completo (instalación o actualización)"
            echo "  --quick        Actualización rápida (solo git pull + rebuild)"
            echo "  --config       Solo actualizar configuración (.env.production)"
            echo "  --help, -h     Mostrar esta ayuda"
            echo ""
            exit 0
            ;;
        *)
            full_deploy
            ;;
    esac
}

# Ejecutar
main "$@"
