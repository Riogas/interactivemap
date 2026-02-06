#!/bin/bash

# Script para probar la API de pedidos desde el servidor

echo "🧪 Probando API de pedidos..."
echo ""

# Test 1: Sin autenticación
echo "📡 Test 1: Llamada sin autenticación"
curl -v "http://localhost:3000/api/pedidos?escenario=1000&fecha=2026-02-06" 2>&1 | grep -E "(< HTTP|< Location|success|error|count)"
echo ""
echo "---"
echo ""

# Test 2: Verificar que el servidor esté corriendo
echo "📡 Test 2: Verificar servidor"
curl -s "http://localhost:3000/api/health" || echo "❌ Servidor no responde"
echo ""
echo "---"
echo ""

# Test 3: Verificar acceso directo a Supabase (necesitas las credenciales)
echo "📡 Test 3: Info de la petición"
echo "URL: http://localhost:3000/api/pedidos?escenario=1000&fecha=2026-02-06"
echo "Método: GET"
echo "Headers necesarios: Cookie de sesión"
echo ""

echo "✅ Para ver los pedidos necesitas:"
echo "1. Estar autenticado (cookie de sesión)"
echo "2. El servidor corriendo en localhost:3000"
echo "3. Supabase configurado correctamente"
