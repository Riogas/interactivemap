# 🧪 Guía de Pruebas - Sistema de Tiempo Real

## ✅ Estado Actual del Sistema

**Migración Completa a Supabase con WebSocket Streaming**

### Componentes Implementados

1. **✅ RealtimeProvider** - Context provider para WebSocket
2. **✅ useGPSTracking Hook** - Suscripción a eventos INSERT/UPDATE
3. **✅ Actualización Automática** - Marcadores se mueven sin polling
4. **✅ Indicador de Conexión** - Badge verde "Tiempo Real Activo"
5. **✅ API Migradas** - Todas las rutas usan Supabase

### APIs Actualizadas

| Endpoint | Estado | Descripción |
|----------|--------|-------------|
| `/api/empresas` | ✅ | Lista de empresas fleteras (escenario_id=1000) |
| `/api/all-positions` | ✅ | Todos los móviles con posición actual |
| `/api/latest` | ✅ | Última posición de móviles por empresa |
| `/api/coordinates` | ✅ | Historial completo de un móvil |
| `/api/movil/[id]` | ✅ | Historial filtrado por fechas (para animación) |
| `/api/pedidos-servicios-pendientes/[movilId]` | ✅ | Pedidos/servicios sin completar |

---

## 📋 Pasos para Probar el Sistema

### Paso 1: Habilitar Realtime en Supabase

1. Abre Supabase SQL Editor:
   ```
   https://app.supabase.com/project/lgniuhelyyizoursmsmi/sql
   ```

2. Ejecuta el script completo `supabase-quick-start.sql`:
   - Este script habilita Realtime en las tablas
   - Configura políticas RLS
   - Inserta datos de prueba (4 móviles, 12 posiciones GPS)

3. Verifica la ejecución exitosa:
   ```sql
   -- Debe mostrar:
   -- ✅ Empresas: 2
   -- ✅ Móviles: 4
   -- ✅ Posiciones GPS: 12
   ```

### Paso 2: Verificar la Aplicación

1. **Reinicia el servidor** de desarrollo:
   ```bash
   # Detén el servidor actual (Ctrl+C)
   # Reinicia:
   pnpm dev
   ```

2. **Abre la aplicación** en el navegador:
   ```
   http://localhost:3000
   ```

3. **Verifica el indicador de conexión**:
   - Debe aparecer un badge verde en la esquina superior derecha
   - Texto: "🟢 Tiempo Real Activo"
   - Si dice "Conectando...", revisa la consola del navegador

### Paso 3: Probar Actualizaciones en Tiempo Real

1. **Abre la consola del navegador** (F12)

2. **Abre Supabase SQL Editor** en otra pestaña:
   ```
   https://app.subase.com/project/lgniuhelyyizoursmsmi/sql
   ```

3. **Ejecuta el script de prueba** `test-realtime.sql`:
   
   **📝 Importante**: Ejecuta **línea por línea**, NO todo junto.

   **Prueba 1 - Movimiento Incremental**:
   ```sql
   -- Ejecuta esta línea:
   INSERT INTO gps_tracking_extended (...) VALUES (...); -- Móvil 1003 a -34.9115
   
   -- ESPERA 5 SEGUNDOS y observa:
   -- ✅ En la consola del navegador: "🔔 Actualización Realtime para móvil 1003"
   -- ✅ En el mapa: El marcador se mueve automáticamente
   
   -- Ejecuta la siguiente línea:
   INSERT INTO gps_tracking_extended (...) VALUES (...); -- Móvil 1003 a -34.9120
   
   -- ESPERA 5 SEGUNDOS y observa de nuevo el movimiento
   ```

   **Prueba 2 - Múltiples Móviles Simultáneos**:
   ```sql
   -- Ejecuta estas 4 líneas juntas:
   INSERT INTO gps_tracking_extended (...) VALUES (...); -- Móvil 1001
   INSERT INTO gps_tracking_extended (...) VALUES (...); -- Móvil 1002
   INSERT INTO gps_tracking_extended (...) VALUES (...); -- Móvil 1003
   INSERT INTO gps_tracking_extended (...) VALUES (...); -- Móvil 1004
   
   -- Observa:
   -- ✅ Deberían moverse LOS 4 marcadores al mismo tiempo
   -- ✅ En la consola: 4 mensajes de actualización
   ```

   **Prueba 3 - Actualizaciones Rápidas**:
   ```sql
   -- Ejecuta las 5 líneas seguidas (sin esperar):
   INSERT INTO gps_tracking_extended (...) VALUES (...);
   INSERT INTO gps_tracking_extended (...) VALUES (...);
   INSERT INTO gps_tracking_extended (...) VALUES (...);
   INSERT INTO gps_tracking_extended (...) VALUES (...);
   INSERT INTO gps_tracking_extended (...) VALUES (...);
   
   -- Observa:
   -- ✅ El marcador debe moverse 5 veces seguidas
   -- ✅ Debe verse una "animación" fluida
   ```

