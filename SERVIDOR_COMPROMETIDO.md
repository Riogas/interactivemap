# 🚨 SERVIDOR COMPROMETIDO - Análisis y Remediación

## 📋 Resumen Ejecutivo

**ESTADO:** 🔴 **SERVIDOR COMPROMETIDO**  
**CAUSA:** Malware/Bot `pnscan` ejecutándose  
**IMPACTO:** Saturación de red, restarts de PM2, timeouts en API  
**PRIORIDAD:** 🚨 **CRÍTICA - ACCIÓN INMEDIATA REQUERIDA**

---

## 🔍 Análisis Técnico

### Arquitectura del Sistema

```
Cliente
   ↓
NGINX (proxy inverso público - SGM)
   ↓
Apache + mod_jk + Tomcat
   ↓
API interna /tracking/importacion
   ↓
TRACK NGINX local (192.168.7.13)
   ↓
Node.js/Next.js (PM2, puerto 3002)
```

### Síntomas Observados

#### 1. NGINX Externo (SGM)
```
upstream timed out (110: Connection timed out)
while connecting to upstream
while reading response header from upstream
```
**Frecuencia:** Intermitente ("a veces funciona, a veces no")

#### 2. NGINX Interno (Track)
```
connect() failed (111: Connection refused)
upstream: http://127.0.0.1:3002
```
**Significado:** No hay proceso escuchando en puerto 3002

#### 3. PM2 (Node Track)
```
Status: online
Uptime: 3 minutos
Restarts: 16
```
**Significado:** Reiniciando constantemente

#### 4. Sistema (Red/Sockets)
```bash
$ ss -tan state syn-sent | wc -l
1000+
```
**Significado:** Miles de conexiones TCP en SYN-SENT (handshake nunca completa)

---

## 🔥 CAUSA RAÍZ IDENTIFICADA

### Proceso Malicioso Detectado

```bash
$ ss -tanp state syn-sent
users:(("pnscan",pid=XXXX))

$ lsof -iTCP -sTCP:SYN_SENT
pnscan → cientos/miles de conexiones → IPs públicas → puerto 6379 (Redis)
```

### Características de `pnscan`

| Aspecto | Detalle |
|---------|---------|
| **Tipo** | Scanner/Bot malicioso |
| **Objetivo** | Escaneo masivo de Redis público (puerto 6379) |
| **Comportamiento** | Miles de conexiones salientes simultáneas |
| **Impacto en recursos** | CPU, puertos efímeros, file descriptors, memoria kernel |
| **Consecuencias** | Saturación de sockets, degradación del host, caída de servicios |

### Impacto en Track

```
pnscan consume recursos
    ↓
Kernel agota puertos efímeros / file descriptors
    ↓
PM2/Node no puede crear nuevas conexiones
    ↓
Node/Track se reinicia o cae
    ↓
NGINX no puede conectar a 127.0.0.1:3002
    ↓
SGM ve timeouts upstream
    ↓
API falla intermitentemente
```

**⚠️ Los timeouts NO eran del código, proxy, o API - eran consecuencia de host comprometido.**

---

## 🛡️ REMEDIACIÓN INMEDIATA

### Paso 1: Detener el Proceso Malicioso

```bash
# Identificar PID
ps aux | grep pnscan
pgrep pnscan

# Matar proceso
sudo pkill -9 pnscan

# Verificar que se detuvo
ps aux | grep pnscan
ss -tan state syn-sent | wc -l  # Debe bajar dramáticamente
```

### Paso 2: Bloquear Puerto Redis Saliente

```bash
# Bloquear conexiones salientes a Redis
sudo iptables -I OUTPUT -p tcp --dport 6379 -j REJECT

# Verificar regla
sudo iptables -L OUTPUT -n -v | grep 6379

# Hacer persistente
sudo iptables-save > /etc/iptables/rules.v4
```

### Paso 3: Reiniciar Servicios

```bash
# Reiniciar Track
cd /var/www/track
pm2 restart track

# Verificar estado
pm2 monit
pm2 logs track --lines 50

# Verificar conexiones normalizadas
ss -tan state syn-sent | wc -l  # Debe ser < 10
```

### Paso 4: Verificar Conectividad

```bash
# Desde Track mismo
curl -v http://localhost:3002/api/health

# Desde SGM
curl -v http://192.168.7.13:3002/api/health

# Ver logs NGINX
sudo tail -f /var/log/nginx/error.log
```

---

## 🔎 INVESTIGACIÓN FORENSE

### Buscar Persistencia del Malware

