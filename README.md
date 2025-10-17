# 🚗 TrackMovil - Sistema de Rastreo en Tiempo Real

Aplicación web moderna para rastreo de vehículos en tiempo real, construida con Next.js 15, React 19, y OpenStreetMap, conectada a base de datos DB2 AS400.

## ✨ Características

- 📍 **Visualización en tiempo real** de ubicaciones de móviles en mapa OpenStreetMap
- 🎨 **Diseño moderno** con animaciones fluidas usando Framer Motion
- 🔄 **Actualización automática** configurable (3s, 5s, 10s, 30s)
- 🚙 **Selector de móviles** con soporte para múltiples unidades (693, 251, 337)
- 📊 **Panel de información** detallada con estado, distancia recorrida y coordenadas
- 🎯 **Marcadores animados** personalizados con colores por móvil
- 📱 **Responsive** - funciona en desktop, tablet y móvil

## 🚀 Inicio Rápido

### 1. Instalar dependencias

```bash
pnpm install
```

### 2. Configurar base de datos

Edita `.env.local` con tu servidor AS400:

```env
DB_CONNECTION_STRING=DRIVER={IBM i Access ODBC Driver};SYSTEM=tu_servidor;UID=qsecofr;PWD=wwm668;
DB_SCHEMA=GXICAGEO
```

### 3. Ejecutar aplicación

```bash
pnpm dev
```

Abre [http://localhost:3000](http://localhost:3000) en tu navegador.

## 📦 Tecnologías

- **Next.js 15** - Framework React con App Router
- **React 19** - Biblioteca de UI
- **TypeScript** - Tipado estático
- **Tailwind CSS v4** - Framework CSS
- **Framer Motion** - Animaciones
- **Leaflet** + **React Leaflet** - Mapas interactivos
- **ODBC** - Conexión a DB2 AS400

## 🏗️ Estructura del Proyecto

```
trackmovil/
├── app/
│   ├── api/              # API endpoints
│   ├── page.tsx          # Página principal
│   └── layout.tsx        # Layout global
├── components/
│   ├── map/              # Componentes de mapa
│   └── ui/               # Componentes UI
├── lib/
│   └── db.ts             # Servicio DB2
└── types/
    └── index.ts          # Tipos TypeScript
```

## 🔧 Configuración

### Móviles configurados

Edita `types/index.ts` para agregar más móviles:

```typescript
export const AVAILABLE_MOVILES: MovilData[] = [
  { id: 693, name: 'Móvil 693', color: '#3b82f6' },
  { id: 251, name: 'Móvil 251', color: '#ef4444' },
  { id: 337, name: 'Móvil 337', color: '#10b981' },
];
```

## 🚀 Build para Producción

```bash
pnpm build
pnpm start
```

## 📝 Notas

- Requiere **IBM i Access ODBC Driver** instalado
- La tabla debe ser `GXICAGEO.LOGCOORDMOVIL`
- Los datos se actualizan automáticamente según la configuración
