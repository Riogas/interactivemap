# 🚨 Guía de Respuesta Rápida ante Ataques

**Para:** Administradores del Sistema
**Propósito:** Respuesta inmediata ante intentos de ataque detectados

---

## ⚠️ Síntomas de Ataque

### 1. Alto Volumen de Requests 429 (Rate Limit)
**Indicador:** Muchas respuestas 429 en logs
```bash
# Ver logs
pm2 logs trackmovil --lines 100 | grep "429"
```

**Acción Inmediata:**
1. Identificar IP atacante en logs
2. Bloquear IP a nivel de firewall/nginx
3. Revisar patrón de ataque

### 2. Intentos de Acceso No Autorizado (401/403)
**Indicador:** Múltiples 401/403 desde misma IP
```bash
pm2 logs trackmovil --lines 100 | grep "401\|403"
```

**Acción Inmediata:**
1. Verificar si es sistema legítimo sin API Key
2. Si es ataque, bloquear IP
3. Si es sistema legítimo, verificar que tenga API Key correcta

### 3. Actividad Sospechosa Detectada
**Indicador:** Mensajes "Actividad sospechosa detectada" en logs
```bash
pm2 logs trackmovil --lines 100 | grep "sospechosa"
```

**Acción Inmediata:**
1. **CRÍTICO:** IP está intentando path traversal, XSS o SQL injection
2. Bloquear IP inmediatamente a nivel de firewall
3. Revisar si lograron acceder a algún recurso
4. Analizar logs completos de esa IP

### 4. Intentos de Uso de Rutas No Permitidas en Proxy
**Indicador:** "Ruta no permitida por políticas de seguridad"
```bash
pm2 logs trackmovil --lines 100 | grep "no permitida"
```

**Acción Inmediata:**
1. Identificar qué ruta intentaron acceder
2. Verificar si es ataque SSRF
3. Bloquear IP si es intento malicioso
4. Si es uso legítimo, agregar ruta a lista blanca en `/api/proxy/[...path]/route.ts`

---

## 🔴 RESPUESTA INMEDIATA - Ataque en Curso

### Paso 1: Identificar IP Atacante (30 segundos)
```bash
# Ver últimas 500 líneas de logs
pm2 logs trackmovil --lines 500

# Buscar patrones de ataque
pm2 logs trackmovil --lines 500 | grep -E "429|403|sospechosa"
```

### Paso 2: Bloquear IP Temporalmente (1 minuto)

#### Opción A - Con UFW (Ubuntu)
```bash
sudo ufw deny from 123.456.789.0
sudo ufw status
```

#### Opción B - Con iptables
```bash
sudo iptables -A INPUT -s 123.456.789.0 -j DROP
sudo iptables -L
```

#### Opción C - Con Nginx (si usas proxy inverso)
```nginx
# /etc/nginx/conf.d/blocklist.conf
deny 123.456.789.0;
```
```bash
sudo nginx -t
sudo systemctl reload nginx
```

### Paso 3: Verificar que Ataque Se Detuvo (30 segundos)
```bash
# Monitorear logs en tiempo real
pm2 logs trackmovil --lines 0

# Buscar esa IP específica
pm2 logs trackmovil --lines 100 | grep "123.456.789.0"
```

### Paso 4: Análisis de Daños (5 minutos)

#### Verificar si accedieron a datos sensibles
```bash
# Buscar requests exitosos (200) de esa IP
pm2 logs trackmovil --lines 1000 | grep "123.456.789.0" | grep "200"

# Si hay 200 OK, verificar qué endpoints accedieron
pm2 logs trackmovil --lines 1000 | grep "123.456.789.0" | grep "GET\|POST\|PUT\|DELETE"
```

#### Verificar intentos de importación maliciosa
```bash
# Ver si intentaron usar rutas de importación
pm2 logs trackmovil --lines 1000 | grep "123.456.789.0" | grep "/api/import"
```

