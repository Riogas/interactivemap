#!/bin/bash
# Script de diagnóstico de conectividad de Track

echo "🔍 DIAGNÓSTICO DE CONECTIVIDAD - TRACK"
echo "═══════════════════════════════════════════════════════════"
echo ""

# 1. Estado de PM2
echo "1️⃣ ESTADO DE PM2 TRACK"
echo "─────────────────────────────────────────────────────────────"
pm2 show track | grep -E "(status|uptime|restarts|memory|cpu)"
echo ""

# 2. Puerto escuchando
echo "2️⃣ PUERTO 3002 (Track)"
echo "─────────────────────────────────────────────────────────────"
echo "¿Está Track escuchando en 3002?"
netstat -tlnp 2>/dev/null | grep 3002 || ss -tlnp 2>/dev/null | grep 3002
echo ""

# 3. Conexiones activas
echo "3️⃣ CONEXIONES ACTIVAS A TRACK"
echo "─────────────────────────────────────────────────────────────"
echo "Conexiones ESTABLISHED:"
netstat -anp 2>/dev/null | grep :3002 | grep ESTABLISHED | wc -l
echo ""
echo "Conexiones CLOSE_WAIT (clientes desconectados mal):"
netstat -anp 2>/dev/null | grep :3002 | grep CLOSE_WAIT | wc -l
echo ""
echo "Conexiones TIME_WAIT (normales):"
netstat -anp 2>/dev/null | grep :3002 | grep TIME_WAIT | wc -l
echo ""

# 4. Últimos errores de PM2
echo "4️⃣ ÚLTIMOS ERRORES EN LOGS (últimos 50)"
echo "─────────────────────────────────────────────────────────────"
pm2 logs track --err --lines 50 --nostream | grep -E "(Error|ERROR|error|refused|timeout|TIMEOUT|reset|RESET)" | tail -20
echo ""

# 5. Rechazos de conexión recientes
echo "5️⃣ RECHAZOS DE CONEXIÓN (últimos 5 min)"
echo "─────────────────────────────────────────────────────────────"
pm2 logs track --lines 500 --nostream | grep -E "(ECONNREFUSED|ECONNRESET|ETIMEDOUT|Connection refused)" | tail -10
echo ""

# 6. Firewall
echo "6️⃣ FIREWALL"
echo "─────────────────────────────────────────────────────────────"
echo "UFW status:"
sudo ufw status 2>/dev/null | head -5 || echo "UFW no instalado"
echo ""
echo "IPTables (puerto 3002):"
sudo iptables -L -n -v 2>/dev/null | grep 3002 || echo "Sin reglas específicas para 3002"
echo ""

# 7. Test local
echo "7️⃣ TEST DE CONECTIVIDAD LOCAL"
echo "─────────────────────────────────────────────────────────────"
echo "Probando http://localhost:3002 ..."
curl -s -o /dev/null -w "HTTP Status: %{http_code}\nTiempo: %{time_total}s\n" http://localhost:3002 2>&1 || echo "❌ Fallo al conectar localmente"
echo ""

# 8. Recursos del sistema
echo "8️⃣ RECURSOS DEL SISTEMA"
echo "─────────────────────────────────────────────────────────────"
echo "CPU y Memoria:"
top -bn1 | grep "Cpu(s)" | head -1
free -h | grep -E "(Mem|Swap)"
echo ""
echo "Procesos Node.js:"
ps aux | grep node | grep -v grep | wc -l
echo ""

# 9. Archivos abiertos (file descriptors)
echo "9️⃣ FILE DESCRIPTORS (Track)"
echo "─────────────────────────────────────────────────────────────"
TRACK_PID=$(pm2 pid track)
if [ ! -z "$TRACK_PID" ]; then
  echo "PID de Track: $TRACK_PID"
  ls /proc/$TRACK_PID/fd 2>/dev/null | wc -l || echo "No se pudo leer FDs"
  echo "Límite del sistema:"
  ulimit -n
else
  echo "❌ Track no está corriendo"
fi
echo ""

echo "═══════════════════════════════════════════════════════════"
echo "✅ DIAGNÓSTICO COMPLETO"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "💡 SIGUIENTES PASOS:"
echo ""
echo "Si Track NO escucha en 3002:"
echo "  pm2 restart track"
echo ""
echo "Si hay muchos CLOSE_WAIT (>100):"
echo "  pm2 restart track  # Liberar conexiones huérfanas"
echo ""
echo "Si firewall bloquea:"
echo "  sudo ufw allow 3002/tcp"
echo "  sudo iptables -I INPUT -p tcp --dport 3002 -j ACCEPT"
echo ""
echo "Para probar desde servidor remoto:"
echo "  curl -v http://192.168.7.13:3002/api/health"
echo "  nc -zv 192.168.7.13 3002"
echo ""
