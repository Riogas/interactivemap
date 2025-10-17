# Script para iniciar la API de AS400
Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  TrackMovil AS400 API - Iniciando..." -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# Cambiar al directorio de la API
Set-Location $PSScriptRoot

# Verificar que existe jt400.jar
if (-not (Test-Path "jt400.jar")) {
    Write-Host "❌ ERROR: No se encontro jt400.jar" -ForegroundColor Red
    Write-Host ""
    Write-Host "Descarga el archivo desde:" -ForegroundColor Yellow
    Write-Host "https://repo1.maven.org/maven2/net/sf/jt400/jt400/20.0.7/jt400-20.0.7.jar" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Y renombralo a 'jt400.jar' en esta carpeta" -ForegroundColor Yellow
    Write-Host ""
    Read-Host "Presiona Enter para salir"
    exit 1
}

# Verificar que Python esta instalado
try {
    $pythonVersion = python --version 2>&1
    Write-Host "✅ Python encontrado: $pythonVersion" -ForegroundColor Green
} catch {
    Write-Host "❌ ERROR: Python no esta instalado" -ForegroundColor Red
    Read-Host "Presiona Enter para salir"
    exit 1
}

# Verificar que Java esta instalado
try {
    $javaVersion = java -version 2>&1 | Select-Object -First 1
    Write-Host "✅ Java encontrado: $javaVersion" -ForegroundColor Green
} catch {
    Write-Host "❌ ERROR: Java no esta instalado" -ForegroundColor Red
    Write-Host "Descarga e instala Java desde: https://adoptium.net/" -ForegroundColor Yellow
    Read-Host "Presiona Enter para salir"
    exit 1
}

Write-Host ""
Write-Host "🚀 Iniciando API en puerto 8000..." -ForegroundColor Cyan
Write-Host "📍 Documentacion: http://localhost:8000/docs" -ForegroundColor Yellow
Write-Host "🏥 Health Check: http://localhost:8000/health" -ForegroundColor Yellow
Write-Host ""
Write-Host "Presiona Ctrl+C para detener el servidor" -ForegroundColor Gray
Write-Host ""

# Iniciar la API
python api_as400.py
