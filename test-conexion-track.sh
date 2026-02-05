#!/bin/bash
# Script para probar conectividad DESDE servidor Tomcat/NGINX HACIA Track

TRACK_HOST="192.168.7.13"  # Cambiar si es necesario
TRACK_PORT="3002"
TRACK_URL="http://${TRACK_HOST}:${TRACK_PORT}"

echo "🔍 TEST DE CONECTIVIDAD → TRACK"
echo "═══════════════════════════════════════════════════════════"
echo "Servidor Track: $TRACK_URL"
echo ""

# 1. Ping al servidor
echo "1️⃣ PING AL SERVIDOR TRACK"
echo "─────────────────────────────────────────────────────────────"
ping -c 4 $TRACK_HOST
echo ""

# 2. Test TCP con nc
echo "2️⃣ TEST TCP (Puerto $TRACK_PORT)"
echo "─────────────────────────────────────────────────────────────"
if command -v nc &> /dev/null; then
  timeout 5 nc -zv $TRACK_HOST $TRACK_PORT
else
  echo "nc no disponible, usando telnet..."
  timeout 5 telnet $TRACK_HOST $TRACK_PORT 2>&1 | head -3
fi
echo ""

# 3. Test HTTP con curl
echo "3️⃣ TEST HTTP (curl)"
echo "─────────────────────────────────────────────────────────────"
echo "Probando: $TRACK_URL"
curl -v -m 10 "$TRACK_URL" 2>&1 | grep -E "(Connected|HTTP|refused|timeout)"
echo ""

echo "Probando endpoint de salud: $TRACK_URL/api/health"
curl -s -m 10 -o /dev/null -w "Status: %{http_code} | Tiempo: %{time_total}s\n" "$TRACK_URL/api/health" 2>&1
echo ""

# 4. Test de múltiples requests
echo "4️⃣ TEST DE CARGA (10 requests)"
echo "─────────────────────────────────────────────────────────────"
SUCCESS=0
FAIL=0
for i in {1..10}; do
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -m 5 "$TRACK_URL/api/health" 2>&1)
  if [ "$HTTP_CODE" = "200" ]; then
    SUCCESS=$((SUCCESS + 1))
    echo "✅ Request $i: OK ($HTTP_CODE)"
  else
    FAIL=$((FAIL + 1))
    echo "❌ Request $i: FAIL ($HTTP_CODE)"
  fi
  sleep 0.5
done
echo ""
echo "Resultados: $SUCCESS éxitos, $FAIL fallos"
echo ""

# 5. Ver configuración de NGINX local (si existe)
echo "5️⃣ CONFIGURACIÓN DE NGINX LOCAL"
echo "─────────────────────────────────────────────────────────────"
if [ -d "/etc/nginx" ]; then
  echo "Buscando configuración que apunte a Track..."
  grep -r "$TRACK_HOST" /etc/nginx/ 2>/dev/null | head -5 || echo "No se encontró configuración de Track"
else
  echo "NGINX no instalado en este servidor"
fi
echo ""

# 6. Ver logs de NGINX local (si existe)
echo "6️⃣ LOGS DE NGINX (últimos 20 errores)"
echo "─────────────────────────────────────────────────────────────"
if [ -f "/var/log/nginx/error.log" ]; then
  sudo tail -20 /var/log/nginx/error.log | grep -E "(track|$TRACK_HOST|upstream)" || echo "Sin errores recientes relacionados"
else
  echo "Logs de NGINX no encontrados"
fi
echo ""

# 7. Traceroute al servidor Track
echo "7️⃣ TRACEROUTE A TRACK"
echo "─────────────────────────────────────────────────────────────"
if command -v traceroute &> /dev/null; then
  traceroute -m 10 $TRACK_HOST 2>&1 | head -15
else
  echo "traceroute no disponible"
fi
echo ""

echo "═══════════════════════════════════════════════════════════"
echo "✅ TEST COMPLETADO"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "💡 INTERPRETACIÓN:"
echo ""
echo "Si Ping funciona pero TCP falla:"
echo "  → Firewall bloqueando puerto $TRACK_PORT"
echo ""
echo "Si TCP funciona pero HTTP falla:"
echo "  → Track no respondiendo (caído o saturado)"
echo ""
echo "Si funciona a veces:"
echo "  → Track reiniciándose o timeout muy bajo"
echo "  → Ver pm2 logs track --err en servidor Track"
echo ""
echo "Para probar desde aquí manualmente:"
echo "  curl -v $TRACK_URL/api/health"
echo ""
