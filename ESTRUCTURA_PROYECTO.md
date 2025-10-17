# 📦 Estructura del Proyecto TrackMovil

## 🗂️ Árbol de Directorios

```
trackmovil/
│
├── 📁 app/                          # Next.js 15 App Router
│   ├── 📁 api/                      # API Routes (Backend)
│   │   ├── 📁 all-positions/        # GET todas las posiciones actuales
│   │   │   └── route.ts             # Endpoint: /api/all-positions
│   │   ├── 📁 coordinates/          # GET historial de coordenadas
│   │   │   └── route.ts             # Endpoint: /api/coordinates?movilId=X
│   │   └── 📁 latest/               # GET última posición de un móvil
│   │       └── route.ts             # Endpoint: /api/latest?movilId=X
│   │
│   ├── globals.css                  # Estilos globales + Tailwind + Leaflet
│   ├── layout.tsx                   # Layout principal (HTML wrapper)
│   └── page.tsx                     # Página principal (Dashboard)
│
├── 📁 components/                   # Componentes React
│   ├── 📁 map/                      # Componentes de mapas
│   │   └── MapView.tsx              # Mapa OpenStreetMap con Leaflet
│   └── 📁 ui/                       # Componentes de interfaz
│       ├── InfoPanel.tsx            # Panel de información en tiempo real
│       └── MovilSelector.tsx        # Selector de móviles
│
├── 📁 lib/                          # Servicios y utilidades
│   ├── db.ts                        # 🔑 Servicio DB2 AS400 (ODBC)
│   └── db.mock.ts                   # Datos mock para desarrollo
│
├── 📁 types/                        # Tipos TypeScript
│   └── index.ts                     # Interfaces y tipos globales
│
├── 📁 node_modules/                 # Dependencias (auto-generado)
│
├── .env.local                       # 🔐 Variables de entorno (DB config)
├── .gitignore                       # Archivos ignorados por Git
├── eslint.config.mjs                # Configuración ESLint
├── next.config.mjs                  # Configuración Next.js
├── package.json                     # Dependencias y scripts
├── pnpm-lock.yaml                   # Lock file de pnpm
├── tsconfig.json                    # Configuración TypeScript
│
├── 📄 README.md                     # Documentación principal
├── 📄 CONFIGURACION_REAL.md         # ⭐ Guía para datos reales DB2
├── 📄 SETUP_DB2.md                  # Guía detallada de setup DB2
└── 📄 setup-db2.ps1                 # 🤖 Script automático de configuración
```

---

## 📝 Descripción de Archivos Clave

### 🎯 Configuración

| Archivo | Descripción |
|---------|-------------|
| `.env.local` | **Configuración de base de datos**. Cambia `DB_MODE=mock` a `DB_MODE=real` para usar DB2 real |
| `next.config.mjs` | Configuración de Next.js (desactiva ESLint en build) |
| `tsconfig.json` | Configuración TypeScript con alias `@/*` |
| `package.json` | Dependencias del proyecto y scripts npm |

### 🗺️ Frontend (Componentes React)

| Archivo | Descripción | Características |
|---------|-------------|-----------------|
| `app/page.tsx` | **Dashboard principal** | - Gestión de estado<br>- Polling cada X segundos<br>- Layout responsivo |
| `components/map/MapView.tsx` | **Mapa interactivo** | - Leaflet + OpenStreetMap<br>- Marcadores animados<br>- Popups con info<br>- Auto-centrado |
| `components/ui/MovilSelector.tsx` | **Selector de móviles** | - Botones animados<br>- Filtro individual/todos<br>- Colores personalizados |
| `components/ui/InfoPanel.tsx` | **Panel de información** | - Datos en tiempo real<br>- Indicador "En vivo"<br>- Formato de fechas |

### 🔌 Backend (API Routes)

| Endpoint | Descripción | Parámetros |
|----------|-------------|------------|
| `/api/all-positions` | Obtiene posiciones actuales de todos los móviles | - |
| `/api/latest?movilId=X` | Obtiene última posición de un móvil | `movilId`: ID del móvil |
| `/api/coordinates?movilId=X&startDate=Y&limit=Z` | Obtiene historial de coordenadas | `movilId`: ID<br>`startDate`: opcional<br>`limit`: max resultados |

### 💾 Base de Datos

| Archivo | Descripción | Funciones |
|---------|-------------|-----------|
| `lib/db.ts` | **Servicio principal DB2** | - `getConnection()`<br>- `getMovilCoordinates()`<br>- `getLatestPosition()`<br>- `getAllMovilesLatestPositions()` |
| `lib/db.mock.ts` | **Datos de prueba** | - Genera coordenadas simuladas<br>- Usado cuando `DB_MODE=mock` |

### 📐 Tipos TypeScript

| Archivo | Contenido |
|---------|-----------|
| `types/index.ts` | - `MovilCoordinate`: estructura de datos DB<br>- `MovilData`: datos del móvil con UI<br>- `AVAILABLE_MOVILES`: lista de móviles (693, 251, 337) |

---

## 🚀 Scripts Disponibles

```bash
# Desarrollo (http://localhost:3000)
pnpm dev

# Build para producción
pnpm build

# Ejecutar en producción
pnpm start

# Linting
pnpm lint

# Compilar módulo ODBC
pnpm rebuild odbc
```

---

## 📦 Dependencias Principales

