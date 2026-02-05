# 🚀 Optimización Track para 100+ Móviles GPS

## 📊 Análisis de Carga

Con **100+ móviles** reportando coordenadas GPS:

```
100 móviles × 1 coord/segundo = 100 coords/segundo
→ 6,000 coords/minuto
→ 360,000 coords/hora
→ 8,640,000 coords/día
```

**Sin batching:** 6,000 requests/min a Supabase 🔥 (INSOSTENIBLE)  
**Con batching (100 coords):** 60 requests/min a Supabase ✅ (99% reducción)

---

## ⚙️ Cambios Aplicados

### 1. **PM2 Config Optimizado**

```javascript
// pm2.config.js
{
  max_memory_restart: '2G',           // ⬆️ 1.5G → 2G
  UV_THREADPOOL_SIZE: 8,              // ⬆️ 4 → 8 (más I/O paralelo)
  NODE_OPTIONS: '--max-old-space-size=2048', // ⬆️ 1536 → 2048MB
  kill_timeout: 15000,                // ⬆️ 10s → 15s (flush queue grande)
}
```

**Razones:**
- Con 100 móviles, la queue puede tener **500 coords en memoria** esperando flush
- Cada coord ~1KB → 500KB en memoria solo para queue
- Más conexiones simultáneas a Supabase y GeneXus
- Shutdown graceful necesita más tiempo para flush completo

---

### 2. **GPS Batch Queue Optimizado**

```typescript
// lib/gps-batch-queue.ts
private readonly BATCH_SIZE = 100;  // ⬆️ 50 → 100
```

**Impacto:**
- Menos requests a Supabase (60/min vs 120/min)
- Menor overhead de red
- Transacciones más eficientes
- Mejor utilización de índices de Supabase

**Trade-off:**
- ⚠️ Latencia: Coords tardan máximo 5s en llegar a DB (aceptable)
- ⚠️ Memoria: Queue puede crecer más entre flushes
- ✅ Performance: Mucho mejor throughput

---

## 🔍 Monitoreo de Conexiones

### ¿Las conexiones se cierran después de cada batch?

**Depende del cliente HTTP usado:**

#### **Supabase Client (PostgREST)**
```typescript
// lib/gps-batch-queue.ts
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  global: {
    fetch: (url, options = {}) => {
      return fetch(url, {
        ...options,
        signal: AbortSignal.timeout(15000),
      });
    },
  },
});
```

- ✅ **Usa HTTP/1.1 Keep-Alive por defecto**
- ✅ **Connection pooling automático** (Node.js Agent)
- ✅ **Reutiliza conexiones TCP** entre requests
- ⚠️ **Timeout 15s** → cierra si no hay actividad

**Comportamiento esperado:**
```
Batch 1 → Abre conexión TCP → INSERT → Mantiene abierta
Batch 2 (5s después) → Reutiliza conexión → INSERT → Mantiene abierta
...
Sin actividad 15s → Cierra conexión automáticamente
```

#### **Axios (Frontend, GeneXus)**
```typescript
// lib/api/auth.ts
const apiClient = axios.create({
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
});
```

- ✅ **Connection pooling por defecto** (Node.js `http.Agent`)
- ✅ **Keep-Alive activado**
- ⚠️ **Máximo 5 conexiones por host** (límite de Node.js Agent)

---

## 📊 Cómo Ver Conexiones en Tiempo Real

### **Script de Monitoreo Continuo**

Ya creé `monitorear-conexiones.sh` que muestra:

```bash
chmod +x monitorear-conexiones.sh
./monitorear-conexiones.sh
```

**Métricas mostradas:**
- 🟢 Status de PM2 (uptime, restarts, memoria, CPU)
- 🌐 Conexiones activas (ESTABLISHED, CLOSE_WAIT, TIME_WAIT)
- 🗄️ Conexiones específicas a Supabase
- 📂 File descriptors en uso
- ✅ Batches GPS exitosos
- ❌ Errores recientes
- 📍 Throughput GPS (coords/minuto)

---

### **Comandos Manuales**

