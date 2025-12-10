#!/bin/bash
# Script de deploy automático para servidor Linux

set -e  # Salir si hay error

echo "🚀 Iniciando deploy de TracMovil..."

# Variables
APP_DIR="/home/usuario/trackmovil"
BACKUP_DIR="/home/usuario/backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# Colores
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Función para imprimir con color
print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

# Verificar que estamos en el directorio correcto
cd $APP_DIR || {
    print_error "No se puede acceder a $APP_DIR"
    exit 1
}

# Crear backup
print_warning "Creando backup..."
mkdir -p $BACKUP_DIR
docker-compose down
tar -czf "$BACKUP_DIR/trackmovil_backup_$TIMESTAMP.tar.gz" .
print_success "Backup creado: trackmovil_backup_$TIMESTAMP.tar.gz"

# Pull de cambios si es repo git
if [ -d .git ]; then
    print_warning "Actualizando código desde Git..."
    git pull origin main
    print_success "Código actualizado"
fi

# Reconstruir imágenes
print_warning "Construyendo imágenes Docker..."
docker-compose build --no-cache

# Levantar servicios
print_warning "Levantando servicios..."
docker-compose up -d

# Esperar a que la app esté lista
print_warning "Esperando a que la aplicación esté lista..."
sleep 10

# Verificar health check
if curl -f http://localhost:3000/api/all-positions > /dev/null 2>&1; then
    print_success "Aplicación desplegada correctamente ✓"
    print_success "Accede a: http://$(hostname -I | awk '{print $1}'):3000"
else
    print_error "La aplicación no responde correctamente"
    print_warning "Revisa los logs con: docker-compose logs -f"
    exit 1
fi

# Mostrar logs
print_warning "Últimas líneas de logs:"
docker-compose logs --tail=20

print_success "Deploy completado exitosamente! 🎉"
