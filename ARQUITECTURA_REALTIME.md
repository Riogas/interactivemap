# 🏗️ Arquitectura del Sistema de Tiempo Real

## 📐 Diagrama de Arquitectura

```
┌──────────────────────────────────────────────────────────────┐
│                     NAVEGADOR (Cliente)                       │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌─────────────────┐      ┌──────────────────┐             │
│  │   page.tsx      │◄─────┤ RealtimeProvider │             │
│  │  (Map UI)       │      │   (Context)      │             │
│  └────────┬────────┘      └────────┬─────────┘             │
│           │                         │                        │
│           │                         │                        │
│  ┌────────▼─────────────────────────▼────────┐             │
│  │      useRealtime() Hook                   │             │
│  │  - latestPosition                         │             │
│  │  - isConnected                            │             │
│  │  - error                                  │             │
│  └────────┬──────────────────────────────────┘             │
│           │                                                  │
│           │                                                  │
│  ┌────────▼──────────────────────────────────┐             │
│  │    useGPSTracking() Hook                  │             │
│  │  - Supabase WebSocket Subscription        │             │
│  │  - Escucha INSERT/UPDATE events           │             │
│  └────────┬──────────────────────────────────┘             │
│           │                                                  │
└───────────┼──────────────────────────────────────────────────┘
            │
            │ WebSocket (wss://)
            │ postgres_changes events
            │
┌───────────▼──────────────────────────────────────────────────┐
│                    SUPABASE BACKEND                           │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌────────────────────────────────────────────────┐         │
│  │         REALTIME SERVER                        │         │
│  │  - Escucha cambios en tablas PostgreSQL       │         │
│  │  - Publica eventos via WebSocket              │         │
│  │  - Filtra por RLS policies                    │         │
│  └─────────────────┬──────────────────────────────┘         │
│                    │                                          │
│                    │ PostgreSQL LISTEN/NOTIFY                │
│                    │                                          │
│  ┌─────────────────▼──────────────────────────────┐         │
│  │         POSTGRESQL DATABASE                    │         │
│  │  ┌──────────────────────────────────────────┐ │         │
│  │  │  gps_tracking_extended                   │ │         │
│  │  │  - movil (VARCHAR)                       │ │         │
│  │  │  - latitud (DOUBLE PRECISION)            │ │         │
│  │  │  - longitud (DOUBLE PRECISION)           │ │         │
│  │  │  - fecha_hora (TIMESTAMP)                │ │         │
│  │  │  - escenario_id (INTEGER)                │ │         │
│  │  └──────────────────────────────────────────┘ │         │
│  │  ┌──────────────────────────────────────────┐ │         │
│  │  │  moviles                                 │ │         │
│  │  │  - movil (INTEGER)                       │ │         │
│  │  │  - matricula (VARCHAR)                   │ │         │
│  │  │  - escenario_id (INTEGER)                │ │         │
│  │  └──────────────────────────────────────────┘ │         │
│  │                                                │         │
│  │  📡 PUBLICATION: supabase_realtime            │         │
│  │  - gps_tracking_extended (INSERT, UPDATE)     │         │
│  │  - moviles (INSERT, UPDATE)                   │         │
│  └────────────────────────────────────────────────┘         │
│                                                               │
└───────────────────────────────────────────────────────────────┘
```

---

## 🔄 Flujo de Datos en Tiempo Real

### 1. Inserción de Datos GPS

```sql
-- Sistema externo (AS400, sensor GPS, etc.) inserta nuevo registro
INSERT INTO gps_tracking_extended (
  movil, latitud, longitud, fecha_hora, escenario_id
) VALUES (
  '1003', -34.9115, -56.1645, NOW(), 1000
);
```

### 2. PostgreSQL NOTIFY

```
PostgreSQL Database
    ↓
Detecta INSERT en gps_tracking_extended
    ↓
Dispara NOTIFY 'supabase_realtime'
    ↓
Envía payload con datos del nuevo registro
```

### 3. Supabase Realtime Server

```
Realtime Server recibe NOTIFY
    ↓
Filtra por suscripciones activas
    ↓
Aplica RLS policies (verificar permisos)
    ↓
Envía evento a WebSockets suscritos
```

