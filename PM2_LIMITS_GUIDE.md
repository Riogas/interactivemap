# 📊 Guía de Límites y Optimización PM2

## 🎯 ¿Qué son los límites de PM2?

PM2 permite configurar **límites de recursos** para prevenir que tu aplicación:
- Consuma toda la memoria del servidor (memory leak)
- Se reinicie constantemente (crash loop)
- Sature el CPU
- Tenga demasiados file descriptors abiertos

---

## 📋 Configuraciones Principales

### 1. **Límites de Memoria**

```javascript
max_memory_restart: '1G'  // Reinicia si usa más de 1GB RAM
```

**Cómo elegir el valor:**
```bash
# Ver uso actual de memoria
pm2 describe track | grep memory

# Uso típico por tipo de app:
# - Next.js pequeña: 200-500 MB
# - Next.js mediana: 500 MB - 1 GB
# - Next.js grande: 1-2 GB
# - Con batching GPS: +100-200 MB
```

**Valores recomendados:**
- Servidor con 2GB RAM: `max_memory_restart: '800M'`
- Servidor con 4GB RAM: `max_memory_restart: '1.5G'`
- Servidor con 8GB RAM: `max_memory_restart: '2G'`

---

### 2. **Límites de Reinicio**

```javascript
max_restarts: 50              // Reintentos antes de rendirse
min_uptime: '10s'             // Tiempo mínimo para considerar "estable"
restart_delay: 4000           // Espera 4s entre reinicios
exp_backoff_restart_delay: 100 // Backoff exponencial
```

**Problema común:**
Si tu app se reinicia **18 veces en 2 minutos** → **hay un bug que debe arreglarse**, no aumentar los límites.

**Cómo diagnosticar:**
```bash
pm2 logs track --err --lines 100  # Ver últimos errores
pm2 describe track                 # Ver razón de reinicios
pm2 monit                          # Monitor en tiempo real
```

---

### 3. **Límites de Conexiones/File Descriptors**

```bash
# Ver límite actual del sistema
ulimit -n
# Output típico: 1024 (muy bajo)

# Ver file descriptors en uso por Track
lsof -p $(pm2 pid track) | wc -l
```

**Problema:**
- Track abre conexiones HTTP, WebSocket, archivos, logs
- Con 1024 FDs, puedes alcanzar el límite con 200-300 usuarios concurrentes
- Síntomas: `EMFILE: too many open files`, `ENFILE`

**Solución:**
```bash
# Temporal (hasta reiniciar servidor)
ulimit -n 65536

# Permanente - Editar /etc/security/limits.conf
sudo nano /etc/security/limits.conf

# Agregar:
*    soft nofile 65536
*    hard nofile 65536
root soft nofile 65536
root hard nofile 65536

# Aplicar sin reiniciar
sudo sysctl -p
```

---

### 4. **Límites de CPU**

PM2 no limita CPU directamente, pero puedes usar `cgroup` o `docker`:

```javascript
// En pm2.config.js (NO funciona directamente, necesita cgroup)
max_cpu: 80  // ⚠️ Esta opción NO existe en PM2

// Alternativa: Usar nice/cpulimit
exec_interpreter: '/usr/bin/nice',
interpreter_args: '-n 10'  // Reduce prioridad
```

**Monitor CPU:**
```bash
pm2 monit              # Ver CPU en tiempo real
pm2 describe track     # Ver CPU promedio
top -p $(pm2 pid track)  # Ver detalles
```

---

### 5. **Límites de Logs**

```javascript
// pm2.config.js
log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
merge_logs: true,
error_file: 'logs/pm2-error.log',
out_file: 'logs/pm2-out.log',

// PM2 logrotate (instalar módulo)
pm2 install pm2-logrotate

// Configurar rotación
pm2 set pm2-logrotate:max_size 100M        // Rotar cuando llegue a 100MB
pm2 set pm2-logrotate:retain 7             // Mantener últimos 7 días
pm2 set pm2-logrotate:compress true        // Comprimir logs antiguos
pm2 set pm2-logrotate:rotateInterval '0 0 * * *'  // Rotar a medianoche
```

**Ver configuración:**
```bash
pm2 conf pm2-logrotate
```

---

## 🔧 Configuración Óptima para Track

### Para servidor con 4GB RAM:

