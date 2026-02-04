# 🔍 Estado Actual del Problema 404

**Fecha**: 2026-02-03 20:15  
**Estado**: Login sigue dando 404 después de deshabilitar nodejs

## 📊 Síntomas Actuales

### ✅ Lo que SÍ funciona:
- Supabase Realtime: **CONECTADO**
- GPS suscripción: **SUBSCRIBED**
- Móviles suscripción: **SUBSCRIBED**
- Conexión Realtime establecida para escenario_id = 1000

### ❌ Lo que NO funciona:
```
POST https://track.riogas.com.uy/api/proxy/gestion/login
Status: 404 Not Found
Time: 2546ms
```

**Headers de respuesta:**
```
access-control-allow-origin: *
content-type: application/json
server: nginx
x-content-type-options: nosniff
x-frame-options: DENY
x-xss-protection: 1; mode=block
```

## 🔍 Observaciones Importantes

1. **Los headers CORS están presentes** → Next.js está respondiendo algo
2. **Hay un PHPSESSID** → Está pasando por algún servidor PHP
3. **x-frame-options y x-xss-protection** → Headers de Next.js
4. **404 tarda 2.5 segundos** → Está procesando algo, no es nginx directo

## 🎯 Hipótesis

La petición **SÍ está llegando a Next.js** (por los headers), pero:
- ❌ La ruta `/api/proxy/gestion/login` no existe en Next.js
- ❌ O el middleware está rechazando la petición
- ❌ O hay algún problema con el build de Next.js

## 🧪 Tests Necesarios

Necesitamos verificar:

1. **¿Next.js tiene la ruta compilada?**
   ```bash
   ls -la /var/www/track/.next/server/app/api/proxy/
   ```

2. **¿PM2 muestra errores?**
   ```bash
   pm2 logs track --lines 100 | grep -i error
   ```

3. **¿Qué configuración tiene nginx realmente?**
   ```bash
   sudo nginx -T | grep -A 50 "server_name track.glp.riogas.com.uy"
   ```

## 📝 Próximos Pasos

1. Verificar que el archivo `/var/www/track/app/api/proxy/[...path]/route.ts` existe
2. Verificar que Next.js compiló correctamente el build
3. Ver logs de PM2 en tiempo real mientras hacemos login
4. Verificar la configuración real de nginx (no la de sites-available, sino la cargada)

---

**Cambios aplicados hasta ahora:**
- ✅ Deshabilitado archivo `nodejs` (default_server)
- ❌ Problema persiste → No era solo el archivo nodejs
