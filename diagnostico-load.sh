#!/bin/bash
# Script para diagnosticar load average alto

echo "🔍 DIAGNÓSTICO DE LOAD AVERAGE ALTO"
echo "═══════════════════════════════════════════════════════════"
echo ""

# 1. Load average actual
echo "1️⃣ LOAD AVERAGE"
echo "─────────────────────────────────────────────────────────────"
uptime
echo ""
echo "Número de CPUs: $(nproc)"
echo ""

# 2. Procesos consumiendo más CPU
echo "2️⃣ TOP 10 PROCESOS POR CPU"
echo "─────────────────────────────────────────────────────────────"
ps aux --sort=-%cpu | head -11
echo ""

# 3. Procesos consumiendo más memoria
echo "3️⃣ TOP 10 PROCESOS POR MEMORIA"
echo "─────────────────────────────────────────────────────────────"
ps aux --sort=-%mem | head -11
echo ""

# 4. Procesos en estado D (I/O wait)
echo "4️⃣ PROCESOS EN I/O WAIT (Estado D)"
echo "─────────────────────────────────────────────────────────────"
IO_WAIT=$(ps aux | awk '$8 ~ /D/ {print $0}' | wc -l)
if [ $IO_WAIT -gt 0 ]; then
  ps aux | awk '$8 ~ /D/ {print $0}'
  echo ""
  echo "🚨 $IO_WAIT procesos esperando I/O (disco lento o saturado)"
else
  echo "✅ Sin procesos en I/O wait"
fi
echo ""

# 5. Uso de disco
echo "5️⃣ USO DE DISCO"
echo "─────────────────────────────────────────────────────────────"
df -h | grep -v tmpfs | grep -v loop
echo ""

# 6. I/O del disco
echo "6️⃣ I/O DEL DISCO (si iostat disponible)"
echo "─────────────────────────────────────────────────────────────"
if command -v iostat &> /dev/null; then
  iostat -x 1 2 | tail -n +4
else
  echo "iostat no disponible - instalar con: sudo apt install sysstat"
fi
echo ""

# 7. Procesos Node.js
echo "7️⃣ PROCESOS NODE.JS"
echo "─────────────────────────────────────────────────────────────"
ps aux | grep node | grep -v grep
echo ""

# 8. Procesos Zombie
echo "8️⃣ PROCESOS ZOMBIE"
echo "─────────────────────────────────────────────────────────────"
ZOMBIES=$(ps aux | awk '$8 ~ /Z/ {print $0}' | wc -l)
if [ $ZOMBIES -gt 0 ]; then
  ps aux | awk '$8 ~ /Z/ {print $0}'
  echo ""
  echo "🚨 $ZOMBIES procesos zombie detectados"
else
  echo "✅ Sin procesos zombie"
fi
echo ""

# 9. Memoria swap
echo "9️⃣ USO DE SWAP"
echo "─────────────────────────────────────────────────────────────"
free -h
SWAP_USED=$(free | awk '/Swap/ {print $3}')
if [ "$SWAP_USED" -gt 100000 ]; then
  echo "⚠️  Swap en uso (puede causar load alto por thrashing)"
fi
echo ""

echo "═══════════════════════════════════════════════════════════"
echo "💡 INTERPRETACIÓN"
echo "═══════════════════════════════════════════════════════════"
echo ""

CORES=$(nproc)
LOAD=$(uptime | awk -F'load average:' '{print $2}' | awk '{print $1}' | sed 's/,//')

# Calcular si load es alto
if (( $(echo "$LOAD > $CORES" | bc -l) )); then
  LOAD_RATIO=$(echo "scale=2; $LOAD / $CORES" | bc)
  echo "🚨 LOAD ALTO: $LOAD en $CORES cores (ratio: $LOAD_RATIO)"
  echo ""
  echo "Causas comunes:"
  echo "  1. Muchos procesos ejecutándose (ver TOP 10 CPU)"
  echo "  2. I/O wait alto (disco lento - ver estado D)"
  echo "  3. Swap en uso (thrashing - ver memoria)"
  echo "  4. Procesos zombie acumulados"
  echo ""
  echo "Acciones recomendadas:"
  echo "  - Identificar proceso pesado en TOP 10 CPU"
  echo "  - Si hay I/O wait: verificar disco (dmesg | grep -i error)"
  echo "  - Si hay swap: liberar memoria o aumentar RAM"
  echo "  - Si hay zombies: reiniciar proceso padre"
else
  echo "✅ LOAD NORMAL: $LOAD en $CORES cores"
fi
