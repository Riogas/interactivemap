#!/bin/bash
# Script para monitorear conexiones y rendimiento de Track con 100+ móviles

echo "📊 MONITOR DE TRACK - ALTA CARGA (100+ móviles)"
echo "═══════════════════════════════════════════════════════════"
echo "Presiona Ctrl+C para salir"
echo ""

while true; do
  clear
  echo "📊 MONITOR DE TRACK - $(date '+%Y-%m-%d %H:%M:%S')"
  echo "═══════════════════════════════════════════════════════════"
  echo ""
  
  # 1. Estado de PM2
  echo "1️⃣ ESTADO PM2"
  echo "─────────────────────────────────────────────────────────────"
  pm2 jlist 2>/dev/null | jq -r '.[] | select(.name=="track") | 
    "🟢 Status: \(.pm2_env.status)
    ⏱️  Uptime: \(.pm2_env.pm_uptime_format)
    🔄 Restarts: \(.pm2_env.restart_time)
    💾 Memory: \((.monit.memory / 1024 / 1024 | floor))MB / 2048MB
    🔥 CPU: \(.monit.cpu)%"' 2>/dev/null || echo "Error al obtener info de PM2"
  echo ""
  
  # 2. Conexiones a Supabase
  echo "2️⃣ CONEXIONES ACTIVAS"
  echo "─────────────────────────────────────────────────────────────"
  TRACK_PID=$(pm2 pid track 2>/dev/null)
  if [ ! -z "$TRACK_PID" ] && [ "$TRACK_PID" != "0" ]; then
    # Conexiones totales
    TOTAL_CONN=$(lsof -p $TRACK_PID 2>/dev/null | grep -E "ESTABLISHED|CLOSE_WAIT|TIME_WAIT" | wc -l)
    
    # Por estado
    ESTABLISHED=$(lsof -p $TRACK_PID 2>/dev/null | grep ESTABLISHED | wc -l)
    CLOSE_WAIT=$(lsof -p $TRACK_PID 2>/dev/null | grep CLOSE_WAIT | wc -l)
    TIME_WAIT=$(lsof -p $TRACK_PID 2>/dev/null | grep TIME_WAIT | wc -l)
    
    # Conexiones a Supabase
    SUPABASE_CONN=$(lsof -p $TRACK_PID 2>/dev/null | grep -i supabase | wc -l)
    
    echo "🌐 Total: $TOTAL_CONN conexiones"
    echo "✅ ESTABLISHED: $ESTABLISHED (activas)"
    echo "⚠️  CLOSE_WAIT: $CLOSE_WAIT (clientes desconectados)"
    echo "⏳ TIME_WAIT: $TIME_WAIT (cerrando)"
    echo "🗄️  Supabase: $SUPABASE_CONN conexiones"
    
    # Alertas
    if [ $CLOSE_WAIT -gt 50 ]; then
      echo "🚨 ALERTA: CLOSE_WAIT > 50 (posible leak)"
    fi
    
    if [ $ESTABLISHED -gt 200 ]; then
      echo "🚨 ALERTA: Demasiadas conexiones activas"
    fi
  else
    echo "❌ Track no está corriendo"
  fi
  echo ""
  
  # 3. File Descriptors
  echo "3️⃣ FILE DESCRIPTORS"
  echo "─────────────────────────────────────────────────────────────"
  if [ ! -z "$TRACK_PID" ] && [ "$TRACK_PID" != "0" ]; then
    FD_COUNT=$(lsof -p $TRACK_PID 2>/dev/null | wc -l)
    FD_LIMIT=$(ulimit -n)
    FD_PERCENT=$((FD_COUNT * 100 / FD_LIMIT))
    
    echo "📂 Uso: $FD_COUNT / $FD_LIMIT ($FD_PERCENT%)"
    
    if [ $FD_PERCENT -gt 80 ]; then
      echo "🚨 ALERTA: File descriptors > 80%"
      echo "   Ejecutar: ulimit -n 65536"
    fi
  fi
  echo ""
  
  # 4. Logs recientes (últimos 10)
  echo "4️⃣ ACTIVIDAD RECIENTE (últimos 10 segundos)"
  echo "─────────────────────────────────────────────────────────────"
  
  # Contar batches GPS
  GPS_BATCHES=$(pm2 logs track --nostream --lines 100 2>/dev/null | \
    grep -c "Batch insertado exitosamente" || echo "0")
  
  # Contar errores
  GPS_ERRORS=$(pm2 logs track --nostream --lines 100 2>/dev/null | \
    grep -c "ERROR AL INSERTAR BATCH" || echo "0")
  
  # Último batch exitoso
  LAST_BATCH=$(pm2 logs track --nostream --lines 100 2>/dev/null | \
    grep "Batch insertado" | tail -1 | sed 's/.*Registros: //' || echo "N/A")
  
  echo "✅ Batches exitosos: $GPS_BATCHES"
  echo "❌ Errores: $GPS_ERRORS"
  echo "📦 Último batch: $LAST_BATCH registros"
  echo ""
  
  # 5. Conexiones por puerto
  echo "5️⃣ CONEXIONES AL PUERTO 3002"
  echo "─────────────────────────────────────────────────────────────"
  PORT_CONN=$(ss -tn 2>/dev/null | grep :3002 | wc -l || netstat -tn 2>/dev/null | grep :3002 | wc -l)
  echo "🔌 Conexiones entrantes: $PORT_CONN"
  echo ""
  
  # 6. Throughput estimado
  echo "6️⃣ THROUGHPUT GPS"
  echo "─────────────────────────────────────────────────────────────"
  # Calcular coordenadas por minuto basado en logs
  COORDS_MIN=$(pm2 logs track --nostream --lines 500 2>/dev/null | \
    grep "GPS agregado a cola" | \
    tail -100 | wc -l || echo "0")
  
  echo "📍 ~$COORDS_MIN coordenadas/min (últimas 100 líneas)"
  echo "💾 Batches estimados/min: $((COORDS_MIN / 50)) (cada 50 coords)"
  echo ""
  
  # 7. Sistema
  echo "7️⃣ RECURSOS DEL SISTEMA"
  echo "─────────────────────────────────────────────────────────────"
  FREE_MEM=$(free -h 2>/dev/null | awk 'NR==2{print $7}' || echo "N/A")
  CPU_LOAD=$(uptime | awk -F'load average:' '{print $2}' | awk '{print $1}')
  echo "💾 Memoria libre: $FREE_MEM"
  echo "🔥 Load average: $CPU_LOAD"
  echo ""
  
  echo "═══════════════════════════════════════════════════════════"
  echo "Actualizando en 5 segundos... (Ctrl+C para salir)"
  sleep 5
done
