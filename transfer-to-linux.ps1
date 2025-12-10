# Script para transferir imagen Docker a servidor Linux

# === CONFIGURACIÓN ===
$serverUser = "usuario"          # 👈 Cambia esto
$serverIP = "192.168.1.100"      # 👈 Cambia esto
$remotePath = "/home/usuario/"   # 👈 Cambia esto

Write-Host "🚀 Iniciando transferencia de imagen Docker a Linux..." -ForegroundColor Green

# Verificar que existe el archivo
if (-not (Test-Path "trackmovil.zip")) {
    Write-Host "❌ Error: No se encuentra trackmovil.zip" -ForegroundColor Red
    exit 1
}

$fileSize = [math]::Round((Get-Item "trackmovil.zip").Length/1MB, 2)
Write-Host "📦 Archivo a transferir: trackmovil.zip ($fileSize MB)" -ForegroundColor Cyan

# Opción 1: Usar SCP (más simple)
Write-Host "`n📤 Transfiriendo con SCP..." -ForegroundColor Yellow
scp trackmovil.zip "${serverUser}@${serverIP}:${remotePath}"

if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Transferencia completada exitosamente!" -ForegroundColor Green
    Write-Host "`n📋 Próximos pasos en el servidor Linux:" -ForegroundColor Cyan
    Write-Host "ssh ${serverUser}@${serverIP}" -ForegroundColor White
    Write-Host "cd ${remotePath}" -ForegroundColor White
    Write-Host "unzip trackmovil.zip" -ForegroundColor White
    Write-Host "docker load -i trackmovil.tar" -ForegroundColor White
    Write-Host "docker run -d --name trackmovil -p 3000:3000 --env-file .env trackmovil:latest" -ForegroundColor White
} else {
    Write-Host "❌ Error en la transferencia" -ForegroundColor Red
    Write-Host "`n💡 Alternativas:" -ForegroundColor Yellow
    Write-Host "1. Usa WinSCP: https://winscp.net/" -ForegroundColor White
    Write-Host "2. Usa FileZilla: https://filezilla-project.org/" -ForegroundColor White
}
