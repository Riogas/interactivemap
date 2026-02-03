# 🚀 Deploy Correcto en Producción - Fix 404

## ❌ Problema
El servidor devuelve **404 Not Found** en `/api/proxy/gestion/login` después del deploy.

## ✅ Solución: Rebuild Completo

### Paso 1: Conectarse al servidor

```bash
ssh user@track.glp.riogas.com.uy
cd /ruta/al/proyecto/trackmovil
```

### Paso 2: Pull de los cambios

```bash
git pull origin main
```

### Paso 3: Limpiar build anterior

```bash
rm -rf .next
rm -rf node_modules/.cache
```

### Paso 4: Instalar dependencias (por si acaso)

```bash
pnpm install
```

### Paso 5: Build con webpack (IMPORTANTE)

```bash
# Asegurarse de que el build use webpack, NO turbopack
pnpm build
```

**IMPORTANTE**: Verifica que en `package.json` el script de build sea:
```json
{
  "scripts": {
    "build": "next build"
  }
}
```

### Paso 6: Reiniciar PM2 correctamente

```bash
# Detener la aplicación
pm2 stop trackmovil

# Eliminar del registro
pm2 delete trackmovil

# Volver a registrar con la nueva build
pm2 start pnpm --name trackmovil -- start

# Guardar configuración
pm2 save
```

### Paso 7: Verificar logs

```bash
pm2 logs trackmovil --lines 50
```

Deberías ver:
```
✓ Ready in X seconds
- Local:        http://localhost:3000
```

### Paso 8: Verificar variables de entorno

Asegúrate de que `.env.local` en el servidor tenga:

```bash
# Security API Keys
INTERNAL_API_KEY=96c596ab9a239195c517000e92101c89fed22da7f13843440357493b0d911cd3
GPS_TRACKING_TOKEN=IcA.FwL.1710.!

# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://lgniuhelyyizoursmsmi.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxnbml1aGVseXlpem91cnNtc21pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTc0NDQ5MTUsImV4cCI6MjA3MzAyMDkxNX0.96kkOHRA1EgOYqu6bm0-6nr_a3qpAHUoYA9Z77qUCQI
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxnbml1aGVseXlpem91cnNtc21pIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NzQ0NDkxNSwiZXhwIjoyMDczMDIwOTE1fQ.qR09lu4wr1j-tecWLdH0IZbEj2HUpEt8xHTtOvE_5BE

# External API
EXTERNAL_API_URL=https://sgm.glp.riogas.com.uy
NEXT_PUBLIC_EXTERNAL_API_URL=https://sgm.glp.riogas.com.uy

# TLS
NODE_TLS_REJECT_UNAUTHORIZED=0
```

---

## 🔍 Verificación Post-Deploy

### Test 1: Verificar que el endpoint existe

```bash
curl -X POST https://track.glp.riogas.com.uy/api/proxy/gestion/login \
  -H "Content-Type: application/json" \
  -d '{"UserName":"test","Password":"test"}'
```

**Esperado**: Respuesta 500 o 401 (NO 404)

### Test 2: Ver estructura de build

```bash
ls -la .next/server/app/api/proxy
```

Deberías ver carpetas como `[...path]`

---

## 🚨 Si sigue sin funcionar

### Opción A: Verificar next.config.mjs

El archivo debe tener:

```javascript
const nextConfig = {
  // ... otras configuraciones
  experimental: {
    // No poner nada que deshabilite rutas dinámicas
  },
};
```

### Opción B: Verificar estructura de carpetas

```bash
ls -la app/api/proxy/
```

Debe existir: `app/api/proxy/[...path]/route.ts`

### Opción C: Build verbose

```bash
pnpm build 2>&1 | tee build.log
```

Busca en `build.log` si dice:
- ✅ `○ /api/proxy/[...path]` (significa que se compiló)
- ❌ No aparece (significa que no se detectó)

---

## 📝 Comandos Rápidos (Copy-Paste)

```bash
# En el servidor:
cd /ruta/al/proyecto/trackmovil
git pull origin main
rm -rf .next node_modules/.cache
pnpm install
pnpm build
pm2 stop trackmovil
pm2 delete trackmovil
pm2 start pnpm --name trackmovil -- start
pm2 save
pm2 logs trackmovil --lines 50
```

---

## ✅ Resultado Esperado

Después del deploy correcto, el login debería:
1. ✅ POST a `/api/proxy/gestion/login` → 200 OK (no 404)
2. ✅ Sincronización con Supabase → 200 OK
3. ✅ Redirect a dashboard
4. ✅ Dashboard carga sin 401 errors

---

## 🆘 Si Necesitas Ayuda

1. **Envía los logs de PM2**:
   ```bash
   pm2 logs trackmovil --lines 100
   ```

2. **Envía el output del build**:
   ```bash
   pnpm build 2>&1 | grep -A 10 "Route"
   ```

3. **Verifica que las rutas se compilaron**:
   ```bash
   find .next/server/app/api -name "*.js" | grep proxy
   ```
