#!/bin/bash
# Script de análisis forense post-ataque pnscan

echo "🔍 ANÁLISIS FORENSE - ATAQUE PNSCAN"
echo "═══════════════════════════════════════════════════════════"
echo ""

# 1. Logs de autenticación (SSH, login)
echo "1️⃣ INTENTOS DE LOGIN SOSPECHOSOS"
echo "─────────────────────────────────────────────────────────────"
echo "Últimos logins exitosos:"
last -a | head -20
echo ""

echo "Logins SSH recientes:"
grep "Accepted" /var/log/auth.log* | tail -20
echo ""

echo "Intentos de login fallidos (últimos 50):"
grep "Failed password" /var/log/auth.log* | tail -50
echo ""

echo "Logins desde IPs inusuales:"
grep "Accepted" /var/log/auth.log* | awk '{print $11}' | sort | uniq -c | sort -rn
echo ""

# 2. SSH Keys autorizadas
echo "2️⃣ SSH KEYS AUTORIZADAS"
echo "─────────────────────────────────────────────────────────────"
echo "Keys en /root/.ssh/authorized_keys:"
if [ -f /root/.ssh/authorized_keys ]; then
  cat /root/.ssh/authorized_keys
else
  echo "No existe"
fi
echo ""

echo "Keys en usuarios del sistema:"
for user_home in /home/*; do
  if [ -f "$user_home/.ssh/authorized_keys" ]; then
    echo "Usuario: $(basename $user_home)"
    cat "$user_home/.ssh/authorized_keys"
    echo ""
  fi
done
echo ""

# 3. Usuarios del sistema
echo "3️⃣ USUARIOS DEL SISTEMA"
echo "─────────────────────────────────────────────────────────────"
echo "Usuarios con shell (posibles backdoors):"
grep -v "nologin\|false" /etc/passwd | grep -v "^#"
echo ""

echo "Usuarios creados recientemente (últimos 7 días):"
find /home -maxdepth 1 -type d -mtime -7 -ls
echo ""

# 4. Procesos sospechosos actuales
echo "4️⃣ PROCESOS SOSPECHOSOS ACTUALES"
echo "─────────────────────────────────────────────────────────────"
echo "Procesos con nombres sospechosos:"
ps aux | grep -E "scan|miner|crypto|xmr|bot|flood|ddos" | grep -v grep
echo ""

# 5. Conexiones de red salientes actuales
echo "5️⃣ CONEXIONES SALIENTES ACTUALES"
echo "─────────────────────────────────────────────────────────────"
echo "Top 10 IPs de destino:"
ss -tn state established | awk '{print $4}' | cut -d: -f1 | sort | uniq -c | sort -rn | head -10
echo ""

echo "Puertos destino inusuales:"
ss -tn | awk '{print $4}' | grep -v "Address" | cut -d: -f2 | sort | uniq -c | sort -rn | head -20
echo ""

# 6. Archivos modificados recientemente
echo "6️⃣ ARCHIVOS MODIFICADOS (últimas 48 horas)"
echo "─────────────────────────────────────────────────────────────"
echo "En /tmp (común para malware):"
find /tmp -type f -mtime -2 -ls 2>/dev/null | head -20
echo ""

echo "Binarios en ubicaciones inusuales:"
find /tmp /var/tmp /dev/shm -type f -executable -mtime -7 -ls 2>/dev/null
echo ""

echo "Archivos en /root modificados recientemente:"
find /root -type f -mtime -2 -ls 2>/dev/null | head -20
echo ""

# 7. Cron jobs de todos los usuarios
echo "7️⃣ CRON JOBS (posible persistencia)"
echo "─────────────────────────────────────────────────────────────"
echo "Crontab de root:"
crontab -l 2>/dev/null || echo "Sin crontab"
echo ""

echo "Crontabs de usuarios:"
for user in $(cut -f1 -d: /etc/passwd); do
  CRON=$(crontab -u $user -l 2>/dev/null)
  if [ ! -z "$CRON" ]; then
    echo "=== Usuario: $user ==="
    echo "$CRON"
    echo ""
  fi
done
echo ""

echo "Archivos en /etc/cron.*:"
ls -la /etc/cron.hourly/ /etc/cron.daily/ /etc/cron.weekly/ /etc/cron.d/ 2>/dev/null
echo ""

# 8. Servicios systemd sospechosos
echo "8️⃣ SERVICIOS SYSTEMD SOSPECHOSOS"
echo "─────────────────────────────────────────────────────────────"
echo "Servicios habilitados creados recientemente:"
find /etc/systemd/system -type f -mtime -7 -ls 2>/dev/null
echo ""

echo "Servicios con nombres sospechosos:"
systemctl list-units --all | grep -E "scan|miner|crypto|bot|flood"
echo ""

# 9. Historial de comandos
echo "9️⃣ HISTORIAL DE COMANDOS SOSPECHOSOS"
echo "─────────────────────────────────────────────────────────────"
echo "Comandos de instalación en /root/.bash_history:"
grep -E "wget|curl|apt install|dpkg|chmod|chown|mv /tmp" /root/.bash_history 2>/dev/null | tail -50
echo ""

echo "Historial de otros usuarios:"
for user_home in /home/*; do
  if [ -f "$user_home/.bash_history" ]; then
    echo "=== $(basename $user_home) ==="
    grep -E "wget|curl|git clone|chmod|sudo" "$user_home/.bash_history" 2>/dev/null | tail -20
    echo ""
  fi
done
echo ""

# 10. Paquetes instalados recientemente
echo "🔟 PAQUETES INSTALADOS (últimos 7 días)"
echo "─────────────────────────────────────────────────────────────"
grep " install " /var/log/dpkg.log* | grep "2026-" | tail -30
echo ""

# 11. Logs del sistema (errores críticos)
echo "1️⃣1️⃣ ERRORES CRÍTICOS EN LOGS"
echo "─────────────────────────────────────────────────────────────"
echo "Errores en syslog:"
grep -i "error\|critical\|fatal" /var/log/syslog | tail -20
echo ""

echo "Kernel messages sospechosos:"
dmesg | grep -i "error\|segfault\|killed" | tail -20
echo ""

# 12. Puertos abiertos
echo "1️⃣2️⃣ PUERTOS ABIERTOS (posibles backdoors)"
echo "─────────────────────────────────────────────────────────────"
ss -tulpn | grep LISTEN
echo ""

# 13. Verificar integridad de binarios críticos
echo "1️⃣3️⃣ INTEGRIDAD DE BINARIOS CRÍTICOS"
echo "─────────────────────────────────────────────────────────────"
echo "Verificando si binarios fueron modificados:"
for binary in /usr/bin/ssh /usr/sbin/sshd /bin/bash /usr/bin/sudo; do
  if [ -f "$binary" ]; then
    echo "$binary: $(stat -c '%y' $binary)"
  fi
done
echo ""

# 14. Archivos .hidden o inusuales
echo "1️⃣4️⃣ ARCHIVOS OCULTOS SOSPECHOSOS"
echo "─────────────────────────────────────────────────────────────"
echo "Archivos ocultos en /tmp:"
ls -la /tmp/.[a-zA-Z]* 2>/dev/null
echo ""

echo "Archivos ocultos en /var/tmp:"
ls -la /var/tmp/.[a-zA-Z]* 2>/dev/null
echo ""

# 15. Búsqueda de pnscan y variantes
echo "1️⃣5️⃣ BÚSQUEDA DE MALWARE (pnscan y variantes)"
echo "─────────────────────────────────────────────────────────────"
echo "Buscando binarios relacionados con scanning:"
find / -name "*scan*" -type f -executable 2>/dev/null | grep -v "/usr/share\|/usr/lib"
echo ""

echo "Archivos con 'pnscan' en el nombre:"
find / -name "*pnscan*" 2>/dev/null
echo ""

echo "Scripts descargados de internet recientemente:"
find / -type f -name "*.sh" -mtime -7 2>/dev/null | grep -v "/usr\|/opt\|/var/lib"
echo ""

# 16. Firewall y reglas de red
echo "1️⃣6️⃣ CONFIGURACIÓN DE FIREWALL"
echo "─────────────────────────────────────────────────────────────"
echo "Reglas de iptables:"
iptables -L -n -v | head -30
echo ""

echo "UFW status:"
ufw status 2>/dev/null || echo "UFW no instalado"
echo ""

# 17. Aplicaciones web vulnerables
echo "1️⃣7️⃣ APLICACIONES WEB (posible vector)"
echo "─────────────────────────────────────────────────────────────"
echo "Nginx/Apache logs - últimas peticiones sospechosas:"
if [ -f /var/log/nginx/access.log ]; then
  echo "Nginx - IPs con más requests:"
  awk '{print $1}' /var/log/nginx/access.log 2>/dev/null | sort | uniq -c | sort -rn | head -10
  echo ""
  
  echo "Nginx - Paths sospechosos (últimos):"
  grep -E "\.php|shell|cmd|exec|eval|base64" /var/log/nginx/access.log 2>/dev/null | tail -20
fi
echo ""

# 18. Docker (si existe)
echo "1️⃣8️⃣ CONTENEDORES DOCKER (si existen)"
echo "─────────────────────────────────────────────────────────────"
if command -v docker &> /dev/null; then
  docker ps -a
  echo ""
  echo "Imágenes Docker:"
  docker images
else
  echo "Docker no instalado"
fi
echo ""

echo "═══════════════════════════════════════════════════════════"
echo "✅ ANÁLISIS FORENSE COMPLETADO"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "💡 VECTORES DE ATAQUE COMUNES:"
echo ""
echo "1. SSH con contraseña débil"
echo "   → Revisar: Logins desde IPs inusuales"
echo "   → Acción: Cambiar contraseñas, deshabilitar password auth"
echo ""
echo "2. Vulnerabilidad en aplicación web"
echo "   → Revisar: Nginx logs con paths sospechosos"
echo "   → Acción: Actualizar apps, validar inputs"
echo ""
echo "3. Clave SSH comprometida"
echo "   → Revisar: authorized_keys de root y usuarios"
echo "   → Acción: Regenerar keys, revocar antiguas"
echo ""
echo "4. Exploit de servicio expuesto"
echo "   → Revisar: Puertos abiertos inusuales"
echo "   → Acción: Cerrar puertos innecesarios"
echo ""
echo "5. Escalación de privilegios"
echo "   → Revisar: Usuarios nuevos, comandos sudo"
echo "   → Acción: Auditar permisos, actualizar kernel"
echo ""