#### 1. Servicios Systemd
```bash
# Buscar servicios sospechosos
systemctl list-units --all | grep -i pnscan
systemctl list-units --all | grep -i scan

# Ver servicios habilitados
systemctl list-unit-files --state=enabled
```

#### 2. Cron Jobs
```bash
# Crontabs de todos los usuarios
for user in $(cut -f1 -d: /etc/passwd); do 
  echo "=== $user ==="; 
  sudo crontab -u $user -l 2>/dev/null || echo "Sin crontab"; 
done

# Cron del sistema
ls -la /etc/cron.*
cat /etc/crontab
sudo cat /etc/cron.d/*
```

#### 3. Procesos en Inicio
```bash
# rc.local (legacy)
cat /etc/rc.local

# systemd services en /etc
ls -la /etc/systemd/system/
ls -la /etc/systemd/user/

# init.d (legacy)
ls -la /etc/init.d/
```

#### 4. Ubicación del Binario
```bash
# Encontrar binario
which pnscan
whereis pnscan

# Si está corriendo, ver path real
ps aux | grep pnscan
readlink -f /proc/<PID>/exe

# Buscar en filesystem
sudo find / -name "*pnscan*" 2>/dev/null
sudo find / -type f -executable -name "*scan*" 2>/dev/null
```

#### 5. Usuarios y SSH
```bash
# Usuarios con shell
cat /etc/passwd | grep -v nologin | grep -v false

# Últimos logins
last -a
lastlog

# SSH keys autorizadas
sudo find /home -name "authorized_keys" -exec cat {} \;
sudo cat /root/.ssh/authorized_keys
```

#### 6. Procesos Sospechosos
```bash
# Procesos sin terminal asociado
ps aux | grep -v '?'

# Procesos con alta CPU/memoria
ps aux --sort=-%cpu | head -20
ps aux --sort=-%mem | head -20

# Conexiones de red activas
sudo netstat -tulpn
sudo ss -tulpn
```

---

## 🛠️ HARDENING POST-REMEDIACIÓN

### 1. Firewall Egress (Bloquear Salida No Autorizada)

```bash
# Política por defecto: DENEGAR salida
sudo iptables -P OUTPUT DROP

# Permitir loopback
sudo iptables -A OUTPUT -o lo -j ACCEPT

# Permitir conexiones establecidas
sudo iptables -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT

# Permitir DNS
sudo iptables -A OUTPUT -p udp --dport 53 -j ACCEPT

# Permitir HTTP/HTTPS (actualizaciones)
sudo iptables -A OUTPUT -p tcp --dport 80 -j ACCEPT
sudo iptables -A OUTPUT -p tcp --dport 443 -j ACCEPT

# Permitir SSH saliente (si necesario)
sudo iptables -A OUTPUT -p tcp --dport 22 -j ACCEPT

# Permitir NTP
sudo iptables -A OUTPUT -p udp --dport 123 -j ACCEPT

# Permitir Supabase (específico)
sudo iptables -A OUTPUT -d lgniuhelyyizoursmsmi.supabase.co -j ACCEPT

# Permitir GeneXus (específico)
sudo iptables -A OUTPUT -d sgm.glp.riogas.com.uy -j ACCEPT

# Hacer persistente
sudo iptables-save > /etc/iptables/rules.v4
```

### 2. Aumentar Límites de Sistema

```bash
# File descriptors
sudo tee -a /etc/security/limits.conf << 'EOF'
*    soft nofile 65536
*    hard nofile 65536
root soft nofile 65536
root hard nofile 65536
EOF

# Kernel limits
sudo tee -a /etc/sysctl.conf << 'EOF'
# File descriptors
fs.file-max = 2097152
fs.nr_open = 2097152

# Conexiones TCP
net.core.somaxconn = 4096
net.ipv4.tcp_max_syn_backlog = 8192

# Protección SYN flood
net.ipv4.tcp_syncookies = 1
net.ipv4.tcp_syn_retries = 2
net.ipv4.tcp_synack_retries = 2

# Reutilizar sockets TIME_WAIT
net.ipv4.tcp_tw_reuse = 1
net.ipv4.tcp_fin_timeout = 15

# Rango de puertos efímeros
net.ipv4.ip_local_port_range = 10000 65000
EOF

# Aplicar
sudo sysctl -p
```

### 3. Monitoreo de Procesos Sospechosos

Crear script de monitoreo:

