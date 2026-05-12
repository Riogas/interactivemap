# Testing de Login Security

## Testing manual post-deploy

### 1. Cambio de password en SGM

**CRÍTICO**: Verificar que el cambio de clave en SGM sigue funcionando después del deploy de login security.

El sistema de auditoría y bloqueo **NO debe afectar** el flujo de cambio de contraseña en SGM.

**Procedimiento de test:**
1. Acceder a SGM
2. Navegar al módulo de cambio de contraseña
3. Intentar cambiar la contraseña de un usuario de prueba
4. Verificar que el cambio se completa exitosamente
5. Verificar que NO se registra como intento de login fallido en `login_attempts`

---

### 2. Bloqueos en entorno de pruebas

**Bloqueo por usuario (3 fails → 10 min):**
1. Crear un usuario de prueba
2. Intentar login con contraseña incorrecta 3 veces
3. Verificar que el 4to intento devuelve HTTP 429 con mensaje "Usuario bloqueado temporalmente. Intentá de nuevo en X minutos."
4. Verificar registro en BD:
   - `login_attempts`: 3 filas con `estado='fail'` + 1 fila con `estado='blocked_user'`
   - `login_blocks`: 1 fila con `block_type='user'`, `key=<username>`, `blocked_until` ~ 10 min adelante
5. Esperar 10 minutos o borrar manualmente de `login_blocks`
6. Verificar que el usuario puede volver a intentar login

**Bloqueo por IP (5 usernames distintos → 15 min):**
1. Desde una misma IP (no whitelisted), intentar login con 5 usuarios distintos (contraseña incorrecta)
2. Verificar que el 6to intento (con cualquier usuario) devuelve HTTP 429 con mensaje "Demasiados intentos desde esta IP."
3. Verificar registro en BD:
   - `login_attempts`: 5 filas con `estado='fail'` (usernames distintos) + 1 fila con `estado='blocked_ip'`
   - `login_blocks`: 1 fila con `block_type='ip'`, `key=<ip>`, `blocked_until` ~ 15 min adelante
4. Esperar 15 minutos o desbloquear manualmente
5. Verificar que la IP puede volver a intentar login

**Username === Password:**
1. Intentar login con `UserName = "test"` y `Password = "test"`
2. Verificar que devuelve HTTP 400 con mensaje "El nombre de usuario y la contraseña no pueden coincidir."
3. Verificar registro en BD:
   - `login_attempts`: 1 fila con `estado='user_eq_pass'`
   - `login_blocks`: SIN filas (no debe disparar bloqueo)
4. Intentar nuevamente con mismo user/pass → debe seguir dando 400 SIN bloqueo

---

### 3. IPs whitelisted

**Lista de IPs whitelisted:**
- `127.0.0.1`
- `::1`
- `192.168.7.13` (Track server)
- `192.168.7.12` (SGM server)
- Todo el rango `192.168.x.x`, `10.x.x.x`, `172.16-31.x.x`

**Procedimiento de test:**
1. Desde una IP whitelisted (ej: `192.168.1.100`), intentar login con contraseña incorrecta 10 veces
2. Verificar que NUNCA devuelve HTTP 429 (no se bloquea)
3. Verificar registro en BD:
   - `login_attempts`: 10 filas con `estado='fail'`, `whitelisted=true`
   - `login_blocks`: SIN filas para esa IP

---

### 4. UI Admin

**Acceso:**
1. Login como usuario root (`isRoot === 'S'`)
2. Navegar a `/admin/login-logs`
3. Verificar que se muestran las tablas de:
   - **Bloqueos activos** (vacía si no hay bloqueos)
   - **Intentos de login** (últimos 100 por defecto)

**Funcionalidad:**
1. Aplicar filtros (username, IP, estado)
2. Verificar que la tabla se actualiza correctamente
3. Si hay bloqueos activos, hacer clic en "Desbloquear"
4. Verificar que:
   - El bloqueo desaparece de la tabla
   - Se puede volver a intentar login desde ese usuario/IP

---

## Notas de seguridad

- Las IPs whitelisted se registran con `whitelisted=true` para auditoría, pero nunca se bloquean.
- Los bloqueos son temporales (10 min user, 15 min IP) y expiran automáticamente.
- El desbloqueo manual desde UI Admin es inmediato (borra la fila de `login_blocks`).
- El sistema coexiste con el rate-limit middleware existente (`lib/rate-limit.ts`).

---

## Limpieza de logs (futuro)

**Retención recomendada:** 30 días

**Query de limpieza** (ejecutar en cron diario):
```sql
DELETE FROM login_attempts WHERE ts < now() - INTERVAL '30 days';
DELETE FROM login_blocks WHERE blocked_until < now() - INTERVAL '7 days';
```

Esto mantiene el tamaño de las tablas bajo control sin perder datos recientes.