### Paso 4: Probar Animación del Recorrido

1. **Selecciona un móvil** de la lista lateral

2. **Haz clic en "Ver Animación"**

3. **Verifica**:
   - ✅ Se abre el diálogo con controles de reproducción
   - ✅ Aparece la barra de progreso
   - ✅ Controles de velocidad (0.1x, 0.25x, 0.5x, 1x, 2x, 5x, 10x)
   - ✅ Selector de rango horario (Desde/Hasta)
   - ✅ Switch "Ruta Simplificada"

4. **Prueba los controles**:
   - ▶️ Play/Pause: Debe iniciar/detener la animación
   - 🔄 Reiniciar: Debe volver al inicio del recorrido
   - ⚡ Velocidad: Debe cambiar la velocidad de reproducción
   - 🕐 Rango horario: Debe filtrar las coordenadas mostradas

---

## 🔍 Verificaciones Esperadas

### En la Consola del Navegador

```javascript
// Al cargar la página:
📍 Ajuste inicial del mapa a bounds de X móviles

// Al insertar un nuevo registro GPS en Supabase:
🔔 Actualización Realtime para móvil 1003
🔧 Actualizando móvil 1003 con posición {coordX, coordY, ...}

// Al seleccionar un móvil:
📜 Fetching history for móvil 1003...
✅ Received 500 coordinates for móvil 1003
📦 Fetching pendientes for móvil 1003...
✅ Found X pedidos and Y servicios pendientes
```

### En el Mapa

- ✅ **Marcadores de móviles** con icono de auto 🚗
- ✅ **Animación de pulso** en cada marcador
- ✅ **Colores distintos** por empresa
- ✅ **Movimiento automático** al insertar nuevos registros GPS
- ✅ **Polyline (trayectoria)** al reproducir animación
- ✅ **Marcadores de pedidos** 📦 (naranja) y servicios 🔧 (rojo)

### En el Panel de Información

- ✅ **Selector de empresas** con formato "MONDELLI SRL (ID: 1)"
- ✅ **Lista de móviles** con formato "Móvil-1003 | SBQ 3254"
- ✅ **Timestamp de última actualización**
- ✅ **Indicador de conexión** verde parpadeante

---

## 🐛 Troubleshooting

### Problema 1: No aparece el badge de "Tiempo Real Activo"

**Causa**: WebSocket no se conectó

**Solución**:
1. Abre la consola del navegador (F12)
2. Busca errores de Supabase Realtime
3. Verifica que ejecutaste `supabase-quick-start.sql`
4. Revisa las variables de entorno en `.env.local`:
   ```env
   NEXT_PUBLIC_SUPABASE_URL=https://lgniuhelyyizoursmsmi.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGci...
   ```

### Problema 2: Los marcadores no se mueven al insertar GPS

**Causa**: Realtime no está habilitado en las tablas