```bash
sudo tee /usr/local/bin/check-suspicious-processes.sh << 'EOF'
#!/bin/bash
# Monitoreo de procesos sospechosos

ALERT_EMAIL="admin@empresa.com"
LOG_FILE="/var/log/suspicious-processes.log"

# Procesos a detectar
SUSPICIOUS_NAMES="pnscan|masscan|nmap|zmap|crypto|miner|xmrig"

# Buscar
FOUND=$(ps aux | grep -E "$SUSPICIOUS_NAMES" | grep -v grep)

if [ ! -z "$FOUND" ]; then
  echo "[$(date)] PROCESO SOSPECHOSO DETECTADO:" >> $LOG_FILE
  echo "$FOUND" >> $LOG_FILE
  
  # Matar
  pkill -9 -f "$SUSPICIOUS_NAMES"
  
  # Alertar (si mail configurado)
  echo "Proceso sospechoso detectado y terminado" | mail -s "ALERTA: Proceso Sospechoso" $ALERT_EMAIL
  
  # Bloquear binario
  BINARY=$(echo "$FOUND" | awk '{print $11}')
  chmod 000 "$BINARY" 2>/dev/null
fi
EOF

sudo chmod +x /usr/local/bin/check-suspicious-processes.sh

# Agregar a cron (cada 5 minutos)
echo "*/5 * * * * /usr/local/bin/check-suspicious-processes.sh" | sudo crontab -
```

### 4. Monitoreo de Conexiones SYN-SENT

Crear script de alerta:

```bash
sudo tee /usr/local/bin/check-syn-flood.sh << 'EOF'
#!/bin/bash
# Detectar SYN flood saliente

THRESHOLD=100
SYN_COUNT=$(ss -tan state syn-sent | wc -l)

if [ $SYN_COUNT -gt $THRESHOLD ]; then
  echo "[$(date)] SYN FLOOD DETECTADO: $SYN_COUNT conexiones" >> /var/log/syn-flood.log
  
  # Ver procesos responsables
  ss -tanp state syn-sent | grep -oP 'users:\(\("\K[^"]+' | sort | uniq -c >> /var/log/syn-flood.log
  
  # Alertar
  echo "SYN flood: $SYN_COUNT conexiones" | mail -s "ALERTA: SYN Flood" admin@empresa.com
fi
EOF

sudo chmod +x /usr/local/bin/check-syn-flood.sh

# Agregar a cron (cada minuto)
echo "* * * * * /usr/local/bin/check-syn-flood.sh" | sudo crontab -
```

### 5. Health Check Robusto para PM2

```bash
# Instalar PM2 auto-restart en errores
pm2 install pm2-auto-pull

# Configurar health check
sudo tee /usr/local/bin/track-health-check.sh << 'EOF'
#!/bin/bash
# Health check de Track

HEALTH_URL="http://localhost:3002/api/health"
MAX_FAILURES=3
FAILURE_COUNT=0

while [ $FAILURE_COUNT -lt $MAX_FAILURES ]; do
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" $HEALTH_URL)
  
  if [ "$HTTP_CODE" != "200" ]; then
    FAILURE_COUNT=$((FAILURE_COUNT + 1))
    echo "[$(date)] Health check failed ($FAILURE_COUNT/$MAX_FAILURES)" >> /var/log/track-health.log
    sleep 2
  else
    exit 0  # OK
  fi
done

# 3 fallos consecutivos → restart
echo "[$(date)] Track no responde, reiniciando PM2" >> /var/log/track-health.log
pm2 restart track
EOF

sudo chmod +x /usr/local/bin/track-health-check.sh

# Agregar a cron (cada minuto)
echo "* * * * * /usr/local/bin/track-health-check.sh" | crontab -
```

---

## 🔒 PREVENCIÓN FUTURA

### Checklist de Seguridad

- [ ] **Actualizar sistema operativo**
  ```bash
  sudo apt update && sudo apt upgrade -y
  ```

- [ ] **Cambiar contraseñas de usuarios**
  ```bash
  sudo passwd root
  sudo passwd jgomez
  ```

- [ ] **Revisar SSH keys**
  ```bash
  sudo cat /root/.ssh/authorized_keys
  cat ~/.ssh/authorized_keys
  ```

- [ ] **Deshabilitar login root SSH**
  ```bash
  sudo nano /etc/ssh/sshd_config
  # PermitRootLogin no
  sudo systemctl restart sshd
  ```

- [ ] **Habilitar fail2ban**
  ```bash
  sudo apt install fail2ban -y
  sudo systemctl enable fail2ban
  sudo systemctl start fail2ban
  ```

- [ ] **Instalar ClamAV (antivirus)**
  ```bash
  sudo apt install clamav clamav-daemon -y
  sudo freshclam
  sudo clamscan -r /home /root
  ```