### 4. Cliente (Navegador)

```javascript
// useGPSTracking Hook recibe el evento
supabaseClient
  .channel('gps-tracking')
  .on('postgres_changes', 
    { 
      event: 'INSERT', 
      schema: 'public', 
      table: 'gps_tracking_extended',
      filter: `escenario_id=eq.1000`
    },
    (payload) => {
      // payload.new = { movil: '1003', latitud: -34.9115, ... }
      setLatestPosition(payload.new);
    }
  )
  .subscribe();
```

### 5. Actualización del UI

```javascript
// page.tsx useEffect escucha cambios en latestPosition
useEffect(() => {
  if (!latestPosition) return;
  
  const movilId = parseInt(latestPosition.movil);
  
  // Actualiza estado de móviles
  setMoviles(prevMoviles => {
    return prevMoviles.map(movil => {
      if (movil.id === movilId) {
        return {
          ...movil,
          currentPosition: {
            coordX: latestPosition.latitud,
            coordY: latestPosition.longitud,
            fechaInsLog: latestPosition.fecha_hora,
            ...
          }
        };
      }
      return movil;
    });
  });
  
  // 🎯 Marcador se mueve automáticamente en el mapa
}, [latestPosition]);
```

---

## 🧩 Componentes Clave

### 1. RealtimeProvider (Context)

**Archivo**: `components/providers/RealtimeProvider.tsx`

**Responsabilidades**:
- Gestionar conexión WebSocket con Supabase
- Suscribirse a eventos INSERT/UPDATE en `gps_tracking_extended`
- Distribuir actualizaciones a componentes hijos
- Mantener estado de conexión (`isConnected`)
- Manejo de errores de conexión

**Props**:
```typescript
interface RealtimeProviderProps {
  escenarioId: number;  // Filtro de escenario (1000)
  children: ReactNode;
}
```

**Context Value**:
```typescript
interface RealtimeContextValue {
  positions: Map<string, GPSTrackingExtended>;  // Mapa de posiciones por móvil
  isConnected: boolean;                         // Estado de conexión WebSocket
  error: Error | null;                          // Error de conexión (si hay)
  latestPosition: GPSTrackingExtended | null;   // Última posición recibida
}
```

### 2. useGPSTracking Hook

**Archivo**: `lib/hooks/useRealtimeSubscriptions.ts`

**Responsabilidades**:
- Crear y gestionar suscripción a Supabase Realtime
- Filtrar eventos por `escenario_id`
- Opcional: filtrar por móviles específicos
- Invocar callback `onUpdate` al recibir eventos
- Cleanup de suscripciones al desmontar

**Firma**:
```typescript
function useGPSTracking(
  escenarioId: number,
  movilIds?: number[],  // Opcional: solo escuchar estos móviles
  onUpdate?: (position: GPSTrackingExtended) => void
): {
  positions: Map<string, GPSTrackingExtended>;
  isConnected: boolean;
  error: Error | null;
}
```

**Implementación**:
```typescript
export function useGPSTracking(
  escenarioId: number,
  movilIds?: number[],
  onUpdate?: (position: GPSTrackingExtended) => void
) {
  const [positions, setPositions] = useState<Map<string, GPSTrackingExtended>>(new Map());
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    // Crear canal de suscripción
    const channel = supabaseClient
      .channel(`gps-tracking-${escenarioId}`)
      .on(
        'postgres_changes',
        {
          event: '*',  // INSERT o UPDATE
          schema: 'public',
          table: 'gps_tracking_extended',
          filter: `escenario_id=eq.${escenarioId}`,
        },
        (payload) => {
          const newPosition = payload.new as GPSTrackingExtended;
          
          // Filtrar por móviles si se especificaron
          if (movilIds && movilIds.length > 0) {
            const movilId = parseInt(newPosition.movil);
            if (!movilIds.includes(movilId)) return;
          }

          // Actualizar estado
          setPositions(prev => {
            const updated = new Map(prev);
            updated.set(newPosition.movil, newPosition);
            return updated;
          });

          // Invocar callback
          onUpdate?.(newPosition);
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setIsConnected(true);
        } else if (status === 'CLOSED') {
          setIsConnected(false);
        }
      });

    // Cleanup
    return () => {
      channel.unsubscribe();
    };
  }, [escenarioId, movilIds, onUpdate]);

  return { positions, isConnected, error };
}
```

