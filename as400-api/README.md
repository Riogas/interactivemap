# 🚀 TrackMovil AS400 API

API REST en Python con FastAPI para conectar Next.js con base de datos AS400 DB2.

## 📋 Requisitos Previos

- ✅ **Python 3.8+** (tienes 3.13.0 instalado)
- ✅ **Java Runtime Environment (JRE)** - Necesario para el driver JT400
- 📦 **Driver JT400** (jt400.jar)

## 🔧 Instalación

### 1️⃣ Verificar Java

```powershell
java -version
```

Si no tienes Java instalado, descárgalo desde: https://adoptium.net/

### 2️⃣ Descargar Driver JT400

Descarga el archivo `jt400.jar` desde Maven:

**Opción A: Descarga directa**
```
https://repo1.maven.org/maven2/net/sf/jt400/jt400/20.0.7/jt400-20.0.7.jar
```

Renombra el archivo a `jt400.jar` y colócalo en la carpeta `as400-api/`

**Opción B: Usando curl (PowerShell)**
```powershell
cd as400-api
curl -o jt400.jar https://repo1.maven.org/maven2/net/sf/jt400/jt400/20.0.7/jt400-20.0.7.jar
```

### 3️⃣ Instalar Dependencias Python

```powershell
cd as400-api
python -m pip install -r requirements.txt
```

### 4️⃣ Configurar Variables de Entorno

Edita el archivo `.env` si necesitas cambiar alguna configuración:

```env
DB_HOST=192.168.1.8
DB_USER=qsecofr
DB_PASSWORD=wwm868
DB_SCHEMA=GXICAGEO
JT400_JAR_PATH=./jt400.jar
```

## 🚀 Ejecutar la API

```powershell
cd as400-api
python api_as400.py
```

La API estará disponible en: **http://localhost:8000**

## 📡 Endpoints Disponibles

### 1. Health Check
```http
GET http://localhost:8000/health
```

Verifica la conexión con AS400.

**Respuesta:**
```json
{
  "status": "healthy",
  "database": "connected",
  "timestamp": "2025-10-14T10:30:00"
}
```

### 2. Coordenadas de un Vehículo
```http
GET http://localhost:8000/coordinates?movilId=693&startDate=2025-10-14&limit=100
```

**Parámetros:**
- `movilId` (requerido): ID del vehículo (ej: 693, 251, 337)
- `startDate` (requerido): Fecha inicial en formato YYYY-MM-DD
- `limit` (opcional): Cantidad máxima de registros (default: 100, max: 1000)

**Respuesta:**
```json
{
  "success": true,
  "movilId": 693,
  "startDate": "2025-10-14",
  "count": 42,
  "data": [
    {
      "identificador": 693,
      "origen": "GPS",
      "coordx": -34.9011,
      "coordy": -56.1645,
      "fechainslog": "2025-10-14T10:30:00",
      "auxin2": "INFO",
      "distrecorrida": 12.5
    }
  ]
}
```

### 3. Coordenadas de Múltiples Vehículos
```http
GET http://localhost:8000/all-coordinates?startDate=2025-10-14&movilIds=693,251,337&limit=50
```

**Parámetros:**
- `startDate` (requerido): Fecha inicial
- `movilIds` (opcional): IDs separados por comas
- `limit` (opcional): Límite por vehículo

### 4. Documentación Interactiva

FastAPI genera documentación automática:

- **Swagger UI**: http://localhost:8000/docs
- **ReDoc**: http://localhost:8000/redoc

## 🔌 Conectar con Next.js

### Actualizar `.env.local` en Next.js:

```env
DB_MODE=real
EXTERNAL_API_URL=http://localhost:8000
```

### Reiniciar Next.js:

```powershell
cd ..
pnpm dev
```

¡Listo! Tu aplicación Next.js ahora está conectada a la base de datos real de AS400.

## 🧪 Probar la Conexión

### Desde PowerShell:

```powershell
# Health check
curl http://localhost:8000/health

# Obtener coordenadas
curl "http://localhost:8000/coordinates?movilId=693&startDate=2025-10-14&limit=10"
```

### Desde el navegador:

1. Abre: http://localhost:8000/docs
2. Prueba el endpoint `/health`
3. Prueba el endpoint `/coordinates` con tus parámetros

## 📊 Arquitectura

```
┌─────────────────┐
│   Next.js       │  Puerto 3001
│   (Frontend)    │
└────────┬────────┘
         │ HTTP
         ▼
┌─────────────────┐
│  FastAPI        │  Puerto 8000
│  (API REST)     │
└────────┬────────┘
         │ JDBC (JT400)
         ▼
┌─────────────────┐
│   AS400 DB2     │  192.168.1.8
│  (GXICAGEO)     │
└─────────────────┘
```

## 🐛 Troubleshooting

### Error: "jt400.jar not found"
**Solución:** Descarga el archivo jt400.jar y colócalo en la carpeta `as400-api/`

### Error: "Java not found"
**Solución:** Instala Java desde https://adoptium.net/

### Error: "Connection refused"
**Solución:** 
1. Verifica que el AS400 esté accesible: `ping 192.168.1.8`
2. Verifica credenciales en el archivo `.env`
3. Verifica que el puerto no esté bloqueado por firewall

### Error: "Module not found"
**Solución:** 
```powershell
python -m pip install -r requirements.txt
```

## 📝 Logs

La API muestra logs detallados:

```
🚀 Iniciando TrackMovil AS400 API...
📍 Host: jdbc:as400://192.168.1.8
👤 Usuario: qsecofr
📂 Schema: GXICAGEO
🔵 Conectando a AS400...
✅ Conexión exitosa a AS400
🔍 Ejecutando query...
✅ Query exitoso: 42 filas retornadas
```

## 🔒 Seguridad

⚠️ **IMPORTANTE:**

- **NO** subas el archivo `.env` a Git (ya está en `.gitignore`)
- **NO** expongas esta API públicamente sin autenticación
- Para producción, implementa:
  - Autenticación JWT
  - Rate limiting
  - HTTPS/TLS
  - Validación de inputs más estricta

## 📚 Dependencias

- **FastAPI**: Framework web moderno para APIs
- **Uvicorn**: Servidor ASGI de alto rendimiento
- **JayDeBeAPI**: Bridge entre Python y JDBC
- **JPype1**: Integración Python-Java
- **python-dotenv**: Manejo de variables de entorno

## 🎯 Próximos Pasos

1. ✅ Probar conexión con `/health`
2. ✅ Verificar datos con `/coordinates`
3. ✅ Configurar Next.js con `EXTERNAL_API_URL`
4. ✅ Verificar en http://localhost:3001 que muestre datos reales

---

**Autor**: TrackMovil Team  
**Versión**: 1.0.0  
**Última actualización**: Octubre 2025