### Producción
```json
{
  "next": "15.5.5",              // Framework React
  "react": "19.1.0",             // Biblioteca UI
  "react-dom": "19.1.0",         // React DOM
  "leaflet": "1.9.4",            // Mapas
  "react-leaflet": "5.0.0",      // Leaflet para React
  "framer-motion": "12.23.24",   // Animaciones
  "odbc": "2.4.9",               // Conexión DB2
  "date-fns": "4.1.0",           // Manejo de fechas
  "clsx": "2.1.1"                // Utilidad CSS
}
```

### Desarrollo
```json
{
  "typescript": "5.9.3",         // TypeScript
  "tailwindcss": "4.1.14",       // Framework CSS
  "@types/leaflet": "1.9.21",    // Tipos Leaflet
  "eslint": "9.37.0",            // Linter
  "eslint-config-next": "15.5.5" // Config ESLint Next.js
}
```

---

## 🔧 Variables de Entorno (`.env.local`)

```env
# Modo de operación: 'mock' (datos de prueba) o 'real' (DB2 real)
DB_MODE=mock

# String de conexión ODBC a DB2 AS400
DB_CONNECTION_STRING=DRIVER={IBM i Access ODBC Driver};SYSTEM=192.168.1.8;UID=qsecofr;PWD=wwm668;

# Schema de la base de datos
DB_SCHEMA=GXICAGEO
```

---

## 🎨 Paleta de Colores

| Móvil | Color | Hex |
|-------|-------|-----|
| 693 | Azul | `#3b82f6` |
| 251 | Rojo | `#ef4444` |
| 337 | Verde | `#10b981` |

Personalizar en `types/index.ts` → `AVAILABLE_MOVILES`

---

## 🗺️ Coordenadas de Referencia

**Centro por defecto (Paraguay):**
- Latitud: -25.2637
- Longitud: -57.5759

---

## 🔄 Flujo de Datos

```
┌─────────────┐
│   Browser   │
│  (Cliente)  │
└──────┬──────┘
       │ HTTP GET /api/all-positions
       │ (cada 5 segundos)
       ▼
┌─────────────────────┐
│   Next.js Server    │
│  (API Route)        │
└──────┬──────────────┘
       │
       ├─ DB_MODE=mock ───► lib/db.mock.ts ──► Datos simulados
       │
       └─ DB_MODE=real ───► lib/db.ts ────────┐
                                               │
                                               ▼
                                        ┌──────────────┐
                                        │  DB2 AS400   │
                                        │ 192.168.1.8  │
                                        │              │
                                        │ GXICAGEO.    │
                                        │ LOGCOORDMOVIL│
                                        └──────────────┘
```

---

## 📊 Estructura de la Tabla DB2

```sql
GXICAGEO.LOGCOORDMOVIL
├── LOGCOORDMOVILIDENTIFICADOR  (INT)      -- ID del móvil
├── LOGCOORDMOVILORIGEN         (VARCHAR)  -- Fuente (GPS)
├── LOGCOORDMOVILCOORDX         (DECIMAL)  -- Longitud
├── LOGCOORDMOVILCOORDY         (DECIMAL)  -- Latitud
├── LOGCOORDMOVILFCHINSLOG      (TIMESTAMP)-- Fecha/hora
├── LOGCOORDMOVILAUXIN2         (VARCHAR)  -- Estado
└── LOGCOORDMOVILDISTRECORRIDA  (DECIMAL)  -- Distancia en km
```

---

## 🎯 Próximos Pasos para Usar Datos Reales

1. **Leer** → `CONFIGURACION_REAL.md`
2. **Ejecutar** → `.\setup-db2.ps1`
3. **Editar** → `.env.local` (cambiar `DB_MODE=real`)
4. **Compilar** → `pnpm rebuild odbc`
5. **Iniciar** → `pnpm dev`
6. **Verificar** → Logs en terminal

---

## 📚 Documentación Completa

| Archivo | Descripción |
|---------|-------------|
| `README.md` | Introducción y guía general |
| `CONFIGURACION_REAL.md` | **⭐ Guía paso a paso para datos reales** |
| `SETUP_DB2.md` | Solución de problemas detallada |
| `setup-db2.ps1` | Script automático de configuración |

---

## 🏗️ Arquitectura Técnica

- **Framework:** Next.js 15 (App Router)
- **Lenguaje:** TypeScript 5.9
- **UI:** React 19 + Tailwind CSS 4
- **Animaciones:** Framer Motion
- **Mapas:** Leaflet + React Leaflet
- **Base de datos:** DB2 AS400 (IBM i) via ODBC
- **Gestión de paquetes:** pnpm
- **Formato de código:** ESLint

---

## 🔐 Seguridad

⚠️ **IMPORTANTE:**
- `.env.local` contiene credenciales sensibles
- Este archivo NO debe estar en Git (ya está en `.gitignore`)
- Para producción: usar variables de entorno del servidor
- Implementar autenticación/autorización antes de desplegar

---

## 🎉 Resumen

✅ Aplicación completamente funcional  
✅ Modo mock (datos de prueba) activo por defecto  
✅ Lista para conectar a DB2 AS400 real  
✅ Diseño moderno y responsivo  
✅ Actualización en tiempo real  
✅ Documentación completa  

**¡Todo listo para rastrear tus móviles! 🚀**