### 3. page.tsx (Componente Principal)

**Archivo**: `app/page.tsx`

**Responsabilidades**:
- Renderizar mapa con Leaflet
- Mostrar lista de móviles
- Gestionar selección de móviles
- Cargar historial para animación
- Mostrar indicador de conexión
- Actualizar marcadores en tiempo real

**Hook Integration**:
```typescript
'use client';

export default function Home() {
  // Hook de Realtime
  const { latestPosition, isConnected } = useRealtime();
  
  // Estado de móviles
  const [moviles, setMoviles] = useState<MovilData[]>([]);
  
  // Efecto para actualizar en tiempo real
  useEffect(() => {
    if (!latestPosition) return;
    
    const movilId = parseInt(latestPosition.movil);
    console.log(`🔔 Actualización Realtime para móvil ${movilId}`);
    
    setMoviles(prevMoviles => {
      return prevMoviles.map(movil => {
        if (movil.id === movilId) {
          return {
            ...movil,
            currentPosition: {
              coordX: parseFloat(latestPosition.latitud.toString()),
              coordY: parseFloat(latestPosition.longitud.toString()),
              fechaInsLog: latestPosition.fecha_hora,
              ...
            },
            history: movil.history 
              ? [newPosition, ...movil.history] 
              : undefined
          };
        }
        return movil;
      });
    });
  }, [latestPosition]);
  
  return (
    <>
      {/* Indicador de conexión */}
      <div className="fixed top-20 right-4 z-50 bg-white rounded-lg shadow-lg px-4 py-2">
        <div className="flex items-center gap-2">
          <div className={`w-3 h-3 rounded-full ${isConnected ? 'bg-green-500 animate-pulse' : 'bg-gray-300'}`} />
          <span className="text-sm font-medium">
            {isConnected ? 'Tiempo Real Activo' : 'Conectando...'}
          </span>
        </div>
      </div>
      
      {/* Mapa */}
      <MapView 
        moviles={moviles}
        focusedMovil={focusedMovil}
        selectedMovil={selectedMovil}
        ...
      />
    </>
  );
}
```

---

## 🔐 Seguridad y Permisos (RLS)

### Row Level Security Policies

```sql
-- Política para lectura pública de GPS tracking
CREATE POLICY "Permitir lectura pública de GPS tracking"
ON gps_tracking_extended
FOR SELECT
USING (true);

-- Política para lectura pública de móviles
CREATE POLICY "Permitir lectura pública de móviles"
ON moviles
FOR SELECT
USING (true);
```

### Autenticación

```typescript
// Cliente público (anon key) - Solo lectura
const supabaseClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// Cliente servidor (service role) - Permisos completos
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);
```

---

## ⚡ Optimizaciones

### 1. Filtrado en el Servidor

```typescript
// ✅ Bueno: Filtrar en la suscripción
.on('postgres_changes', {
  event: 'INSERT',
  schema: 'public',
  table: 'gps_tracking_extended',
  filter: `escenario_id=eq.1000`  // ← Filtrado en servidor
})

// ❌ Malo: Filtrar en el cliente
.on('postgres_changes', {
  event: 'INSERT',
  schema: 'public',
  table: 'gps_tracking_extended'
})
.subscribe((payload) => {
  // Recibe TODOS los eventos, luego filtra en cliente
  if (payload.new.escenario_id === 1000) {
    // ...
  }
});
```

### 2. Debouncing de Actualizaciones

```typescript
// Agrupar múltiples actualizaciones rápidas
const [latestPosition, setLatestPosition] = useState(null);
const updateTimeoutRef = useRef<NodeJS.Timeout>();

const handleNewPosition = (position: GPSTrackingExtended) => {
  // Cancelar timeout previo
  if (updateTimeoutRef.current) {
    clearTimeout(updateTimeoutRef.current);
  }
  
  // Agendar actualización después de 100ms
  updateTimeoutRef.current = setTimeout(() => {
    setLatestPosition(position);
  }, 100);
};
```

