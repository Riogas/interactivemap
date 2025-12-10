#!/bin/bash
# Script de actualización para TracMovil con Git
# Ejecutar en el servidor Linux para actualizar la aplicación

set -e

# Colores
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RED='\033[0;31m'
NC='\033[0m'

PROJECT_DIR="$HOME/trackmovil"
CONTAINER_NAME="trackmovil"

echo -e "${CYAN}🔄 Actualizando TracMovil...${NC}"

# 1. Verificar que existe el repositorio
if [ ! -d "$PROJECT_DIR" ]; then
    echo -e "${RED}❌ Error: No se encuentra el directorio $PROJECT_DIR${NC}"
    echo -e "${YELLOW}💡 Ejecuta primero el script de instalación inicial${NC}"
    exit 1
fi

cd "$PROJECT_DIR"

# 2. Guardar cambios locales (si existen)
if [ -n "$(git status --porcelain)" ]; then
    echo -e "${YELLOW}⚠ Hay cambios locales. Guardando...${NC}"
    git stash
fi

# 3. Pull de cambios
echo -e "${YELLOW}📥 Descargando últimos cambios...${NC}"
git pull origin main
echo -e "${GREEN}✓ Código actualizado${NC}"

# 4. Rebuild imagen Docker
echo -e "${YELLOW}🏗️ Reconstruyendo imagen Docker...${NC}"
docker build -t trackmovil:latest .
echo -e "${GREEN}✓ Imagen reconstruida${NC}"

# 5. Detener y eliminar contenedor anterior
if docker ps -a | grep -q "$CONTAINER_NAME"; then
    echo -e "${YELLOW}🛑 Deteniendo contenedor anterior...${NC}"
    docker stop "$CONTAINER_NAME" 2>/dev/null || true
    docker rm "$CONTAINER_NAME" 2>/dev/null || true
    echo -e "${GREEN}✓ Contenedor anterior eliminado${NC}"
fi

# 6. Iniciar nuevo contenedor
echo -e "${YELLOW}🚀 Iniciando nuevo contenedor...${NC}"
docker run -d \
  --name "$CONTAINER_NAME" \
  --restart unless-stopped \
  -p 3001:3000 \
  --env-file "$PROJECT_DIR/.env.production" \
  trackmovil:latest

# 7. Esperar y verificar
sleep 5

if docker ps | grep -q "$CONTAINER_NAME"; then
    echo -e "${GREEN}✅ ¡Actualización completada exitosamente!${NC}"
    echo ""
    echo -e "${CYAN}📊 Estado del contenedor:${NC}"
    docker ps --filter name="$CONTAINER_NAME" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
    echo ""
    LOCAL_IP=$(hostname -I | awk '{print $1}')
    echo -e "${CYAN}🌐 Acceso: ${GREEN}http://${LOCAL_IP}:3001${NC}"
    echo ""
    echo -e "${CYAN}📋 Ver logs:${NC} docker logs -f $CONTAINER_NAME"
else
    echo -e "${RED}❌ Error: El contenedor no está corriendo${NC}"
    echo -e "${YELLOW}Ver logs: docker logs $CONTAINER_NAME${NC}"
    exit 1
fi

# 8. Limpiar imágenes antiguas (opcional)
echo ""
read -p "¿Limpiar imágenes Docker antiguas? (s/n): " -n 1 -r
echo
if [[ $REPLY =~ ^[SsYy]$ ]]; then
    docker image prune -f
    echo -e "${GREEN}✓ Imágenes antiguas eliminadas${NC}"
fi

echo -e "${GREEN}🎉 TracMovil actualizado correctamente${NC}"
