# ✅ TrackMovil - Configuración Completa

## 🎉 ¡Todo Está Listo!

Tu aplicación TrackMovil ahora tiene:

- ✅ **API REST Python** en `as400-api/` (puerto 8000)
- ✅ **Next.js Frontend** en raíz (puerto 3001)
- ✅ **Driver JT400** descargado (jt400.jar)
- ✅ **Dependencias Python** instaladas
- ✅ **Configuración** para usar datos reales

---

## 🚀 Cómo Usar

### Opción A: Scripts Automatizados (RECOMENDADO)

#### 1. Inicia la API AS400:

**Doble click en:**
```
as400-api\start-api.bat
```

O desde PowerShell:
```powershell
cd as400-api
.\start-api.ps1
```

Deberías ver:
```
🚀 Iniciando TrackMovil AS400 API...
📍 Host: jdbc:as400://192.168.1.8
👤 Usuario: qsecofr
📂 Schema: GXICAGEO
INFO:     Uvicorn running on http://0.0.0.0:8000
```

✅ **Deja esta ventana abierta** (la API debe estar corriendo)

#### 2. En OTRA terminal PowerShell, inicia Next.js:

```powershell
cd C:\Users\jgomez\Documents\Projects\trackmovil
pnpm dev
```

#### 3. Abre tu navegador:

**Frontend:** http://localhost:3001  
**API Docs:** http://localhost:8000/docs

---

### Opción B: Manual (Avanzado)

#### Terminal 1 - API:
```powershell
cd C:\Users\jgomez\Documents\Projects\trackmovil\as400-api
python api_as400.py
```

#### Terminal 2 - Next.js:
```powershell
cd C:\Users\jgomez\Documents\Projects\trackmovil
pnpm dev
```

---

## 🧪 Verificar que Funciona

### 1. Probar API:

Abre: http://localhost:8000/docs

Haz click en `/health` → **Try it out** → **Execute**

**Respuesta esperada:**
```json
{
  "status": "healthy",
  "database": "connected",
  "timestamp": "2025-10-14T15:30:00"
}
```

### 2. Probar Coordenadas:

En `/coordinates` ingresa:
- `movilId`: 693
- `startDate`: 2025-10-14
- `limit`: 10

**Ejecuta** y verás datos reales de AS400.

### 3. Ver Mapa:

Abre http://localhost:3001

Ahora verás:
- 🟢 Datos REALES (no mock)
- 🗺️ Posiciones de vehículos 693, 251, 337
- 🔄 Actualización automática cada 5 segundos

---

## 🔄 Flujo de Datos

```
AS400 DB2 (192.168.1.8)
    ↓
    │ JDBC (JT400)
    ↓
API Python (puerto 8000)
    ↓
    │ HTTP REST
    ↓
Next.js (puerto 3001)
    ↓
    │ React/Leaflet
    ↓
Tu Navegador 🗺️
```

---

## 📊 Endpoints de la API

| Endpoint | Descripción | Ejemplo |
|----------|-------------|---------|
| `/health` | Verificar conexión | `GET /health` |
| `/coordinates` | Coordenadas de 1 vehículo | `GET /coordinates?movilId=693&startDate=2025-10-14` |
| `/all-coordinates` | Múltiples vehículos | `GET /all-coordinates?startDate=2025-10-14&movilIds=693,251,337` |
| `/docs` | Documentación interactiva | http://localhost:8000/docs |

---

## 🛑 Detener los Servicios

### Detener la API:
En la terminal donde corre la API, presiona **Ctrl+C**

### Detener Next.js:
En la terminal donde corre Next.js, presiona **Ctrl+C**

---

## 🔧 Configuración

### API (as400-api/.env):
```env
DB_HOST=192.168.1.8
DB_USER=qsecofr
DB_PASSWORD=wwm868
DB_SCHEMA=GXICAGEO
JT400_JAR_PATH=./jt400.jar
```

### Next.js (.env.local):
```env
DB_MODE=real
EXTERNAL_API_URL=http://localhost:8000
```

---

## 🐛 Solución de Problemas

### "Connection refused" en API

**Causa:** AS400 no accesible o credenciales incorrectas

**Solución:**
```powershell
# Verificar conectividad
ping 192.168.1.8

# Verificar credenciales en as400-api/.env
```

### "Cannot connect to API" en Next.js

**Causa:** La API no está corriendo

**Solución:** Asegúrate que la API esté corriendo en puerto 8000

### Puerto en uso

**Si puerto 8000 está ocupado:**
Edita `as400-api/api_as400.py` línea final:
```python
uvicorn.run("api_as400:app", host="0.0.0.0", port=8001, ...)
```

Y actualiza `.env.local`:
```env
EXTERNAL_API_URL=http://localhost:8001
```

---

## 📁 Estructura del Proyecto

```
trackmovil/
├── as400-api/                    ← API Python
│   ├── api_as400.py             ← Código principal
│   ├── .env                     ← Config AS400
│   ├── requirements.txt         ← Dependencias
│   ├── jt400.jar               ← Driver JDBC
│   ├── start-api.bat           ← Iniciar (Windows)
│   ├── start-api.ps1           ← Iniciar (PowerShell)
│   ├── README.md               ← Documentación
│   └── INSTALACION_RAPIDA.md   ← Guía rápida
│
├── app/                         ← Next.js App Router
├── components/                  ← Componentes React
├── lib/                         ← Utilidades y DB
├── .env.local                  ← Config Next.js
├── package.json
└── CONFIGURACION_COMPLETA.md   ← Este archivo
```

---

## 📚 Documentación Adicional

- **Guía rápida:** `as400-api/INSTALACION_RAPIDA.md`
- **Documentación API:** `as400-api/README.md`
- **Soluciones AS400:** `SOLUCION_FINAL_AS400.md`

---

## ✨ Características

- ✅ Conexión real a AS400 DB2
- ✅ API REST con documentación automática (Swagger)
- ✅ Mapa interactivo con OpenStreetMap
- ✅ Tracking en tiempo real (auto-refresh 5s)
- ✅ Animaciones fluidas
- ✅ Diseño responsivo
- ✅ Logs detallados
- ✅ Manejo de errores robusto
- ✅ CORS configurado
- ✅ TypeScript + Python
- ✅ Hot reload en desarrollo

---

## 🎯 Próximos Pasos

1. ✅ Verifica que todo funciona con los pasos de prueba arriba
2. 🔒 Para producción, agrega autenticación a la API
3. 📊 Personaliza los endpoints según tus necesidades
4. 🚀 Deploy (recomendado: Azure App Service o AWS EC2)

---

## 🆘 Soporte

Si algo no funciona:

1. Verifica que Java está instalado: `java -version`
2. Verifica que Python está instalado: `python --version`
3. Verifica que jt400.jar existe en `as400-api/`
4. Verifica logs de la API en la terminal
5. Prueba el health check: http://localhost:8000/health

---

**¡Disfruta tu aplicación de tracking! 🚚🗺️**

**Versión:** 3.0.0  
**Última actualización:** Octubre 2025  
**Stack:** Next.js 15 + Python FastAPI + AS400 DB2