```javascript
module.exports = {
  apps: [
    {
      name: 'track',
      script: 'node_modules/next/dist/bin/next',
      args: 'start',
      
      // 🏗️ Arquitectura
      exec_mode: 'fork',
      instances: 1,
      
      // 🔄 Gestión de Reinicio
      autorestart: true,
      max_memory_restart: '1.5G',      // ⬆️ Aumentado para batching GPS
      min_uptime: '30s',                // ⬆️ Más tiempo para considerar estable
      max_restarts: 10,                 // ⬇️ Reducido - si falla 10 veces, hay un bug
      restart_delay: 5000,              // Esperar 5s entre reinicios
      exp_backoff_restart_delay: 1000,  // ⬆️ Backoff más agresivo
      
      // ⏱️ Timeouts
      kill_timeout: 10000,              // ⬆️ Dar más tiempo al shutdown graceful
      listen_timeout: 10000,            // ⬆️ Next.js puede tardar en iniciar
      
      // 🌍 Variables de Entorno
      env: {
        NODE_ENV: 'production',
        PORT: 3002,
        HOSTNAME: '0.0.0.0',
        NODE_TLS_REJECT_UNAUTHORIZED: '0',
        UV_THREADPOOL_SIZE: 4,          // ⬆️ Aumentado para más I/O paralelo
        NODE_OPTIONS: '--max-old-space-size=1536', // Límite heap V8
      },
      
      // 📝 Logs
      error_file: 'logs/pm2-error.log',
      out_file: 'logs/pm2-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      
      env_file: '.env.production'
    }
  ]
};
```

---

## 🚀 Optimizaciones Adicionales

### 1. **Aumentar File Descriptors**

```bash
# Ver límite actual
ulimit -n

# Aumentar temporalmente
ulimit -n 65536

# Permanente - Editar /etc/security/limits.conf
sudo tee -a /etc/security/limits.conf << EOF
*    soft nofile 65536
*    hard nofile 65536
root soft nofile 65536
root hard nofile 65536
EOF

# Editar /etc/sysctl.conf
sudo tee -a /etc/sysctl.conf << EOF
fs.file-max = 2097152
fs.nr_open = 2097152
EOF

# Aplicar
sudo sysctl -p
```

### 2. **Instalar PM2 Logrotate**

```bash
pm2 install pm2-logrotate

# Configurar
pm2 set pm2-logrotate:max_size 100M
pm2 set pm2-logrotate:retain 7
pm2 set pm2-logrotate:compress true
pm2 set pm2-logrotate:dateFormat 'YYYY-MM-DD_HH-mm-ss'
pm2 set pm2-logrotate:rotateModule true
```

### 3. **Modo Cluster (Avanzado)**

Para **alta disponibilidad** con múltiples cores:

```javascript
{
  name: 'track',
  script: 'node_modules/next/dist/bin/next',
  args: 'start',
  exec_mode: 'cluster',  // ⚠️ Cambiar a cluster
  instances: 2,          // 2 instancias (max: número de cores)
  // ...resto igual
}
```

**⚠️ Consideraciones:**
- Requiere gestión de sesiones (Redis, database)
- GPSBatchQueue debe ser compartido o usar Redis
- Más complejo, solo si necesitas escalar

---

## 📊 Comandos de Monitoreo

```bash
# Ver límites actuales
pm2 describe track

# Monitor en tiempo real (CPU, RAM)
pm2 monit

# Ver logs en vivo
pm2 logs track

# Ver solo errores
pm2 logs track --err

# Ver estadísticas
pm2 info track

# Ver file descriptors
lsof -p $(pm2 pid track) | wc -l

# Ver límites del sistema
ulimit -a

# Ver memoria disponible
free -h

# Ver procesos por memoria
ps aux --sort=-%mem | head -10
```

---

## 🚨 Problemas Comunes

### ❌ "Error: EMFILE, too many open files"

**Solución:**
```bash
ulimit -n 65536
# Hacer permanente en /etc/security/limits.conf
```

### ❌ "App crashed 10+ times, PM2 stopped restart"

**Solución:**
```bash
pm2 logs track --err --lines 200  # Ver causa raíz
# Arreglar el bug, NO aumentar max_restarts
```

### ❌ "Memory usage keeps growing"

**Solución:**
```javascript
// Activar garbage collection agresivo
NODE_OPTIONS: '--max-old-space-size=1536 --expose-gc'

// Configurar restart por memoria
max_memory_restart: '1.5G'
```

### ❌ "Logs ocupan 10GB de disco"

**Solución:**
```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 100M
pm2 set pm2-logrotate:retain 7

# Limpiar logs actuales
pm2 flush
```

---

## ✅ Checklist Post-Configuración

```bash
# 1. Actualizar pm2.config.js
vim pm2.config.js

# 2. Recargar configuración
pm2 reload track --update-env

# 3. Verificar límites
pm2 describe track | grep -E "max_memory|max_restarts|min_uptime"

# 4. Verificar file descriptors
ulimit -n
lsof -p $(pm2 pid track) | wc -l

# 5. Monitorear durante 1 hora
pm2 monit

# 6. Instalar logrotate si no existe
pm2 list | grep logrotate || pm2 install pm2-logrotate

# 7. Guardar configuración PM2
pm2 save
pm2 startup  # Configurar inicio automático
```

---

## 📚 Referencias

- [PM2 Documentation](https://pm2.keymetrics.io/docs/usage/application-declaration/)
- [Node.js Performance Best Practices](https://nodejs.org/en/docs/guides/simple-profiling/)
- [Linux File Descriptor Limits](https://www.kernel.org/doc/html/latest/admin-guide/sysctl/fs.html)