### 3. Índices en PostgreSQL

```sql
-- Índice para filtrado por escenario y móvil
CREATE INDEX idx_gps_escenario_movil 
ON gps_tracking_extended (escenario_id, movil);

-- Índice para filtrado por fecha
CREATE INDEX idx_gps_fecha_hora 
ON gps_tracking_extended (fecha_hora DESC);

-- Índice compuesto para consultas frecuentes
CREATE INDEX idx_gps_tracking_lookup 
ON gps_tracking_extended (escenario_id, movil, fecha_hora DESC);
```

### 4. Límite de Registros en Historial

```typescript
// API /api/movil/[id]
.limit(500)  // Máximo 500 puntos para animación
```

---

## 📊 Monitoreo y Debugging

### Console Logs Esperados

```javascript
// Conexión exitosa
✅ WebSocket connected to Supabase Realtime

// Actualización recibida
🔔 Actualización Realtime para móvil 1003
🔧 Actualizando móvil 1003 con posición {coordX: -34.9115, coordY: -56.1645}

// Carga de historial
📜 Fetching history for móvil 1003...
✅ Received 500 coordinates for móvil 1003
```

### Herramientas de Desarrollo

1. **Supabase Dashboard** - Monitorear conexiones WebSocket:
   ```
   https://app.supabase.com/project/lgniuhelyyizoursmsmi/logs
   ```

2. **Browser DevTools** - Network tab:
   - Buscar conexión `wss://` (WebSocket)
   - Debe mostrar estado "101 Switching Protocols"
   - Mensajes continuos (ping/pong)

3. **PostgreSQL Logs** - Verificar NOTIFY/LISTEN:
   ```sql
   SELECT * FROM pg_stat_activity 
   WHERE query LIKE '%LISTEN%';
   ```

---

## 🚀 Escalabilidad

### Límites de Supabase Realtime

| Plan | Conexiones Simultáneas | Mensajes/Segundo |
|------|------------------------|------------------|
| Free | 200 | 2 |
| Pro | 500 | 5 |
| Team | 1,000 | 10 |
| Enterprise | Ilimitado | Ilimitado |

### Estrategias de Escalado

1. **Multiplexing**: Usar un canal compartido para múltiples móviles
2. **Polling de Respaldo**: Fallback a polling cada 10s si WebSocket falla
3. **CDN**: Servir assets estáticos desde CDN
4. **Database Read Replicas**: Distribuir consultas de lectura

---

## 📚 Referencias Técnicas

- **Supabase Realtime**: https://supabase.com/docs/guides/realtime/postgres-changes
- **PostgreSQL LISTEN/NOTIFY**: https://www.postgresql.org/docs/current/sql-notify.html
- **WebSocket RFC 6455**: https://tools.ietf.org/html/rfc6455
- **React Context API**: https://react.dev/reference/react/useContext
- **Leaflet Markers**: https://leafletjs.com/reference.html#marker

---

## ✅ Checklist de Implementación

- [x] Instalar dependencias (@supabase/supabase-js)
- [x] Configurar clientes Supabase (anon + service role)
- [x] Generar tipos TypeScript desde esquema
- [x] Migrar APIs de AS400/DB2 a Supabase
- [x] Crear hook useGPSTracking
- [x] Implementar RealtimeProvider
- [x] Integrar useRealtime en page.tsx
- [x] Agregar indicador de conexión
- [x] Implementar actualización automática de marcadores
- [x] Habilitar Realtime en tablas (ALTER PUBLICATION)
- [x] Configurar RLS policies
- [ ] Ejecutar supabase-quick-start.sql
- [ ] Probar con test-realtime.sql
- [ ] Verificar animación del recorrido
- [ ] Migrar datos reales de AS400
- [ ] Configurar polling de respaldo
- [ ] Implementar manejo de reconexión
- [ ] Agregar métricas y alertas
- [ ] Optimizar índices PostgreSQL
- [ ] Configurar CDN para assets
- [ ] Documentar API públicamente

---

**Estado**: ✅ Implementación completa - Listo para pruebas 🚀