**Solución**:
1. Ejecuta en Supabase SQL Editor:
   ```sql
   -- Verificar publicación Realtime
   SELECT * FROM pg_publication_tables WHERE pubname = 'supabase_realtime';
   
   -- Debe mostrar:
   -- gps_tracking_extended
   -- moviles
   -- pedidos
   -- empresas_fleteras
   ```
2. Si no aparecen, ejecuta de nuevo `supabase-quick-start.sql`

### Problema 3: Error "No hay empresas disponibles"

**Causa**: Datos con `escenario_id` incorrecto

**Solución**:
1. Verifica el escenario_id de tus datos:
   ```sql
   SELECT DISTINCT escenario_id FROM empresas_fleteras;
   SELECT DISTINCT escenario_id FROM moviles;
   SELECT DISTINCT escenario_id FROM gps_tracking_extended;
   ```
2. Si el resultado NO es `1000`, actualiza el código:
   - En `components/providers/RealtimeProvider.tsx`: escenarioId={TU_VALOR}
   - En `app/layout.tsx`: escenarioId={TU_VALOR}
   - En todos los archivos de `/api/**/route.ts`: escenarioId default

### Problema 4: Animación no carga el historial

**Causa**: API `/api/movil/[id]` no devuelve datos

**Solución**:
1. Prueba directamente la API:
   ```bash
   curl http://localhost:3000/api/movil/1003?startDate=2025-06-20
   ```
2. Debe devolver:
   ```json
   {
     "success": true,
     "data": [...],
     "count": 500
   }
   ```
3. Si `count: 0`, verifica que el móvil tenga historial en Supabase:
   ```sql
   SELECT COUNT(*) FROM gps_tracking_extended 
   WHERE movil = '1003' AND escenario_id = 1000;
   ```

---

## 📊 Datos de Prueba Incluidos

El script `supabase-quick-start.sql` inserta estos datos:

### Empresas Fleteras
- **ID 1**: MONDELLI SRL (código: MONDELLI)
- **ID 2**: TORCOR (código: TORCOR)

### Móviles
| Móvil ID | Matrícula | Empresa | Chofer |
|----------|-----------|---------|--------|
| 1001 | SBQ 3254 | MONDELLI | JUAN PEREZ |
| 1002 | ABC 1234 | MONDELLI | MARIA LOPEZ |
| 1003 | XYZ 5678 | TORCOR | CARLOS GOMEZ |
| 1004 | DEF 9012 | TORCOR | ANA RODRIGUEZ |

### Posiciones GPS
- 3 posiciones para cada móvil (12 total)
- Distribuidas en Montevideo, Uruguay
- Rango de latitud: -34.9011 a -34.9116
- Rango de longitud: -56.1645 a -56.1914

---

## 🎯 Próximos Pasos

1. **✅ Ejecutar `supabase-quick-start.sql`** - Habilita Realtime
2. **✅ Probar con `test-realtime.sql`** - Verifica actualizaciones automáticas
3. **✅ Verificar animación** - Controles de reproducción
4. **⏳ Agregar datos reales** - Migrar datos de AS400/DB2
5. **⏳ Configurar polling de respaldo** - Para conexiones sin WebSocket
6. **⏳ Optimizar performance** - Índices, paginación, caché

---

## 📚 Referencias

- **Documentación Supabase Realtime**: https://supabase.com/docs/guides/realtime
- **PostgreSQL PostGIS**: https://postgis.net/documentation/
- **Leaflet Maps**: https://leafletjs.com/reference.html
- **Next.js 15**: https://nextjs.org/docs

---

## 🎉 ¡Listo!

Tu aplicación ahora cuenta con:
- ✅ **Conexión WebSocket permanente** (no polling)
- ✅ **Actualización automática de marcadores** en tiempo real
- ✅ **Indicador visual de conexión** (badge verde)
- ✅ **Animación completa del recorrido** con controles avanzados
- ✅ **Arquitectura escalable** con Supabase PostgreSQL + PostGIS

**Siguiente paso**: Ejecuta `supabase-quick-start.sql` en tu Supabase SQL Editor y comienza a ver los móviles moverse en tiempo real! 🚀
