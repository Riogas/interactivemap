# 🎯 Guía Rápida de Instalación - TrackMovil AS400 API

## ⚡ Pasos Rápidos

### 1️⃣ Verificar Java (IMPORTANTE)

```powershell
java -version
```

**Si NO tienes Java:**
- Descarga e instala desde: https://adoptium.net/temurin/releases/?version=17
- Selecciona: **Windows x64, JRE, Latest Release**
- Instala y reinicia PowerShell

### 2️⃣ Descargar Driver JT400

```powershell
cd as400-api
curl -o jt400.jar https://repo1.maven.org/maven2/net/sf/jt400/jt400/20.0.7/jt400-20.0.7.jar
```

O descarga manualmente desde:
https://repo1.maven.org/maven2/net/sf/jt400/jt400/20.0.7/jt400-20.0.7.jar

### 3️⃣ Instalar Dependencias Python

```powershell
python -m pip install -r requirements.txt
```

### 4️⃣ Iniciar la API

```powershell
python api_as400.py
```

Deberías ver:
```
🚀 Iniciando TrackMovil AS400 API...
📍 Host: jdbc:as400://192.168.1.8
INFO:     Uvicorn running on http://0.0.0.0:8000
```

### 5️⃣ Probar Conexión

Abre un **nuevo PowerShell** y ejecuta:

```powershell
curl http://localhost:8000/health
```

**Si funciona**, verás:
```json
{
  "status": "healthy",
  "database": "connected",
  "timestamp": "2025-10-14T10:30:00"
}
```

### 6️⃣ Probar Datos Reales

```powershell
curl "http://localhost:8000/coordinates?movilId=693&startDate=2025-10-14&limit=5"
```

### 7️⃣ Abrir Next.js

En **otro PowerShell** (deja la API corriendo):

```powershell
cd ..
pnpm dev
```

Abre: http://localhost:3001

**¡Ahora verás datos REALES de AS400!** 🎉

---

## 🐛 Si algo falla...

### Error: "java: command not found"
**Solución:** Instala Java desde https://adoptium.net/

### Error: "jt400.jar not found"
**Solución:** Descarga el archivo y colócalo en `as400-api/jt400.jar`

### Error: "Connection refused"
**Solución:** Verifica que AS400 esté accesible:
```powershell
ping 192.168.1.8
```

### Error: "ModuleNotFoundError"
**Solución:** 
```powershell
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
```

---

## 📊 Estructura Final

```
trackmovil/
├── as400-api/              ← API Python (puerto 8000)
│   ├── api_as400.py
│   ├── requirements.txt
│   ├── .env
│   ├── jt400.jar          ← Descarga este archivo
│   └── README.md
│
├── app/                    ← Next.js (puerto 3001)
├── .env.local             ← Configurado con EXTERNAL_API_URL
└── package.json
```

---

## ✅ Checklist

- [ ] Java instalado (`java -version`)
- [ ] Archivo `jt400.jar` descargado en `as400-api/`
- [ ] Dependencias Python instaladas
- [ ] API corriendo en puerto 8000
- [ ] Health check exitoso
- [ ] Next.js corriendo en puerto 3001
- [ ] Ver datos reales en el mapa

---

**¡Listo para producción!** 🚀
