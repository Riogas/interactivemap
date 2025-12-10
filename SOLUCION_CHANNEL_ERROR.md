# 🔧 Solución: Error "CHANNEL_ERROR" en Supabase Realtime

## ❌ Problema

```
Error en suscripción GPS: "CHANNEL_ERROR"
```

Este error aparece **intermitentemente** cuando la conexión WebSocket con Supabase Realtime falla.

---

## 🔍 Causas Comunes

### 1. **Problemas de Red/Conexión**
- ❌ Conexión WiFi inestable
- ❌ Firewall bloqueando WebSockets
- ❌ VPN interfiriendo con conexiones persistentes
- ❌ ISP con NAT agresivo que cierra conexiones idle

### 2. **Límites de Supabase**
- ❌ Demasiadas conexiones simultáneas (especialmente en Free Tier)
- ❌ Límite de canales por cliente (max 100)
- ❌ Rate limiting del servidor

### 3. **Configuración del Cliente**
- ❌ Timeout muy corto (default: 10s)
- ❌ Sin heartbeat para mantener conexión viva
- ❌ Canales no se limpian correctamente en re-renders

### 4. **Problemas del Servidor Supabase**
- ❌ Servidor sobrecargado
- ❌ Mantenimiento programado
- ❌ Latencia alta (>1000ms)

---

## ✅ Soluciones Implementadas

### 1. **Reconexión Automática**

```typescript
// ✅ Ahora el hook reintenta automáticamente hasta 5 veces
const MAX_RETRIES = 5;
const RETRY_DELAY = 3000; // 3 segundos entre intentos

// Si falla, espera 3 segundos y reintenta
if (status === 'CHANNEL_ERROR' && retryCount < MAX_RETRIES) {
  setTimeout(() => setupChannel(), RETRY_DELAY);
}
```

**Beneficios:**
- ✅ No requiere recargar la página
- ✅ Automático y transparente para el usuario
- ✅ Evita desconexiones permanentes por problemas temporales

### 2. **Nombres de Canal Únicos**

```typescript
// ✅ Cada suscripción usa un nombre único con timestamp
const channelName = `gps-tracking-${escenarioId}-${Date.now()}`;
```

**Previene:**
- ❌ Conflictos entre múltiples suscripciones
- ❌ Canales "fantasma" que no se limpiaron correctamente
- ❌ Errores al re-suscribirse rápidamente

### 3. **Heartbeat y Timeouts Mejorados**

```typescript
// En lib/supabase.ts
realtime: {
  timeout: 20000, // 20 segundos (aumentado de 10s)
  heartbeatIntervalMs: 15000, // Heartbeat cada 15s
}
```

**Beneficios:**
- ✅ Mantiene conexión viva en redes con NAT
- ✅ Detecta desconexiones más rápido
- ✅ Reduce CHANNEL_ERROR por timeout

### 4. **Limpieza Correcta de Recursos**

```typescript
// ✅ Limpia correctamente el canal y los timers
return () => {
  isComponentMounted = false;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (channel) supabase.removeChannel(channel);
};
```

**Previene:**
- ❌ Memory leaks
- ❌ Múltiples suscripciones activas
- ❌ Intentos de reconexión después de desmontar componente

### 5. **Feedback Visual al Usuario**

```typescript
// ✅ El usuario ve el estado de reconexión
setError(`Reconectando... (intento ${retryCount + 1}/${MAX_RETRIES})`);
```

---

## 🧪 Cómo Probar la Solución

### Test 1: Simular Pérdida de Conexión

```typescript
// En la consola del navegador (F12)
// Deshabilita temporalmente la conexión
navigator.connection && navigator.connection.close?.();

// O simplemente desactiva WiFi por 5 segundos
// ✅ Verás: "Reconectando... (intento 1/5)"
// ✅ Al reconectar: "✅ Conectado a Realtime GPS Tracking"
```

### Test 2: Verificar Logs

```typescript
// En la consola deberías ver:
🔄 Iniciando suscripción GPS Tracking...
📡 Estado de suscripción GPS: SUBSCRIBED
✅ Conectado a Realtime GPS Tracking

// Si hay error:
⚠️ Error en suscripción GPS: CHANNEL_ERROR. Intento 1/5
🔄 Intentando reconectar...
```

### Test 3: Múltiples Componentes

```typescript
// Abre la app en varias pestañas
// ✅ Cada una debería conectarse correctamente sin interferir
```

---

## 🔧 Configuración Adicional (Opcional)

### Aumentar Timeouts (Redes Lentas)

```typescript
// En lib/supabase.ts
realtime: {
  timeout: 30000, // 30 segundos
  heartbeatIntervalMs: 20000, // 20 segundos
}
```

### Aumentar Reintentos

