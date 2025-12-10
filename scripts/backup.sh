#!/bin/bash
# Script de backup para TracMovil

BACKUP_DIR="/home/usuario/backups/trackmovil"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
APP_DIR="/home/usuario/trackmovil"
RETENTION_DAYS=7

echo "📦 Iniciando backup..."

# Crear directorio de backups
mkdir -p $BACKUP_DIR

# Backup del código y configuración
cd $APP_DIR
tar -czf "$BACKUP_DIR/code_$TIMESTAMP.tar.gz" \
    --exclude='node_modules' \
    --exclude='.next' \
    --exclude='*.log' \
    .

# Backup de volúmenes Docker (si existen)
if docker volume ls | grep -q trackmovil; then
    docker run --rm \
        -v trackmovil_data:/data \
        -v $BACKUP_DIR:/backup \
        alpine tar -czf /backup/volumes_$TIMESTAMP.tar.gz /data
fi

# Limpiar backups antiguos
find $BACKUP_DIR -name "*.tar.gz" -mtime +$RETENTION_DAYS -delete

echo "✓ Backup completado: $BACKUP_DIR"
ls -lh $BACKUP_DIR | tail -5
