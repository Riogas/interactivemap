# 🚀 Configuración de Supabase Realtime - TrackMovil

## 📝 Resumen

Este proyecto ha sido migrado de AS400/DB2 a **Supabase** con soporte completo de **actualizaciones en tiempo real** usando Supabase Realtime.

## 🔧 Configuración

### 1. Variables de Entorno

El archivo `.env.local` ya está configurado con:

```env
# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=https://lgniuhelyyizoursmsmi.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
DB_MODE=supabase
```

### 2. Habilitar Realtime en Supabase

**IMPORTANTE**: Debes habilitar Realtime en tu proyecto de Supabase:

1. Ve a tu proyecto en https://supabase.com/dashboard
2. Ve a **Database** > **Replication**
3. Habilita Realtime para estas tablas:
   - ✅ `gps_tracking_extended`
   - ✅ `moviles`
   - ✅ `pedidos`
   - ✅ `empresas_fleteras`

Alternativamente, ejecuta este SQL en el SQL Editor:

```sql
-- Habilitar Realtime para las tablas necesarias
ALTER PUBLICATION supabase_realtime ADD TABLE gps_tracking_extended;
ALTER PUBLICATION supabase_realtime ADD TABLE moviles;
ALTER PUBLICATION supabase_realtime ADD TABLE pedidos;
ALTER PUBLICATION supabase_realtime ADD TABLE empresas_fleteras;

-- Verificar que estén habilitadas
SELECT schemaname, tablename 
FROM pg_publication_tables 
WHERE pubname = 'supabase_realtime';
```

### 3. Row Level Security (RLS)

Si tienes RLS habilitado, asegúrate de tener políticas que permitan SELECT:

```sql
-- Política para lectura pública de GPS tracking
CREATE POLICY "Allow public read access to gps_tracking_extended"
ON gps_tracking_extended FOR SELECT
USING (true);

-- Política para lectura pública de móviles
CREATE POLICY "Allow public read access to moviles"
ON moviles FOR SELECT
USING (true);

-- Política para lectura pública de pedidos
CREATE POLICY "Allow public read access to pedidos"
ON pedidos FOR SELECT
USING (true);

-- Política para lectura pública de empresas
CREATE POLICY "Allow public read access to empresas_fleteras"
ON empresas_fleteras FOR SELECT
USING (true);
```

## 🏗️ Arquitectura

### Componentes Principales

1. **`lib/supabase.ts`**: Cliente de Supabase
   - Cliente para el navegador (con anon key)
   - Cliente para servidor (con service role key)

2. **`lib/hooks/useRealtimeSubscriptions.ts`**: Hooks de Realtime
   - `useGPSTracking()`: Suscripción a cambios GPS en tiempo real
   - `useMoviles()`: Suscripción a cambios en móviles
   - `usePedidos()`: Suscripción a cambios en pedidos
   - `useEmpresasFleteras()`: Suscripción a cambios en empresas

3. **`components/providers/RealtimeProvider.tsx`**: Provider de contexto
   - Maneja el estado global de Realtime
   - Sincroniza actualizaciones en tiempo real con el estado local
   - Proporciona datos a todos los componentes hijos

4. **API Routes** (`app/api/*`): Migradas a Supabase
   - `/api/empresas`: Lista de empresas fleteras
   - `/api/all-positions`: Posiciones actuales de todos los móviles
   - `/api/latest`: Última posición de un móvil específico
   - `/api/coordinates`: Historial de coordenadas
   - `/api/pedidos-servicios-pendientes/[movilId]`: Pedidos pendientes

### Flujo de Datos

```
┌─────────────────────────────────────┐
│    Supabase Database                │
│  (PostgreSQL con PostGIS)           │
└──────────────┬──────────────────────┘
               │
               │ Realtime Events
               ├─────────────────────────────┐
               │                             │
               ▼                             ▼
    ┌──────────────────┐         ┌──────────────────┐
    │  INSERT/UPDATE   │         │   Polling API    │
    │  en gps_tracking │         │   (fallback)     │
    └────────┬─────────┘         └─────────┬────────┘
             │                             │
             │ WebSocket                   │ HTTP
             │                             │
             ▼                             ▼
    ┌─────────────────────────────────────────────┐
    │      useGPSTracking Hook                    │
    │  (Supabase Realtime Subscription)           │
    └────────────────┬────────────────────────────┘
                     │
                     │ State Update
                     ▼
    ┌─────────────────────────────────────────────┐
    │      RealtimeProvider Context               │
    │  (Global State Management)                  │
    └────────────────┬────────────────────────────┘
                     │
                     │ Props
                     ▼
    ┌─────────────────────────────────────────────┐
    │      MapView Component                      │
    │  (Visualización en Mapa)                    │
    └─────────────────────────────────────────────┘
```

## 🎯 Uso

### Implementación Básica

Envuelve tu aplicación con el `RealtimeProvider`:

```tsx
import { RealtimeProvider } from '@/components/providers/RealtimeProvider';

export default function App() {
  return (
    <RealtimeProvider escenarioId={1} empresaIds={[1, 2, 3]}>
      {/* Tu contenido aquí */}
    </RealtimeProvider>
  );
}
```

### Usar el Hook en Componentes