```typescript
// En useRealtimeSubscriptions.ts
const MAX_RETRIES = 10; // Más reintentos
const RETRY_DELAY = 5000; // 5 segundos entre intentos
```

### Habilitar Logs Detallados de Supabase

```typescript
import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(url, key, {
  // ... otras configuraciones
  global: {
    headers: {
      'x-client-info': 'trackmovil-realtime',
    },
  },
  db: {
    schema: 'public',
  },
  // ✅ Logs detallados para debugging
  auth: {
    debug: true, // Solo para desarrollo
  },
});
```

---

## 📊 Monitoreo de Conexiones

### Ver Estado en Supabase Dashboard

1. Ve a: https://app.supabase.com/project/YOUR_PROJECT/database/replication
2. Verifica que `gps_tracking_extended` esté en `supabase_realtime`
3. Ve a: Logs → Realtime
4. Busca errores relacionados con WebSocket

### Verificar Conexiones WebSocket

```javascript
// En consola del navegador (F12 → Network → WS)
// Deberías ver:
// - wss://your-project.supabase.co/realtime/v1/websocket
// - Status: 101 Switching Protocols
// - Messages: heartbeat, subscription confirmations
```

---

## 🚨 Cuando Buscar Más Ayuda

Si después de los 5 reintentos sigue fallando:

### 1. Verifica Supabase Status
- 🌐 https://status.supabase.com/
- ¿Hay incidentes activos?

### 2. Verifica Configuración
```sql
-- En Supabase SQL Editor
SELECT * FROM pg_publication_tables 
WHERE pubname = 'supabase_realtime';

-- Debe mostrar: gps_tracking_extended
```

### 3. Verifica Políticas RLS
```sql
SELECT tablename, policyname, cmd, qual 
FROM pg_policies 
WHERE tablename = 'gps_tracking_extended';
```

### 4. Verifica Límites de Plan
- Free Tier: Max 2 concurrent connections
- Pro: Max 100 concurrent connections
- Ve a: Dashboard → Settings → Billing

### 5. Contacta Soporte
- 💬 Discord: https://discord.supabase.com
- 📧 Email: support@supabase.io
- Con información:
  - Logs de consola
  - Hora exacta del error
  - ID del proyecto
  - Plan actual

---

## 📈 Mejoras Futuras

### Implementar Exponential Backoff

```typescript
// Aumentar tiempo entre reintentos exponencialmente
const delay = RETRY_DELAY * Math.pow(2, retryCount);
setTimeout(() => setupChannel(), delay);
```

### Notificaciones al Usuario

```typescript
// Mostrar un toast/snackbar cuando se pierde la conexión
if (status === 'CHANNEL_ERROR') {
  toast.warn('Conexión perdida. Reintentando...');
}
```

### Métricas de Estabilidad

```typescript
// Rastrear estabilidad de conexión
const [connectionStats, setConnectionStats] = useState({
  totalConnections: 0,
  failures: 0,
  avgRetries: 0,
});
```

---

## ✅ Checklist de Troubleshooting

- [ ] ¿Verificaste tu conexión a internet?
- [ ] ¿Probaste desde otra red/dispositivo?
- [ ] ¿Desactivaste VPN/proxy?
- [ ] ¿Verificaste firewall/antivirus?
- [ ] ¿Confirmaste que la tabla está en `supabase_realtime`?
- [ ] ¿Verificaste las políticas RLS?
- [ ] ¿Revisaste logs en Supabase Dashboard?
- [ ] ¿Confirmaste que no excediste límites de plan?
- [ ] ¿Probaste en modo incógnito (sin extensiones)?

---

## 📚 Referencias

- [Supabase Realtime Docs](https://supabase.com/docs/guides/realtime)
- [WebSocket Error Codes](https://developer.mozilla.org/en-US/docs/Web/API/CloseEvent/code)
- [Supabase Realtime GitHub Issues](https://github.com/supabase/realtime/issues)

---

## 🎉 Resumen

### Lo que se mejoró:

1. ✅ **Reconexión automática** con 5 reintentos
2. ✅ **Nombres de canal únicos** para evitar conflictos
3. ✅ **Heartbeat cada 15s** para mantener conexión viva
4. ✅ **Timeout de 20s** (aumentado de 10s)
5. ✅ **Limpieza correcta** de recursos en unmount
6. ✅ **Feedback visual** al usuario durante reconexión

### Resultado:

El error `CHANNEL_ERROR` ahora:
- 🟢 Se recupera automáticamente en la mayoría de casos
- 🟢 No requiere recargar la página
- 🟢 Proporciona feedback claro al usuario
- 🟢 Es mucho menos frecuente gracias a heartbeat

---

**¡Tu aplicación Realtime ahora es mucho más robusta! 🚀**
