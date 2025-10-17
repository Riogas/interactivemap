# 🎉 TrackMovil - Guía de Inicio Rápido

## ✅ Estado Actual

Tu aplicación está **lista y funcionando** en modo desarrollo con datos mock!

🌐 **URL**: http://localhost:3000

## 🚀 Qué tienes ahora

### Características implementadas:

✅ **Mapa interactivo** con OpenStreetMap (Leaflet)
✅ **3 móviles configurados**: 693 (azul), 251 (rojo), 337 (verde)
✅ **Actualización automática** en tiempo real (configurable: 3s, 5s, 10s, 30s)
✅ **Selector de móviles** con animaciones
✅ **Panel de información** detallado
✅ **Marcadores animados** en el mapa
✅ **Diseño moderno** y responsive con Tailwind CSS v4
✅ **Animaciones fluidas** con Framer Motion

### Arquitectura:

```
📁 app/
   ├── api/              # Endpoints REST
   ├── page.tsx          # Página principal
   └── layout.tsx        
📁 components/
   ├── map/              # MapView con Leaflet
   └── ui/               # MovilSelector, InfoPanel
📁 lib/
   ├── db.ts             # Conexión DB2 (preparada)
   └── db-mock.ts        # Datos mock (activo)
📁 types/
   └── index.ts          # Tipos TypeScript
```

## 🎮 Cómo usar la aplicación

1. **Ver todos los móviles**: Click en "Todos los Móviles"
2. **Seleccionar móvil específico**: Click en "Móvil 693", "Móvil 251", o "Móvil 337"
3. **Ver detalles**: Click en un marcador del mapa o revisa el panel derecho
4. **Ajustar frecuencia**: Selector en el header (3s, 5s, 10s, 30s)

## 🔄 Conectar a DB2 AS400 Real

Actualmente usa datos **mock** para desarrollo. Para conectar a DB2:

### Paso 1: Instalar IBM i Access ODBC Driver

1. Descarga: https://www.ibm.com/support/pages/ibm-i-access-client-solutions
2. Instala el paquete completo para Windows
3. Verifica la instalación en "Orígenes de datos ODBC" de Windows

### Paso 2: Instalar Visual Studio Build Tools

```powershell
# Descargar e instalar desde:
https://visualstudio.microsoft.com/visual-cpp-build-tools/

# Seleccionar durante instalación:
- Desarrollo para escritorio con C++
- Windows 10/11 SDK
```

### Paso 3: Recompilar módulo ODBC

```bash
pnpm rebuild odbc
```

### Paso 4: Configurar conexión

Edita `.env.local`:

```env
DB_CONNECTION_STRING=DRIVER={IBM i Access ODBC Driver};SYSTEM=tu_servidor_as400;UID=qsecofr;PWD=wwm668;
DB_SCHEMA=GXICAGEO
```

### Paso 5: Activar conexión real

En estos archivos, cambia los imports:

**`app/api/coordinates/route.ts`**
**`app/api/latest/route.ts`**
**`app/api/all-positions/route.ts`**

```typescript
// Cambia de:
import { getMovilCoordinates } from '@/lib/db-mock';

// A:
import { getMovilCoordinates } from '@/lib/db';
```

### Paso 6: Reiniciar

```bash
pnpm dev
```

## 🛠️ Comandos disponibles

```bash
# Desarrollo (puerto 3000)
pnpm dev

# Build producción
pnpm build

# Ejecutar producción
pnpm start

# Linting
pnpm lint
```

## 📝 Personalización

### Agregar más móviles

Edita `types/index.ts`:

```typescript
export const AVAILABLE_MOVILES: MovilData[] = [
  { id: 693, name: 'Móvil 693', color: '#3b82f6' },
  { id: 251, name: 'Móvil 251', color: '#ef4444' },
  { id: 337, name: 'Móvil 337', color: '#10b981' },
  { id: 444, name: 'Móvil 444', color: '#f59e0b' }, // Nuevo
];
```

### Cambiar colores o nombres

En `types/index.ts`, modifica los objetos en `AVAILABLE_MOVILES`.

### Ajustar intervalo de actualización

En `app/page.tsx`, línea ~29:

```typescript
const [updateInterval, setUpdateInterval] = useState(5000); // Cambia el valor
```

### Modificar centro del mapa

En `components/map/MapView.tsx`, línea ~52:

```typescript
const defaultCenter: [number, number] = [-25.2637, -57.5759]; // Cambia coordenadas
```

## 🎨 Estilos y Tema

Los estilos usan **Tailwind CSS v4**:

- `app/globals.css` - Estilos globales
- Componentes usan clases de Tailwind
- Animaciones con **Framer Motion**

Para personalizar colores, edita `app/globals.css`.

## 🔍 Debugging

### Ver logs del servidor

La consola donde ejecutas `pnpm dev` muestra:
- Peticiones API
- Errores de conexión
- Estado de la DB

### Ver logs del navegador

Presiona `F12` y ve a la pestaña **Console** para ver:
- Estado de las peticiones
- Errores del frontend
- Datos recibidos

### API Endpoints disponibles

```
GET /api/all-positions
GET /api/latest?movilId=693
GET /api/coordinates?movilId=693&startDate=2025-10-14&limit=100
```

Puedes probarlos en el navegador o con `curl`:

```bash
curl http://localhost:3000/api/all-positions
```

## 📊 Estructura de Datos

La aplicación espera esta estructura de la tabla DB2:

```sql
LOGCOORDMOVILIDENTIFICADOR  -- ID del móvil (int)
LOGCOORDMOVILORIGEN         -- Origen (GPS, etc.)
LOGCOORDMOVILCOORDX         -- Longitud (decimal)
LOGCOORDMOVILCOORDY         -- Latitud (decimal)
LOGCOORDMOVILFCHINSLOG      -- Fecha/hora (timestamp)
LOGCOORDMOVILAUXIN2         -- Estado (PRIMERA, QUIETO, etc.)
LOGCOORDMOVILDISTRECORRIDA  -- Distancia en km (decimal)
```

## ⚠️ Troubleshooting

### El mapa no se muestra

- Verifica que JavaScript esté habilitado
- Abre la consola del navegador (F12) para ver errores
- Comprueba que Leaflet se cargó correctamente

### Datos no se actualizan

- Revisa que el servidor esté corriendo (`pnpm dev`)
- Verifica los logs en la terminal
- Comprueba la configuración del intervalo

### Error de ODBC en producción

- Lee `ODBC_SETUP.md` para instrucciones detalladas
- Considera usar una API intermedia si hay problemas
- Verifica que el driver IBM i Access esté instalado

## 🚀 Próximos pasos

1. **Probar con datos reales**: Conectar a DB2 AS400
2. **Agregar más features**:
   - Historial de rutas
   - Filtros por fecha
   - Exportar datos
   - Alertas en tiempo real
   - Estadísticas
3. **Desplegar a producción**: Vercel, AWS, Azure, etc.

## 📞 Soporte

Si tienes problemas:

1. Revisa `ODBC_SETUP.md` para conexión DB2
2. Consulta logs en terminal y navegador
3. Verifica configuración en `.env.local`

---

**¡Disfruta tu aplicación de rastreo en tiempo real! 🚗📍**