---

## 🟡 RESPUESTA PREVENTIVA - Múltiples Intentos

### Si ves múltiples IPs atacando (posible botnet)

#### 1. Activar Cloudflare (si disponible)
```bash
# Cloudflare bloqueará automáticamente muchos ataques
# Activar "Under Attack Mode" temporalmente
```

#### 2. Aumentar Rate Limiting temporalmente
```typescript
// lib/rate-limit.ts
const RATE_LIMITS = {
  public: { requests: 50, window: 60000 },      // Reducido de 100 a 50
  import: { requests: 10, window: 60000 },      // Reducido de 20 a 10
  auth: { requests: 3, window: 300000 },        // Reducido de 5 a 3
  proxy: { requests: 25, window: 60000 },       // Reducido de 50 a 25
};
```
```bash
# Reiniciar aplicación
pm2 restart trackmovil
```

#### 3. Bloquear países específicos (si aplica)
```bash
# Con iptables + geoip
sudo apt-get install xtables-addons-common
sudo xt_geoip_build -D /usr/share/xt_geoip/
sudo iptables -A INPUT -m geoip --src-cc CN,RU -j DROP
```

---

## 🟢 RESPUESTA POST-ATAQUE - Análisis Forense

### 1. Exportar Logs para Análisis
```bash
# Guardar logs de las últimas 24 horas
pm2 logs trackmovil --lines 10000 > attack_logs_$(date +%Y%m%d_%H%M%S).log

# Comprimir logs
gzip attack_logs_*.log
```

### 2. Identificar Patrón de Ataque
```bash
# Ver IPs únicas que generaron errores
cat attack_logs_*.log | grep -E "403|429" | grep -oP "\d+\.\d+\.\d+\.\d+" | sort | uniq -c | sort -rn

# Ver rutas más atacadas
cat attack_logs_*.log | grep -E "403|429" | grep -oP "/api/[^ ]+" | sort | uniq -c | sort -rn

# Ver patrones sospechosos específicos
cat attack_logs_*.log | grep -E "\.\./|<script>|' OR 1=1|UNION SELECT"
```

### 3. Verificar Integridad de Datos
```sql
-- Conectar a Supabase y verificar últimas modificaciones
SELECT * FROM gps_tracking 
WHERE created_at > NOW() - INTERVAL '24 hours'
ORDER BY created_at DESC
LIMIT 100;

SELECT * FROM moviles 
WHERE updated_at > NOW() - INTERVAL '24 hours'
ORDER BY updated_at DESC;

SELECT * FROM pedidos 
WHERE created_at > NOW() - INTERVAL '24 hours'
ORDER BY created_at DESC
LIMIT 100;
```

### 4. Rotar API Key si Fue Comprometida
```bash
# Generar nueva API Key
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Output ejemplo: a7f3b9c2d8e4f1a6b5c3d7e2f8a9b4c6d1e5f7a3b8c2d6e9f1a4b7c3d8e5f2a9

# Actualizar .env.production
echo "INTERNAL_API_KEY=a7f3b9c2d8e4f1a6b5c3d7e2f8a9b4c6d1e5f7a3b8c2d6e9f1a4b7c3d8e5f2a9" >> .env.production

# Reiniciar aplicación
pm2 restart trackmovil

# IMPORTANTE: Notificar a todos los sistemas externos que usan la API de importación
```

---

## 📊 Monitoreo Continuo

### Dashboard de Seguridad (Manual)
```bash
# Script de monitoreo cada 5 minutos
watch -n 300 'pm2 logs trackmovil --lines 100 | grep -E "429|403|sospechosa" | tail -20'
```