#### 1. **Ver conexiones activas de Track**
```bash
# Obtener PID de Track
TRACK_PID=$(pm2 pid track)

# Ver todas las conexiones
lsof -p $TRACK_PID | grep -E "ESTABLISHED|CLOSE_WAIT|TIME_WAIT"

# Contar por estado
echo "ESTABLISHED: $(lsof -p $TRACK_PID | grep ESTABLISHED | wc -l)"
echo "CLOSE_WAIT: $(lsof -p $TRACK_PID | grep CLOSE_WAIT | wc -l)"
echo "TIME_WAIT: $(lsof -p $TRACK_PID | grep TIME_WAIT | wc -l)"
```

#### 2. **Ver conexiones a Supabase específicamente**
```bash
lsof -p $TRACK_PID | grep -i supabase

# O por hostname de Supabase
lsof -p $TRACK_PID | grep "lgniuhelyyizoursmsmi.supabase.co"
```

#### 3. **Ver conexiones por puerto**
```bash
# Conexiones salientes de Track
netstat -tnp | grep $TRACK_PID

# Conexiones entrantes al puerto 3002
netstat -tn | grep :3002 | grep ESTABLISHED
```

#### 4. **Monitorear en tiempo real**
```bash
# Watch cada 2 segundos
watch -n 2 'lsof -p $(pm2 pid track) | grep -c ESTABLISHED'

# O con ss (más rápido)
watch -n 2 'ss -tnp | grep "pid=$(pm2 pid track)" | wc -l'
```

#### 5. **Ver file descriptors en uso**
```bash
# Cantidad total
lsof -p $TRACK_PID | wc -l

# Límite del proceso
cat /proc/$TRACK_PID/limits | grep "open files"

# Límite del sistema
ulimit -n
```

---

## 🚨 Alertas y Umbrales

### **Conexiones ESTABLISHED**
```
< 50:  ✅ Normal
50-100: ⚠️ Carga media
100-200: ⚠️ Carga alta
> 200:  🚨 Posible problema de pool
```

**Acción:** Verificar si Supabase está lento o hay leak

---

### **Conexiones CLOSE_WAIT**
```
< 10:  ✅ Normal (clientes desconectando correctamente)
10-50: ⚠️ Algunos clientes no cerraron bien
> 50:  🚨 CONNECTION LEAK - reiniciar Track
```

**Causa:** El cliente remoto cerró la conexión pero Track no llamó a `close()`.

**Acción:**
```bash
pm2 restart track  # Libera conexiones huérfanas
```

---

### **File Descriptors**
```
< 200:  ✅ Normal
200-500: ⚠️ Carga media
500-800: ⚠️ Carga alta
> 800:  🚨 Cerca del límite (1024)
```

**Acción:** Aumentar límite
```bash
ulimit -n 65536
```

---

## 🔧 Optimizaciones Adicionales

### 1. **Aumentar Límite de File Descriptors (CRÍTICO)**

```bash
# Ver límite actual
ulimit -n
# Si es 1024 → INSUFICIENTE para 100+ móviles

# Temporal (hasta reiniciar)
ulimit -n 65536

# Permanente
sudo nano /etc/security/limits.conf
```

Agregar:
```
*    soft nofile 65536
*    hard nofile 65536
root soft nofile 65536
root hard nofile 65536
```

```bash
# Aplicar
sudo sysctl -p

# Verificar
ulimit -n  # Debe mostrar 65536
```

---

### 2. **Optimizar TCP/IP Stack (Avanzado)**

```bash
sudo nano /etc/sysctl.conf
```

Agregar:
```conf
# Aumentar límites de conexiones
net.core.somaxconn = 4096
net.ipv4.tcp_max_syn_backlog = 8192

# Reutilizar sockets TIME_WAIT más rápido
net.ipv4.tcp_tw_reuse = 1

# Reducir tiempo de TIME_WAIT
net.ipv4.tcp_fin_timeout = 15

# Aumentar rango de puertos efímeros
net.ipv4.ip_local_port_range = 10000 65000

# Aumentar buffers TCP
net.core.rmem_max = 16777216
net.core.wmem_max = 16777216
net.ipv4.tcp_rmem = 4096 87380 16777216
net.ipv4.tcp_wmem = 4096 65536 16777216
```

```bash
# Aplicar sin reiniciar
sudo sysctl -p
```

---

### 3. **Connection Pooling Manual (Si Necesario)**

Si ves demasiadas conexiones abiertas, puedes limitar el pool:

