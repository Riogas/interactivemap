#!/bin/bash
# Script para ver solo errores de PM2 Track

echo "🔴 ERRORES DE PM2 TRACK"
echo "═══════════════════════════════════════════════════════════"
echo ""

# Opción según parámetro
case "$1" in
  "gps")
    echo "📡 Errores de GPS Batch:"
    pm2 logs track --lines 500 | grep --color=always -E "(Error en intento|BATCH FALLIDO|TIMEOUT|fetch failed|Supabase error)"
    ;;
  
  "login")
    echo "🔐 Errores de Login:"
    pm2 logs track --lines 500 | grep -E "(login|Login|gestion/login)" | grep --color=always -E "(❌|Error|error|FAILED)"
    ;;
  
  "live")
    echo "🔴 Stream de Errores en Vivo (Ctrl+C para salir):"
    pm2 logs track --err
    ;;
  
  "stats")
    echo "📊 Estadísticas de Errores:"
    pm2 show track
    ;;
  
  *)
    echo "🔴 Últimos 100 Errores:"
    pm2 logs track --err --lines 100 | grep --color=always -E "(❌|Error|ERROR|TIMEOUT|FAILED|failed)"
    ;;
esac

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "💡 Uso:"
echo "  ./ver-errores.sh          - Últimos 100 errores"
echo "  ./ver-errores.sh gps      - Solo errores de GPS"
echo "  ./ver-errores.sh login    - Solo errores de login"
echo "  ./ver-errores.sh live     - Stream en vivo"
echo "  ./ver-errores.sh stats    - Estadísticas del proceso"
