#!/bin/bash
# Script para aumentar límite de file descriptors permanentemente

echo "🔧 AUMENTAR FILE DESCRIPTORS A 65536"
echo "═══════════════════════════════════════════════════════════"
echo ""

# 1. Ver límite actual
echo "📊 Límite actual:"
echo "  ulimit -n: $(ulimit -n)"
echo "  Para usuario actual: $(ulimit -Sn) (soft) / $(ulimit -Hn) (hard)"
echo ""

# 2. Aumentar temporalmente (solo sesión actual)
echo "1️⃣ Aumentando temporalmente para esta sesión..."
ulimit -n 65536 2>/dev/null && echo "  ✅ Límite temporal: $(ulimit -n)" || echo "  ❌ Error (requiere permisos)"
echo ""

# 3. Verificar si ya está configurado permanentemente
echo "2️⃣ Verificando configuración permanente..."
if grep -q "nofile 65536" /etc/security/limits.conf 2>/dev/null; then
  echo "  ✅ Ya está configurado en /etc/security/limits.conf"
else
  echo "  ⚠️  NO está configurado permanentemente"
  echo ""
  echo "Para hacerlo permanente, ejecutar como root:"
  echo ""
  echo "sudo tee -a /etc/security/limits.conf << 'EOF'"
  echo "*    soft nofile 65536"
  echo "*    hard nofile 65536"
  echo "root soft nofile 65536"
  echo "root hard nofile 65536"
  echo "EOF"
  echo ""
fi

# 4. Verificar sysctl
echo "3️⃣ Verificando límites del sistema (sysctl)..."
FS_FILE_MAX=$(sysctl -n fs.file-max 2>/dev/null || echo "N/A")
echo "  fs.file-max: $FS_FILE_MAX"

if [ "$FS_FILE_MAX" != "N/A" ] && [ "$FS_FILE_MAX" -lt 2097152 ]; then
  echo "  ⚠️  Límite del sistema bajo"
  echo ""
  echo "Para aumentar, ejecutar como root:"
  echo ""
  echo "sudo tee -a /etc/sysctl.conf << 'EOF'"
  echo "fs.file-max = 2097152"
  echo "fs.nr_open = 2097152"
  echo "EOF"
  echo ""
  echo "sudo sysctl -p"
else
  echo "  ✅ Límite del sistema OK"
fi
echo ""

# 5. Verificar PAM
echo "4️⃣ Verificando PAM (sesiones SSH/login)..."
if [ -f /etc/pam.d/common-session ]; then
  if grep -q "pam_limits.so" /etc/pam.d/common-session; then
    echo "  ✅ PAM configurado (límites se aplicarán en nuevas sesiones)"
  else
    echo "  ⚠️  PAM no configurado"
    echo ""
    echo "Para habilitar, ejecutar como root:"
    echo ""
    echo "echo 'session required pam_limits.so' | sudo tee -a /etc/pam.d/common-session"
  fi
else
  echo "  ℹ️  Sistema no usa PAM (normal en algunos entornos)"
fi
echo ""

# 6. Aplicar a PM2
echo "5️⃣ Aplicando a PM2..."
pm2 limit 2>/dev/null || echo "  ℹ️  Comando pm2 limit no disponible"

# Reload PM2 para aplicar nuevos límites
if pm2 list &>/dev/null; then
  echo "  🔄 Reloading PM2 track con nuevos límites..."
  pm2 reload track --update-env
  echo "  ✅ PM2 recargado"
fi
echo ""

# 7. Verificar Track
echo "6️⃣ Verificando Track..."
TRACK_PID=$(pm2 pid track 2>/dev/null)
if [ ! -z "$TRACK_PID" ] && [ "$TRACK_PID" != "0" ]; then
  TRACK_FD=$(lsof -p $TRACK_PID 2>/dev/null | wc -l)
  TRACK_LIMIT=$(cat /proc/$TRACK_PID/limits 2>/dev/null | grep "open files" | awk '{print $4}')
  
  echo "  PID Track: $TRACK_PID"
  echo "  FDs en uso: $TRACK_FD"
  echo "  Límite del proceso: $TRACK_LIMIT"
  
  if [ "$TRACK_LIMIT" -lt 65536 ]; then
    echo "  ⚠️  Track no tiene el límite aumentado"
    echo "  🔄 Reiniciando Track para aplicar..."
    pm2 restart track
    sleep 2
    TRACK_PID=$(pm2 pid track)
    TRACK_LIMIT=$(cat /proc/$TRACK_PID/limits 2>/dev/null | grep "open files" | awk '{print $4}')
    echo "  ✅ Nuevo límite: $TRACK_LIMIT"
  else
    echo "  ✅ Track tiene límite correcto"
  fi
else
  echo "  ❌ Track no está corriendo"
fi
echo ""

echo "═══════════════════════════════════════════════════════════"
echo "✅ COMPLETADO"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "💡 SIGUIENTE PASO:"
echo ""
echo "Si los límites NO se aplicaron automáticamente:"
echo ""
echo "1. Editar /etc/security/limits.conf (requiere root):"
echo "   sudo nano /etc/security/limits.conf"
echo ""
echo "2. Agregar al final:"
echo "   *    soft nofile 65536"
echo "   *    hard nofile 65536"
echo "   root soft nofile 65536"
echo "   root hard nofile 65536"
echo ""
echo "3. Cerrar sesión y volver a entrar (o reiniciar servidor)"
echo ""
echo "4. Verificar:"
echo "   ulimit -n  # Debe mostrar 65536"
echo ""
echo "5. Reiniciar Track:"
echo "   pm2 restart track"
echo ""
