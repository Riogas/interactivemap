# ⚡ INICIO RÁPIDO - TrackMovil

## 🚀 Para Iniciar Todo (2 comandos)

### Terminal 1 - API AS400:
```powershell
cd as400-api
python api_as400.py
```

### Terminal 2 - Next.js:
```powershell
pnpm dev
```

### Abrir en Navegador:
- **Aplicación:** http://localhost:3001
- **API Docs:** http://localhost:8000/docs
- **Health Check:** http://localhost:8000/health

---

## 📋 Comandos Útiles

### Probar API desde PowerShell:
```powershell
# Health check
Invoke-RestMethod http://localhost:8000/health

# Obtener coordenadas
Invoke-RestMethod "http://localhost:8000/coordinates?movilId=693&startDate=2025-10-14&limit=5"
```

### Ver logs de Next.js:
```powershell
# La terminal donde corre pnpm dev mostrará:
# 🔵 Using MOCK data    ← Si está en modo mock
# 🔴 Fetching from API  ← Si está usando datos reales
```

### Reinstalar dependencias Python:
```powershell
cd as400-api
python -m pip install -r requirements.txt
```

### Limpiar y reconstruir Next.js:
```powershell
Remove-Item -Recurse -Force .next
pnpm dev
```

---

## 🔄 Cambiar entre Mock y Real

### Usar datos REALES (actual):
```env
# .env.local
DB_MODE=real
EXTERNAL_API_URL=http://localhost:8000
```

### Usar datos MOCK (desarrollo):
```env
# .env.local
DB_MODE=mock
# EXTERNAL_API_URL=http://localhost:8000  (comentar)
```

Después de cambiar `.env.local`, reinicia Next.js (Ctrl+C y `pnpm dev`)

---

## 📊 Verificación Rápida

```powershell
# 1. ¿Está corriendo la API?
netstat -ano | findstr :8000

# 2. ¿Está corriendo Next.js?
netstat -ano | findstr :3001

# 3. Probar API
curl http://localhost:8000/health

# 4. Ver procesos Python
Get-Process python
```

---

## 🛑 Detener Todo

En cada terminal presiona: **Ctrl+C**

O si quieres forzar:
```powershell
# Detener procesos Python
Stop-Process -Name python -Force

# Detener procesos Node
Stop-Process -Name node -Force
```

---

## 🎯 URLs Importantes

| Servicio | URL | Descripción |
|----------|-----|-------------|
| **Frontend** | http://localhost:3001 | Aplicación Next.js con mapa |
| **API Docs** | http://localhost:8000/docs | Swagger UI interactivo |
| **API ReDoc** | http://localhost:8000/redoc | Documentación alternativa |
| **Health** | http://localhost:8000/health | Estado de conexión AS400 |

---

## 🔍 Debug Rápido

### Ver logs en tiempo real:

**API:**
```powershell
cd as400-api
python api_as400.py
# Verás logs de cada request:
# INFO:__main__:🔵 Conectando a AS400...
# INFO:__main__:✅ Conexión exitosa
```

**Next.js:**
```powershell
pnpm dev
# Verás en consola:
# 🔵 Using MOCK data (si está en mock)
# 🔴 Fetching from: http://localhost:8000/coordinates... (si está en real)
```

---

## ✅ Checklist Primera Vez

- [x] Python 3.13.0 instalado
- [x] Java 21 instalado
- [x] Driver jt400.jar descargado
- [x] Dependencias Python instaladas
- [x] API configurada (as400-api/.env)
- [x] Next.js configurado (.env.local con DB_MODE=real)
- [ ] **¡SOLO FALTA INICIAR!** 👇

```powershell
# Terminal 1
cd as400-api
python api_as400.py

# Terminal 2 (nueva ventana)
pnpm dev

# Navegador
http://localhost:3001
```

---

**¡Listo para trabajar con datos REALES de AS400!** 🎉
