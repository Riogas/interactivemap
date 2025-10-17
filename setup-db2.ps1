# Script de configuración para TrackMovil
# Este script te ayuda a configurar la conexión a DB2 AS400

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "   TrackMovil - Configuración DB2 AS400    " -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# 1. Verificar driver ODBC
Write-Host "[1/5] Verificando driver ODBC..." -ForegroundColor Yellow
$odbcDrivers = Get-OdbcDriver | Where-Object { $_.Name -like "*IBM*" -or $_.Name -like "*iSeries*" }

if ($odbcDrivers) {
    Write-Host "✅ Driver ODBC encontrado:" -ForegroundColor Green
    $odbcDrivers | ForEach-Object { Write-Host "   - $($_.Name)" -ForegroundColor Gray }
} else {
    Write-Host "❌ No se encontró el driver IBM i Access ODBC" -ForegroundColor Red
    Write-Host ""
    Write-Host "Debes instalarlo desde:" -ForegroundColor Yellow
    Write-Host "https://www.ibm.com/support/pages/ibm-i-access-client-solutions" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Lee el archivo SETUP_DB2.md para más detalles" -ForegroundColor Yellow
    exit 1
}

# 2. Verificar conectividad
Write-Host ""
Write-Host "[2/5] Verificando conectividad al servidor..." -ForegroundColor Yellow
$serverIP = "192.168.1.8"

$ping = Test-Connection -ComputerName $serverIP -Count 2 -Quiet

if ($ping) {
    Write-Host "✅ Servidor $serverIP responde correctamente" -ForegroundColor Green
} else {
    Write-Host "❌ No se puede conectar a $serverIP" -ForegroundColor Red
    Write-Host ""
    Write-Host "Verifica:" -ForegroundColor Yellow
    Write-Host "  - Estás conectado a la red correcta" -ForegroundColor Gray
    Write-Host "  - VPN está activa (si es necesario)" -ForegroundColor Gray
    Write-Host "  - Firewall no está bloqueando" -ForegroundColor Gray
    Write-Host ""
    $continue = Read-Host "¿Deseas continuar de todas formas? (s/n)"
    if ($continue -ne "s") {
        exit 1
    }
}

# 3. Verificar archivo .env.local
Write-Host ""
Write-Host "[3/5] Verificando configuración..." -ForegroundColor Yellow

if (Test-Path ".env.local") {
    $envContent = Get-Content ".env.local" -Raw
    
    if ($envContent -match "DB_MODE=real") {
        Write-Host "✅ Modo configurado para DB real" -ForegroundColor Green
    } else {
        Write-Host "⚠️  Modo actual: MOCK (datos de prueba)" -ForegroundColor Yellow
        Write-Host ""
        $changeMode = Read-Host "¿Cambiar a modo REAL? (s/n)"
        
        if ($changeMode -eq "s") {
            $envContent = $envContent -replace "DB_MODE=mock", "DB_MODE=real"
            $envContent | Set-Content ".env.local" -NoNewline
            Write-Host "✅ Cambiado a modo REAL" -ForegroundColor Green
        }
    }
    
    if ($envContent -match "SYSTEM=192\.168\.1\.8") {
        Write-Host "✅ Servidor configurado correctamente" -ForegroundColor Green
    } else {
        Write-Host "⚠️  IP del servidor no coincide con 192.168.1.8" -ForegroundColor Yellow
    }
} else {
    Write-Host "❌ Archivo .env.local no encontrado" -ForegroundColor Red
    exit 1
}

# 4. Verificar y compilar módulo ODBC
Write-Host ""
Write-Host "[4/5] Compilando módulo ODBC..." -ForegroundColor Yellow
Write-Host "Esto puede tardar varios minutos..." -ForegroundColor Gray

try {
    $env:npm_config_loglevel = "error"
    pnpm rebuild odbc 2>&1 | Out-Null
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ Módulo ODBC compilado exitosamente" -ForegroundColor Green
    } else {
        Write-Host "⚠️  Advertencias durante la compilación" -ForegroundColor Yellow
        Write-Host "La aplicación puede funcionar de todas formas" -ForegroundColor Gray
    }
} catch {
    Write-Host "❌ Error compilando módulo ODBC" -ForegroundColor Red
    Write-Host ""
    Write-Host "Necesitas instalar herramientas de compilación:" -ForegroundColor Yellow
    Write-Host "  npm install --global windows-build-tools" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "O instalar Visual Studio Build Tools manualmente" -ForegroundColor Yellow
    Write-Host "Lee SETUP_DB2.md para más detalles" -ForegroundColor Gray
}

# 5. Instrucciones finales
Write-Host ""
Write-Host "[5/5] Configuración completada" -ForegroundColor Yellow
Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "   Próximos pasos:" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "1. Iniciar el servidor:" -ForegroundColor White
Write-Host "   pnpm dev" -ForegroundColor Cyan
Write-Host ""
Write-Host "2. Abrir en navegador:" -ForegroundColor White
Write-Host "   http://localhost:3000" -ForegroundColor Cyan
Write-Host ""
Write-Host "3. Verificar logs en la terminal para confirmar conexión" -ForegroundColor White
Write-Host ""
Write-Host "Si encuentras problemas, consulta: SETUP_DB2.md" -ForegroundColor Yellow
Write-Host ""
Write-Host "¡Buena suerte! 🚀" -ForegroundColor Green
Write-Host ""
