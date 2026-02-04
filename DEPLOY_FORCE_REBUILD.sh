#!/bin/bash

# 🔧 Script de Deploy con Rebuild Completo
# Fuerza limpieza de caché y rebuild desde cero

echo "🛑 Deteniendo aplicación..."
pm2 stop track

echo "📥 Descargando últimos cambios..."
git pull origin main

echo "🧹 Limpiando caché de Node.js y build anterior..."
rm -rf .next
rm -rf node_modules/.cache

echo "📦 Reinstalando dependencias..."
pnpm install --force

echo "🏗️ Rebuilding aplicación..."
pnpm build

echo "🔄 Reiniciando aplicación..."
pm2 restart track

echo "✅ Deploy completo - Verificando logs..."
pm2 logs track --lines 30
