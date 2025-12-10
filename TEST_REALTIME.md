# 🧪 Script de Pruebas - Supabase Realtime

## Test de Conexión Básica

```javascript
// Ejecuta esto en la consola del navegador (F12)

// 1. Verificar que el cliente está configurado
console.log('Supabase URL:', process.env.NEXT_PUBLIC_SUPABASE_URL);
console.log('¿Cliente configurado?', typeof supabase !== 'undefined');

// 2. Test de consulta simple
const testQuery = async () => {
  const { data, error } = await supabase
    .from('empresas_fleteras')
    .select('*')
    .limit(5);
  
  if (error) {
    console.error('❌ Error:', error);
  } else {
    console.log('✅ Datos recibidos:', data);
  }
};

testQuery();
```

## Test de Realtime Subscription

```javascript
// Test de suscripción en tiempo real

const testRealtime = () => {
  console.log('🔄 Iniciando test de Realtime...');
  
  const channel = supabase
    .channel('test-channel')
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'gps_tracking_extended'
      },
      (payload) => {
        console.log('📡 Cambio detectado:', payload);
      }
    )
    .subscribe((status) => {
      console.log('📊 Estado:', status);
      
      if (status === 'SUBSCRIBED') {
        console.log('✅ ¡Suscripción exitosa!');
        console.log('👉 Ahora ejecuta un INSERT en Supabase para ver la actualización');
      }
    });
  
  // Para cancelar la suscripción después de 1 minuto
  setTimeout(() => {
    supabase.removeChannel(channel);
    console.log('🛑 Suscripción cancelada');
  }, 60000);
};

testRealtime();
```

## Insertar Datos de Prueba

### SQL (Ejecutar en Supabase SQL Editor)

```sql
-- Test 1: Insertar nueva posición GPS
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
  '101',
  1,
  -34.9011,
  -56.1645,
  NOW(),
  45.5,
  10.0,
  85
);

-- Test 2: Actualizar posición existente
UPDATE gps_tracking_extended
SET 
  latitud = -34.9050,
  longitud = -56.1680,
  fecha_hora = NOW(),
  velocidad = 55.0
WHERE movil = '101'
AND id = (
  SELECT id FROM gps_tracking_extended 
  WHERE movil = '101' 
  ORDER BY fecha_hora DESC 
  LIMIT 1
);

-- Test 3: Insertar móvil nuevo
INSERT INTO moviles (
  movil, escenario_id, empresa_fletera_id, 
  matricula, mostrar_en_mapa, estado
) VALUES (
  102, 1, 1, 'TEST-102', true, 1
)
ON CONFLICT (movil, escenario_id, empresa_fletera_id) 
DO UPDATE SET updated_at = NOW();

-- Test 4: Insertar pedido
INSERT INTO pedidos (
  pedido_id, escenario_id, movil, estado,
  latitud, longitud, cliente_nombre, fecha_para
) VALUES (
  99999, 1, 101, 1,
  -34.9100, -56.1700, 'Cliente Test', CURRENT_DATE
);
```

### JavaScript (API)

```javascript
// Test usando la API de tu aplicación

const testAPI = async () => {
  console.log('🔄 Testing API endpoints...');
  
  // Test 1: Empresas
  try {
    const res1 = await fetch('/api/empresas');
    const data1 = await res1.json();
    console.log('✅ /api/empresas:', data1);
  } catch (e) {
    console.error('❌ Error en /api/empresas:', e);
  }
  
  // Test 2: All positions
  try {
    const res2 = await fetch('/api/all-positions?escenario_id=1');
    const data2 = await res2.json();
    console.log('✅ /api/all-positions:', data2);
  } catch (e) {
    console.error('❌ Error en /api/all-positions:', e);
  }
  
  // Test 3: Latest position
  try {
    const res3 = await fetch('/api/latest?movilId=101&escenario_id=1');
    const data3 = await res3.json();
    console.log('✅ /api/latest:', data3);
  } catch (e) {
    console.error('❌ Error en /api/latest:', e);
  }
};

testAPI();
```

## Simular Movimiento de Móvil

```sql
-- Script para simular movimiento de un móvil
-- Ejecutar varias veces cambiando las coordenadas

DO $$
DECLARE
  i INTEGER;
  lat NUMERIC;
  lon NUMERIC;
BEGIN
  FOR i IN 1..10 LOOP
    lat := -34.9011 + (random() * 0.01); -- Pequeña variación
    lon := -56.1645 + (random() * 0.01);
    
    INSERT INTO gps_tracking_extended (
      movil, escenario_id, latitud, longitud, fecha_hora, velocidad
    ) VALUES (
      '101', 1, lat, lon, NOW() + (i || ' seconds')::INTERVAL, 40 + random() * 20
    );
    
    RAISE NOTICE 'Posición % insertada: %, %', i, lat, lon;
  END LOOP;
END $$;
```

## Verificar Realtime en Consola

```javascript
// Monitorear eventos de Realtime en la consola

// Método 1: Ver todas las suscripciones activas
console.log('Canales activos:', supabase.getChannels());

// Método 2: Listener global de eventos
const monitorRealtime = () => {
  let eventCount = 0;
  
  const channel = supabase
    .channel('monitor')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'gps_tracking_extended' },
      (payload) => {
        eventCount++;
        console.log(`📊 Evento #${eventCount}:`, {
          tipo: payload.eventType,
          movil: payload.new?.movil || payload.old?.movil,
          timestamp: new Date().toISOString(),
          payload
        });
      }
    )
    .subscribe((status) => {
      console.log('🔗 Monitor conectado:', status);
    });
  
  return channel;
};