- [ ] **Auditoría con rkhunter**
  ```bash
  sudo apt install rkhunter -y
  sudo rkhunter --update
  sudo rkhunter --check
  ```

- [ ] **Revisar logs del sistema**
  ```bash
  sudo journalctl -p err -b
  sudo tail -f /var/log/auth.log
  sudo tail -f /var/log/syslog
  ```

---

## 📊 VERIFICACIÓN POST-REMEDIACIÓN

### Métricas Esperadas (Normal)

```bash
# Conexiones SYN-SENT (debe ser < 10)
ss -tan state syn-sent | wc -l

# Load average (debe ser < 4 en servidor 4 cores)
uptime

# PM2 restarts (debe ser 0 después de remediar)
pm2 describe track | grep restart

# File descriptors Track (debe ser < 500 con 100 móviles)
lsof -p $(pm2 pid track) | wc -l

# Memoria Track (debe ser < 1.5GB)
pm2 describe track | grep memory

# CPU Track (debe ser < 40% con carga)
pm2 monit
```

### Test de Conectividad

```bash
# Local
curl -v http://localhost:3002/api/health

# Desde SGM
curl -v http://192.168.7.13:3002/api/health

# Test de carga (simular 10 requests)
for i in {1..10}; do
  curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3002/api/health
done
```

---

## 🆘 TROUBLESHOOTING

### Problema: pnscan vuelve a aparecer

**Causa:** Persistencia no eliminada

**Solución:**
```bash
# Buscar binario
sudo find / -name "*pnscan*" 2>/dev/null
sudo rm -f <path_del_binario>

# Revisar cron
sudo crontab -l
sudo crontab -e  # Eliminar líneas sospechosas

# Revisar systemd
systemctl list-units | grep -i scan
sudo systemctl disable <servicio_sospechoso>
sudo systemctl stop <servicio_sospechoso>
```

### Problema: Load sigue alto después de matar pnscan

**Causa:** Otros procesos consumiendo recursos

**Solución:**
```bash
# Identificar procesos pesados
./diagnostico-load.sh

# Ver top 10 CPU
ps aux --sort=-%cpu | head -10

# Ver I/O wait
iostat -x 1 5
```

### Problema: Track sigue reiniciándose

**Causa:** Recursos agotados, error en código, o malware residual

**Solución:**
```bash
# Ver logs de error
pm2 logs track --err --lines 100

# Ver crashes
pm2 describe track

# Aumentar recursos
./aumentar-fd-limit.sh
ulimit -n 65536
pm2 restart track
```

---

## 📚 DOCUMENTACIÓN DE REFERENCIA

- [Linux Security Hardening](https://www.kernel.org/doc/html/latest/admin-guide/LSM/index.html)
- [iptables Tutorial](https://www.netfilter.org/documentation/HOWTO/packet-filtering-HOWTO.html)
- [PM2 Best Practices](https://pm2.keymetrics.io/docs/usage/application-declaration/)
- [Incident Response Guide](https://www.sans.org/reading-room/whitepapers/incident/incident-handlers-handbook-33901)

---

## 🎯 ESTADO FINAL

| Componente | Estado | Notas |
|------------|--------|-------|
| Proxy NGINX (SGM) | ✅ OK | Timeouts eran síntoma, no causa |
| Apache/Tomcat | ✅ OK | Funcionando correctamente |
| Track NGINX | ✅ OK | Funcionando correctamente |
| Node/PM2 | ✅ OK | Requiere hardening adicional |
| **Servidor** | 🔴 **COMPROMETIDO** | **Requiere remediación inmediata** |
| Código Track | ✅ OK | Sin problemas detectados |

---

## ✅ CHECKLIST DE DEPLOYMENT POST-REMEDIACIÓN

```bash
# 1. Pull últimos commits
cd /var/www/track
git pull

# 2. Verificar pnscan eliminado
ps aux | grep pnscan

# 3. Verificar conexiones normales
ss -tan state syn-sent | wc -l  # < 10

# 4. Aumentar file descriptors
./aumentar-fd-limit.sh
ulimit -n

# 5. Aplicar firewall
# (ejecutar comandos de hardening de arriba)

# 6. Rebuild Track
rm -rf .next
pnpm build

# 7. Restart PM2
pm2 restart track

# 8. Monitorear
pm2 monit
./monitorear-conexiones.sh

# 9. Verificar logs limpios
pm2 logs track --lines 100

# 10. Test de conectividad
curl http://localhost:3002/api/health
```

---

**ÚLTIMA ACTUALIZACIÓN:** 2026-02-05  
**RESPONSABLE:** Equipo de Infraestructura  
**PRIORIDAD:** 🚨 CRÍTICA