```tsx
'use client';

import { useRealtime } from '@/components/providers/RealtimeProvider';

export default function MyComponent() {
  const { moviles, isConnected, error } = useRealtime();
  
  return (
    <div>
      <div>Estado: {isConnected ? '🟢 Conectado' : '🔴 Desconectado'}</div>
      {error && <div className="text-red-500">{error}</div>}
      
      <ul>
        {moviles.map(movil => (
          <li key={movil.id}>
            {movil.name} - Lat: {movil.currentPosition?.latitud}, 
            Lon: {movil.currentPosition?.longitud}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

### Hooks Individuales

Si necesitas más control, puedes usar los hooks directamente:

```tsx
import { useGPSTracking } from '@/lib/hooks/useRealtimeSubscriptions';

function MyComponent() {
  const { positions, isConnected } = useGPSTracking(
    1, // escenario_id
    ['123', '456'], // movilIds (opcional)
    (newPosition) => {
      console.log('Nueva posición:', newPosition);
    }
  );
  
  // ...
}
```

## 🔍 Testing Realtime

### 1. Simular Actualización GPS

Ejecuta esto en el SQL Editor de Supabase para insertar una nueva posición:

```sql
INSERT INTO gps_tracking_extended (
  movil, 
  escenario_id,
  latitud, 
  longitud, 
  fecha_hora,
  velocidad,
  accuracy,
  battery_level
) VALUES (
  '123',  -- ID del móvil
  1,      -- escenario_id
  -34.9011, -- Latitud (Montevideo)
  -56.1645, -- Longitud
  NOW(),
  45.5,   -- velocidad en km/h
  10.0,   -- accuracy en metros
  85      -- batería al 85%
);
```

Deberías ver en la consola del navegador:
```
📍 Nueva posición GPS recibida: {...}
🔔 Nueva posición recibida en tiempo real: {...}
```

### 2. Verificar Conexión

Abre la consola del navegador y busca estos mensajes:

```
🔄 Iniciando suscripción GPS Tracking...
📡 Estado de suscripción GPS: SUBSCRIBED
✅ Conectado a Realtime GPS Tracking
```

### 3. Debugging

Si no ves actualizaciones en tiempo real:

1. **Verifica Realtime está habilitado**:
   ```sql
   SELECT * FROM pg_publication_tables WHERE pubname = 'supabase_realtime';
   ```

2. **Verifica RLS**:
   ```sql
   SELECT * FROM pg_policies WHERE tablename = 'gps_tracking_extended';
   ```

3. **Revisa logs de Supabase**:
   - Ve a Dashboard > Logs > Realtime

4. **Verifica en consola del navegador**:
   - Debe mostrar `isConnected: true`
   - No debe haber errores de WebSocket

## 📊 Tablas de Supabase

### gps_tracking_extended
Almacena el tracking GPS en tiempo real de los móviles.

**Campos principales**:
- `id`: ID único del registro
- `movil`: ID del móvil (string)
- `escenario_id`: ID del escenario
- `latitud`, `longitud`: Coordenadas GPS
- `fecha_hora`: Timestamp del registro
- `velocidad`, `bearing`, `accuracy`: Datos del GPS
- `battery_level`: Nivel de batería del dispositivo

### moviles
Información de los móviles/vehículos.

**Campos principales**:
- `movil`: ID del móvil (numérico)
- `escenario_id`: ID del escenario
- `empresa_fletera_id`: ID de la empresa
- `matricula`: Matrícula del vehículo
- `mostrar_en_mapa`: Boolean para visibilidad

### pedidos
Pedidos/servicios asignados a móviles.

**Campos principales**:
- `pedido_id`: ID único del pedido
- `escenario_id`: ID del escenario
- `movil`: ID del móvil asignado
- `estado`: Estado del pedido
- `latitud`, `longitud`: Ubicación del pedido
- `fecha_hora_cumplido`: Timestamp de completado

### empresas_fleteras
Empresas de transporte.

**Campos principales**:
- `empresa_fletera_id`: ID único
- `escenario_id`: ID del escenario
- `nombre`: Nombre de la empresa
- `estado`: Estado (1 = activo)

## 🚨 Troubleshooting

### Problema: No se reciben actualizaciones

1. Verifica que Realtime esté habilitado en Supabase
2. Verifica las políticas de RLS
3. Revisa la consola del navegador para errores
4. Verifica que `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY` estén correctas

### Problema: Error de conexión WebSocket

- Verifica que tu firewall no bloquee WebSockets
- Prueba con otra red (a veces redes corporativas bloquean WebSockets)

### Problema: Datos duplicados

- Asegúrate de limpiar las suscripciones correctamente
- Los hooks usan cleanup en `useEffect` return

## 📈 Performance

### Optimizaciones Implementadas

1. **Throttling de eventos**: Limitado a 10 eventos por segundo
2. **Filtrado por escenario**: Solo recibe datos relevantes
3. **Filtrado por empresa**: Opcional para reducir tráfico
4. **Cleanup automático**: Cierra conexiones al desmontar componentes

### Limits de Supabase

- **Free Tier**: 2 GB bandwidth, 500 MB database
- **Realtime connections**: 200 concurrent connections (free tier)
- Si necesitas más, considera upgrade o implementar batching

## 🎨 Próximas Mejoras

- [ ] Implementar reconnection automática con exponential backoff
- [ ] Agregar métricas de latencia de Realtime
- [ ] Implementar offline mode con sincronización al reconectar
- [ ] Agregar notificaciones push para eventos críticos
- [ ] Implementar clustering de marcadores para mejor performance

## 📚 Recursos

- [Supabase Realtime Docs](https://supabase.com/docs/guides/realtime)
- [PostGIS Documentation](https://postgis.net/documentation/)
- [Leaflet.js](https://leafletjs.com/)