```typescript
// lib/supabase.ts
import { createClient } from '@supabase/supabase-js';
import http from 'http';
import https from 'https';

const httpAgent = new http.Agent({
  keepAlive: true,
  maxSockets: 10,        // Máximo 10 conexiones simultáneas
  maxFreeSockets: 5,     // Mantener 5 en pool
  timeout: 60000,        // 60s timeout
});

const httpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 10,
  maxFreeSockets: 5,
  timeout: 60000,
});

export const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  global: {
    fetch: (url, options = {}) => {
      const isHttps = url.startsWith('https');
      return fetch(url, {
        ...options,
        agent: isHttps ? httpsAgent : httpAgent,
        signal: options.signal || AbortSignal.timeout(15000),
      });
    },
  },
});
```

---

### 4. **Instalar PM2 Logrotate (Prevenir disco lleno)**

Con 100+ móviles, los logs crecen RÁPIDO:

```bash
pm2 install pm2-logrotate

# Configurar
pm2 set pm2-logrotate:max_size 100M        # Rotar a 100MB
pm2 set pm2-logrotate:retain 3             # Mantener solo 3 días
pm2 set pm2-logrotate:compress true        # Comprimir logs viejos
pm2 set pm2-logrotate:rotateInterval '0 0 * * *'  # Rotar a medianoche
```

---

## 📈 Métricas Esperadas (100 móviles)

### **Sin Optimización** ❌
```
Requests GPS:        6,000/min
Memoria Track:       500MB → 1GB → CRASH
Conexiones activas:  200-500 (saturación)
File descriptors:    800+ (cerca del límite)
CPU:                 80-100%
Restarts PM2:        10+ por hora
```

### **Con Optimización** ✅
```
Requests GPS:        60/min (batching)
Memoria Track:       800MB-1.2GB (estable)
Conexiones activas:  20-50 (normal)
File descriptors:    100-300 (saludable)
CPU:                 20-40%
Restarts PM2:        0 por día
```

---

## 🧪 Testing de Carga

### Simular 100 móviles:

```bash
# Script de prueba
for i in {1..100}; do
  curl -X POST http://localhost:3002/api/import/gps \
    -H "Content-Type: application/json" \
    -H "x-api-key: $API_KEY" \
    -d "{
      \"movil_id\": \"$i\",
      \"latitud\": -34.9011,
      \"longitud\": -56.1645,
      \"timestamp\": \"$(date -u +%Y-%m-%dT%H:%M:%S.000Z)\"
    }" &
done

# Ver resultado
pm2 logs track --lines 50
```

---

## ✅ Checklist de Deployment

```bash
# 1. Pull y rebuild
cd /var/www/track
git pull
rm -rf .next
pnpm build

# 2. Aumentar file descriptors
ulimit -n 65536

# 3. Verificar límites en /etc/security/limits.conf
cat /etc/security/limits.conf | grep nofile

# 4. Reload PM2 con nueva config
pm2 reload track --update-env

# 5. Verificar configuración
pm2 describe track | grep -E "max_memory|UV_THREADPOOL"

# 6. Iniciar monitor
./monitorear-conexiones.sh
```

---

## 🆘 Troubleshooting

### Problema: "Too many open files"
```bash
ulimit -n 65536
pm2 restart track
```

### Problema: CLOSE_WAIT > 100
```bash
# Connection leak - reiniciar Track
pm2 restart track
```

### Problema: Memoria crece sin parar
```bash
# Ver si es memory leak
pm2 describe track | grep memory
node --inspect $(pm2 pid track)  # Debugger
# O reducir BATCH_SIZE a 50 temporalmente
```

### Problema: Batches GPS fallan
```bash
# Ver errores específicos
pm2 logs track --err --lines 100 | grep "ERROR AL INSERTAR"

# Verificar conectividad Supabase
curl -v https://lgniuhelyyizoursmsmi.supabase.co/rest/v1/
```

---

## 📚 Referencias

- [Node.js HTTP Keep-Alive](https://nodejs.org/api/http.html#http_agent_keepalive)
- [Supabase Connection Pooling](https://supabase.com/docs/guides/database/connection-pooling)
- [Linux TCP Tuning](https://www.kernel.org/doc/Documentation/networking/ip-sysctl.txt)
- [PM2 Best Practices](https://pm2.keymetrics.io/docs/usage/application-declaration/)
