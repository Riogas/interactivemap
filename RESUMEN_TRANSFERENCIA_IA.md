# 📤 Resumen para Transferencia a Otra IA

**USAR ESTE DOCUMENTO SI NECESITAS CONSULTAR A OTRA IA ESPECIALIZADA**

---

## 🎯 Contexto del Problema (SIN RUIDO)

### Arquitectura

```
Cliente → NGINX (SGM) → Apache/Tomcat → TRACK NGINX → Node.js (PM2, :3002)
```

### Síntomas

1. **NGINX SGM:** Timeouts intermitentes (`upstream timed out`)
2. **TRACK NGINX:** Connection refused a 127.0.0.1:3002
3. **PM2:** 16 restarts en 3 minutos
4. **Sistema:** 1000+ conexiones TCP en estado SYN-SENT

### Causa Raíz Identificada

**Servidor comprometido con malware `pnscan`:**
- Scanner de Redis (puerto 6379)
- Miles de conexiones salientes simultáneas
- Agota: puertos efímeros, file descriptors, CPU
- Consecuencia: PM2 cae, NGINX no puede conectar, API falla

### Confirmación

```bash
ss -tanp state syn-sent  # muestra users:(("pnscan",pid=XXX))
lsof -iTCP -sTCP:SYN_SENT  # pnscan → IPs públicas → :6379
```

---

## ✅ Lo Que NO Es el Problema

- ❌ NO es código de la aplicación Track
- ❌ NO es configuración de proxies (NGINX/Apache)
- ❌ NO es error de lógica de negocio
- ❌ NO es problema de límites PM2 (aunque sí necesitan ajuste)
- ❌ NO es culpa del desarrollador

---

## 🚨 Lo Que SÍ Es el Problema

- ✅ **Servidor comprometido con malware/bot**
- ✅ **Saturación de recursos de red/kernel**
- ✅ **Posible cryptominer, scanner, o bot de ataque**
- ✅ **Requiere remediación de infraestructura/seguridad**

---

## 🛠️ Acciones Necesarias (Infra)

### Inmediatas

```bash
# 1. Matar proceso
pkill -9 pnscan

# 2. Bloquear puerto Redis saliente
iptables -I OUTPUT -p tcp --dport 6379 -j REJECT

# 3. Verificar normalización
ss -tan state syn-sent | wc -l  # debe ser < 10

# 4. Restart Track
pm2 restart track
```

### Investigación Forense

Buscar persistencia en:
- `systemctl list-units | grep -i pnscan`
- `crontab -l` (todos los usuarios)
- `/etc/cron.*`
- `find / -name "*pnscan*"`
- `/root/.ssh/authorized_keys`

### Hardening

- Firewall egress (DROP por defecto, whitelist salidas)
- Aumentar file descriptors a 65536
- Instalar fail2ban, rkhunter, ClamAV
- Cambiar contraseñas
- Revisar SSH keys

---

## 🤖 Prompt para Otra IA (Enfoque Código)

```
CONTEXTO:
Aplicación Node.js/Next.js en PM2 (puerto 3002) detrás de NGINX.
El servidor host está comprometido con malware "pnscan" que genera miles de 
conexiones salientes, agotando recursos del kernel (puertos efímeros, file descriptors).

SÍNTOMA EN LA APP:
PM2 se reinicia constantemente porque el sistema no tiene recursos para 
crear nuevas conexiones (a Supabase, GeneXus, etc).

PREGUNTA:
Necesito estrategias de código/configuración para que mi app Node/PM2 sea 
más resiliente ante:
1. Agotamiento de file descriptors del sistema
2. Falta de puertos efímeros disponibles
3. Resource starvation por procesos externos

Específicamente:
- ¿Cómo configurar connection pooling robusto?
- ¿Cómo manejar EMFILE/ENFILE gracefully?
- ¿Cómo implementar circuit breakers en llamadas HTTP?
- ¿Cómo configurar PM2 para reinicio inteligente?
- ¿Qué health checks implementar?

NOTA: El problema de infra se está resolviendo en paralelo (matar malware, 
hardening). Pero necesito la app resiliente ante futuros incidentes similares.
```

---

## 📊 Estado de los Componentes

| Componente | Estado | Acción |
|------------|--------|--------|
| Código Track | ✅ OK | Ninguna (está bien) |
| NGINX/Apache | ✅ OK | Ninguna (configuración correcta) |
| PM2 Config | ⚠️ OK | Ajustar límites (ya hecho) |
| **Servidor Host** | 🔴 **COMPROMETIDO** | **Remediar YA** |

---

## 🎯 Optimizaciones Ya Aplicadas (Código)

### PM2 Config Optimizado
```javascript
{
  max_memory_restart: '2G',
  UV_THREADPOOL_SIZE: 8,
  NODE_OPTIONS: '--max-old-space-size=2048',
  kill_timeout: 15000,
}
```

### GPS Batch Queue
- Batch size: 100 coords
- Flush interval: 5s
- Retry: 3 intentos con backoff
- Fallback: Guardar en archivo si falla

### Timeouts Configurados
- Supabase: 15s
- API externa: 30s
- Operaciones lentas: 60s

### Connection Pooling
- HTTP/1.1 Keep-Alive activado
- Conexiones reutilizadas entre requests
- Timeout de inactividad: 15s

---

## 💡 Preguntas para IA Especializada

### Si consultas a IA de Infraestructura:
> "¿Cómo endurecer un servidor Ubuntu con Node.js que fue comprometido por malware 
> pnscan? Necesito firewall egress, monitoreo de procesos sospechosos, y prevención 
> de SYN floods salientes."

### Si consultas a IA de Código:
> "¿Cómo hacer una app Node.js/PM2 resiliente ante agotamiento de recursos del 
> sistema (file descriptors, puertos efímeros) causado por procesos externos? 
> Necesito connection pooling, error handling, circuit breakers, y health checks."

### Si consultas a IA de Seguridad:
> "Servidor Linux comprometido con scanner pnscan. ¿Qué pasos de incident response 
> seguir? ¿Cómo asegurar que no hay backdoors? ¿Reinstalar o limpiar? ¿Cómo 
> prevenir reinfección?"

---

## 📚 Documentación Completa

Ver en el repositorio:
- `SERVIDOR_COMPROMETIDO.md` - Análisis completo y remediación
- `OPTIMIZACION_100_MOVILES.md` - Optimizaciones de código
- `PM2_LIMITS_GUIDE.md` - Configuración PM2
- `diagnostico-load.sh` - Script diagnóstico
- `diagnostico-conexion.sh` - Monitor de conexiones
- `aumentar-fd-limit.sh` - Script para file descriptors

---

## ⚠️ IMPORTANTE

**Este problema NO tiene nada que ver con:**
- Calidad del código
- Decisiones de arquitectura
- Configuración de desarrollo
- Habilidades del equipo

**Es un problema de seguridad de infraestructura que afecta TODO el servidor, 
no solo la aplicación Track.**

---

**Última actualización:** 2026-02-05  
**Tipo de documento:** Technical Handoff / Knowledge Transfer