// Iniciar monitor
const monitor = monitorRealtime();

// Para detener: supabase.removeChannel(monitor);
```

## Test de Performance

```javascript
// Medir latencia de Realtime

const testLatency = () => {
  const startTime = Date.now();
  let endTime;
  
  const channel = supabase
    .channel('latency-test')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'gps_tracking_extended' },
      (payload) => {
        endTime = Date.now();
        const latency = endTime - startTime;
        console.log(`⚡ Latencia de Realtime: ${latency}ms`);
        console.log('Datos recibidos:', payload.new);
      }
    )
    .subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        console.log('✅ Listo para test de latencia');
        console.log('👉 Ejecuta el INSERT ahora en SQL Editor');
      }
    });
  
  return channel;
};

testLatency();

// Luego ejecuta en SQL:
// INSERT INTO gps_tracking_extended (movil, escenario_id, latitud, longitud, fecha_hora)
// VALUES ('TEST', 1, -34.9011, -56.1645, NOW());
```

## Checklist de Verificación

### ✅ Paso 1: Configuración Básica
- [ ] Variables de entorno configuradas en `.env.local`
- [ ] Aplicación inicia sin errores
- [ ] Puedes ver el mapa

### ✅ Paso 2: Supabase
- [ ] Realtime habilitado en las tablas (verifica en Dashboard)
- [ ] RLS configurado (políticas de lectura)
- [ ] Datos de prueba insertados

### ✅ Paso 3: Conexión
- [ ] Consola muestra "Conectado a Realtime GPS Tracking"
- [ ] Sin errores de WebSocket
- [ ] Estado muestra 🟢 Conectado

### ✅ Paso 4: Realtime Funcional
- [ ] INSERT en SQL muestra actualización en consola
- [ ] Mapa se actualiza automáticamente
- [ ] Marcadores se mueven en tiempo real

### ✅ Paso 5: Performance
- [ ] Latencia < 500ms
- [ ] Sin lag en el mapa
- [ ] Memoria estable (sin leaks)

## Solución de Problemas Comunes

### No se reciben eventos

1. Verificar Realtime:
```sql
SELECT * FROM pg_publication_tables WHERE pubname = 'supabase_realtime';
```

2. Verificar RLS:
```sql
SELECT * FROM pg_policies WHERE tablename = 'gps_tracking_extended';
```

3. Ver logs de Supabase:
   - Dashboard → Logs → Realtime

### Error de conexión

```javascript
// Debug de conexión
const debugConnection = async () => {
  try {
    const { data, error } = await supabase
      .from('gps_tracking_extended')
      .select('count')
      .limit(1);
    
    console.log('Conexión OK:', !error);
    console.log('Error:', error);
  } catch (e) {
    console.error('Error de conexión:', e);
  }
};

debugConnection();
```

## 📊 Monitoreo Continuo

```javascript
// Dashboard de métricas en consola

const dashboard = () => {
  let insertCount = 0;
  let updateCount = 0;
  let deleteCount = 0;
  let lastEvent = null;
  
  const channel = supabase
    .channel('dashboard')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'gps_tracking_extended' },
      (payload) => {
        switch(payload.eventType) {
          case 'INSERT': insertCount++; break;
          case 'UPDATE': updateCount++; break;
          case 'DELETE': deleteCount++; break;
        }
        lastEvent = new Date().toISOString();
      }
    )
    .subscribe();
  
  // Imprimir stats cada 10 segundos
  setInterval(() => {
    console.clear();
    console.log('═══════════════════════════════════');
    console.log('📊 DASHBOARD DE REALTIME');
    console.log('═══════════════════════════════════');
    console.log(`✅ Inserts:  ${insertCount}`);
    console.log(`🔄 Updates:  ${updateCount}`);
    console.log(`❌ Deletes:  ${deleteCount}`);
    console.log(`⏰ Último evento: ${lastEvent || 'N/A'}`);
    console.log('═══════════════════════════════════');
  }, 10000);
  
  return channel;
};

// Iniciar dashboard
const dashboardChannel = dashboard();
```

## 🎯 Scripts de Carga

```sql
-- Generar tráfico de prueba (100 posiciones aleatorias)
DO $$
DECLARE
  i INTEGER;
  movil_id VARCHAR;
  lat NUMERIC;
  lon NUMERIC;
  vel NUMERIC;
BEGIN
  FOR i IN 1..100 LOOP
    movil_id := (100 + floor(random() * 10))::VARCHAR;
    lat := -34.90 + (random() * 0.05);
    lon := -56.16 + (random() * 0.05);
    vel := 20 + (random() * 60);
    
    INSERT INTO gps_tracking_extended (
      movil, escenario_id, latitud, longitud, 
      fecha_hora, velocidad, accuracy, battery_level
    ) VALUES (
      movil_id, 1, lat, lon, 
      NOW() + (i || ' seconds')::INTERVAL, 
      vel, 10, 70 + floor(random() * 30)
    );
    
    PERFORM pg_sleep(0.5); -- Pausa de 0.5 segundos
  END LOOP;
  
  RAISE NOTICE '✅ Insertadas 100 posiciones de prueba';
END $$;
```

¡Listo para probar! 🚀
