# 🚀 Deploy y Test: Security Toggle en Producción

## ✅ Estado: Código pusheado exitosamente

Commit: `36f7802` - "feat: Variable ENABLE_SECURITY_CHECKS para controlar seguridad"

## 📋 Plan de Deploy y Testing

### Paso 1: Conectar al Servidor

```bash
ssh jgomez@track.glp.riogas.com.uy
# o la IP/usuario que uses
```

### Paso 2: Pull del Nuevo Código

```bash
cd /var/www/track
git pull origin main
```

**Verificar que el pull fue exitoso**:
```bash
git log --oneline -1
# Debería mostrar: 36f7802 feat: Variable ENABLE_SECURITY_CHECKS para controlar seguridad
```

### Paso 3: Verificar Cambios en auth-middleware.ts

```bash
head -n 20 lib/auth-middleware.ts
```

**Esperado**: Deberías ver:
```typescript
const SECURITY_ENABLED = process.env.ENABLE_SECURITY_CHECKS === 'true';
```

### Paso 4: Configurar Variable de Entorno (TEST con seguridad DESHABILITADA)

```bash
# Ver configuración actual
cat .env.production

# Agregar variable para testing (temporalmente deshabilitada)
echo "ENABLE_SECURITY_CHECKS=false" >> .env.production

# Verificar que se agregó
cat .env.production | grep ENABLE_SECURITY_CHECKS
```

⚠️ **NOTA**: Usamos `false` temporalmente para aislar si el problema 404 es causado por la seguridad.

### Paso 5: Rebuild y Restart

```bash
# Instalar dependencias (por si acaso)
pnpm install

# Rebuild completo
pnpm build

# Restart PM2
pm2 restart track

# Ver logs en tiempo real
pm2 logs track --lines 50
```

### Paso 6: Verificar Logs (CRÍTICO)

```bash
pm2 logs track --lines 100 | grep -i "security"
```

**Esperado si está deshabilitada**:
```
⚠️ SECURITY_CHECKS DISABLED: Saltando requireAuth()
⚠️ SECURITY_CHECKS DISABLED: Saltando requireApiKey()
```

**Si NO aparecen estos logs**: La variable no está funcionando, verificar:
```bash
# Ver variables de entorno del proceso PM2
pm2 env track | grep ENABLE_SECURITY_CHECKS
```

### Paso 7: Test del Endpoint de Login

#### A) Test desde el Servidor (localhost)

```bash
curl -X POST http://localhost:3002/api/proxy/gestion/login \
  -H "Content-Type: application/json" \
  -d '{"UserName":"test","Password":"test"}' \
  -v
```

**Interpretación de resultados**:

- ✅ **200 OK** → ¡Funciona! El problema ERA la seguridad
- ✅ **401/403** → Funciona, pero las credenciales son inválidas (esperado)
- ❌ **404** → El problema NO es la seguridad, es routing/Next.js
- ❌ **Connection refused** → Next.js no está corriendo

#### B) Test desde Navegador

```
https://track.glp.riogas.com.uy/login
```

Abrir DevTools → Network → Intentar login

**Esperado**: 
- Si seguridad era el problema → Debería funcionar
- Si sigue 404 → Problema es nginx o Next.js routing

### Paso 8A: Si Funciona (200/401) ✅

**Conclusión**: La seguridad estaba bloqueando las peticiones.

**Siguiente paso**: Habilitar seguridad correctamente

```bash
# Editar .env.production
nano .env.production
# Cambiar a: ENABLE_SECURITY_CHECKS=true

# Agregar las claves que faltan
echo "INTERNAL_API_KEY=tu-clave-secreta-muy-larga-y-segura-2026" >> .env.production
echo "GPS_TRACKING_TOKEN=tu-token-gps-seguro-2026" >> .env.production

# Restart
pm2 restart track

# Verificar que ahora la seguridad está habilitada
pm2 logs track --lines 50 | grep -i "security"
# NO debería aparecer "DISABLED"
```

### Paso 8B: Si Sigue 404 ❌

**Conclusión**: El problema NO es la seguridad.

**Posibles causas**:

1. **Next.js no tiene la ruta compilada**
   ```bash
   # Verificar que existe el archivo
   ls -la app/api/proxy/
   ls -la app/api/proxy/\[...path\]/route.ts
   
   # Verificar build output
   ls -la .next/server/app/api/proxy/
   ```

2. **Nginx no está pasando la petición**
   ```bash
   # Test directo al puerto 3002 (bypass nginx)
   curl http://localhost:3002/api/proxy/gestion/login -v
   
   # Si funciona → Problema es nginx
   # Si no funciona → Problema es Next.js
   ```

3. **PM2 usando comando incorrecto**
   ```bash
   pm2 show track
   # Ver "script path" y "interpreter"
   
   # Si dice "next start" con output:standalone
   # Cambiar a: node .next/standalone/server.js
   ```

## 🎯 Matriz de Decisión

| Resultado Test | Causa | Acción |
|---------------|-------|--------|
| 200/401 desde localhost | Seguridad bloqueaba | Configurar INTERNAL_API_KEY correctamente |
| 404 desde localhost | Next.js no tiene ruta | Verificar build, regenerar |
| 200 localhost, 404 nginx | Nginx routing | Fix nginx config |
| Connection refused | PM2 caído | Verificar logs PM2, restart |

## 📊 Comandos de Diagnóstico Útiles

```bash
# Ver todos los procesos en puerto 3002
netstat -tulpn | grep 3002

# Ver logs completos de PM2
pm2 logs track --lines 200

# Ver errores de nginx
tail -f /var/log/nginx/error.log

# Test nginx syntax
nginx -t

# Ver configuración activa de nginx
nginx -T | grep track.glp.riogas.com.uy -A 30

# Ver variables de entorno de Next.js
pm2 env track
```

## ⚠️ IMPORTANTE: Después de Testing

**Una vez que sepas cuál es el problema real**:

Si la seguridad funcionaba pero necesita configuración:
```bash
# .env.production
ENABLE_SECURITY_CHECKS=true
INTERNAL_API_KEY=<clave-muy-segura>
GPS_TRACKING_TOKEN=<token-muy-seguro>
```

Si la seguridad NO era el problema:
```bash
# Volver a habilitar por seguridad
nano .env.production
# ENABLE_SECURITY_CHECKS=true
pm2 restart track
```

---

**Ejecuta este plan paso a paso y reporta los resultados de cada paso** 🔍