### Alertas Automáticas (Opcional - Implementar)
```bash
# Crear script de alerta
cat > /usr/local/bin/security-alert.sh << 'EOF'
#!/bin/bash
ATTACKS=$(pm2 logs trackmovil --lines 100 | grep -c "sospechosa")
if [ $ATTACKS -gt 5 ]; then
  echo "⚠️ ALERTA: $ATTACKS intentos de ataque detectados" | mail -s "Seguridad TrackMovil" admin@tu-dominio.com
fi
EOF

chmod +x /usr/local/bin/security-alert.sh

# Agregar a cron cada 10 minutos
crontab -e
# Agregar: */10 * * * * /usr/local/bin/security-alert.sh
```

---

## 🔐 Recuperación y Fortalecimiento

### Después de un Ataque Exitoso

#### 1. Cambiar Todas las Credenciales
```bash
# API Key
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Regenerar Service Role Key en Supabase (si fue comprometido)
# 1. Ir a Supabase Dashboard
# 2. Settings > API
# 3. Regenerate service_role key
```

#### 2. Revisar Lista Blanca de CORS
```typescript
// middleware.ts - Verificar que solo dominios autorizados estén permitidos
const allowedOrigins = [
  process.env.ALLOWED_ORIGIN_1, // Verificar cada uno
  process.env.ALLOWED_ORIGIN_2,
  process.env.ALLOWED_ORIGIN_3,
  process.env.ALLOWED_ORIGIN_4,
].filter(Boolean);
```

#### 3. Revisar Lista Blanca de Proxy
```typescript
// app/api/proxy/[...path]/route.ts - Asegurar que solo rutas necesarias estén permitidas
const ALLOWED_PATHS = [
  /^gestion\/login$/,
  /^gestion\/moviles$/,
  // ... solo rutas estrictamente necesarias
];
```

#### 4. Endurecer Rate Limits
```typescript
// lib/rate-limit.ts - Reducir límites permanentemente si es necesario
const RATE_LIMITS = {
  public: { requests: 50, window: 60000 },   // Más estricto
  import: { requests: 10, window: 60000 },   // Más estricto
  auth: { requests: 3, window: 300000 },     // Más estricto
  proxy: { requests: 25, window: 60000 },    // Más estricto
};
```

---

## 📞 Contactos de Emergencia

### Escalación de Incidentes

#### Nivel 1 - Ataque Detectado y Bloqueado ✅
- **Acción:** Documentar en logs
- **Responsable:** DevOps
- **Tiempo:** < 5 minutos

#### Nivel 2 - Múltiples IPs / Ataque Sostenido 🟡
- **Acción:** Bloquear IPs + Notificar equipo
- **Responsable:** DevOps + Team Lead
- **Tiempo:** < 15 minutos

#### Nivel 3 - Acceso No Autorizado a Datos 🔴
- **Acción:** Rotar credenciales + Análisis forense + Notificar stakeholders
- **Responsable:** DevOps + Security Team + Management
- **Tiempo:** < 1 hora

#### Nivel 4 - Compromiso del Sistema 🚨
- **Acción:** Apagar sistema + Recuperación desde backup + Auditoría completa
- **Responsable:** Todo el equipo + Consultor de seguridad externo
- **Tiempo:** Inmediato

---

## ✅ Checklist Post-Incidente

Después de resolver un ataque, completar:

- [ ] IP(s) atacante(s) bloqueada(s) en firewall
- [ ] Logs exportados y guardados
- [ ] Análisis de intento de ataque documentado
- [ ] Verificación de integridad de datos completada
- [ ] Credenciales rotadas (si fue necesario)
- [ ] Rate limits ajustados (si fue necesario)
- [ ] Lista blanca revisada (si fue necesario)
- [ ] Equipo notificado del incidente
- [ ] Medidas preventivas adicionales implementadas
- [ ] Plan de monitoreo mejorado

---

**Recuerda:** El sistema tiene múltiples capas de protección. La mayoría de los ataques serán bloqueados automáticamente por rate limiting y detección de patrones sospechosos.

**Mantén la calma y sigue los procedimientos.** 🛡️
