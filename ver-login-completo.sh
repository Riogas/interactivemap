#!/bin/bash
# Script para ver el flujo completo de login con todos los detalles

echo "🔍 Logs de Login Completo (últimos 500 líneas)"
echo "═══════════════════════════════════════════════════════════"
echo ""

# Ver login con contexto (3 líneas antes y después)
pm2 logs track --lines 500 | grep --color=always -A3 -B3 -E "(gestion/login|RespuestaLogin|Fetch completado|RETORNANDO AL CLIENTE|JSON\.parse)"

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "✅ Si ves 'RespuestaLogin parseado' → Login funcionando"
echo "❌ Si ves 'JSON.parse: unexpected' → Aún hay error"
echo "⏱️ Si ves 'Fetch completado en Xms' → Muestra tiempo de respuesta"
