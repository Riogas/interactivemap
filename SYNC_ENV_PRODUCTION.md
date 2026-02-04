# 🎯 CORRECCIÓN DEFINITIVA: Sincronizar .env.production con .env.local

## 📋 Problema Identificado

**Desarrollo (.env.local)**: ✅ Correcto
```env
EXTERNAL_API_URL=https://sgm.glp.riogas.com.uy
NEXT_PUBLIC_EXTERNAL_API_URL=https://sgm.glp.riogas.com.uy
```

**Producción (.env.production)**: ❌ Incorrecto
```env
EXTERNAL_API_URL=https://www.riogas.com.uy
NEXT_PUBLIC_EXTERNAL_API_URL=https://www.riogas.com.uy
```

## ✅ Solución: Actualizar .env.production en el Servidor

### 📝 Comandos para Ejecutar en el Servidor

```bash
# 1. Ir al directorio del proyecto
cd /var/www/track

# 2. Backup del archivo actual
cp .env.production .env.production.backup-$(date +%Y%m%d-%H%M%S)

# 3. Editar el archivo
nano .env.production
```

### 📝 Cambios a Realizar en nano

**BUSCAR** (líneas 18-21 aproximadamente):
```env
# ⚠️ IMPORTANTE: API Externa - URL de Login
# Esta es la API que se usa para autenticación
# Endpoint completo: https://www.riogas.com.uy/puestos/gestion/login
EXTERNAL_API_URL=https://www.riogas.com.uy

# También disponible para el cliente (navegador)
NEXT_PUBLIC_EXTERNAL_API_URL=https://www.riogas.com.uy
```

**REEMPLAZAR CON**:
```env
# ⚠️ IMPORTANTE: API Externa - URL de Login
# Esta es la API que se usa para autenticación
# API de autenticación: https://sgm.glp.riogas.com.uy/gestion/login
EXTERNAL_API_URL=https://sgm.glp.riogas.com.uy

# También disponible para el cliente (navegador)
NEXT_PUBLIC_EXTERNAL_API_URL=https://sgm.glp.riogas.com.uy
```

**Guardar**: `Ctrl+O` → `Enter` → `Ctrl+X`

---

### ✅ O Usar sed (Más Rápido)

```bash
cd /var/www/track

# Backup
cp .env.production .env.production.backup-$(date +%Y%m%d-%H%M%S)

# Reemplazar URLs
sed -i 's|EXTERNAL_API_URL=https://www.riogas.com.uy|EXTERNAL_API_URL=https://sgm.glp.riogas.com.uy|g' .env.production
sed -i 's|NEXT_PUBLIC_EXTERNAL_API_URL=https://www.riogas.com.uy|NEXT_PUBLIC_EXTERNAL_API_URL=https://sgm.glp.riogas.com.uy|g' .env.production

# Actualizar el comentario también
sed -i 's|https://www.riogas.com.uy/puestos/gestion/login|https://sgm.glp.riogas.com.uy/gestion/login|g' .env.production
```

---

### 🔍 Verificar los Cambios

```bash
cat .env.production | grep -A 2 "EXTERNAL_API_URL"
```

**Esperado**:
```
EXTERNAL_API_URL=https://sgm.glp.riogas.com.uy

# También disponible para el cliente (navegador)
NEXT_PUBLIC_EXTERNAL_API_URL=https://sgm.glp.riogas.com.uy
```

---

### 🔨 Rebuild y Restart

```bash
# IMPORTANTE: Rebuild porque NEXT_PUBLIC_* se compila en el build
pnpm build
```

⏱️ **Espera 1-2 minutos...**

```bash
# Restart PM2
pm2 restart track

# Ver logs en tiempo real
pm2 logs track --lines 50
```

Presiona `Ctrl+C` cuando veas actividad

---

### 🧪 Test Final

```bash
curl -X POST http://localhost:3002/api/proxy/gestion/login \
  -H "Content-Type: application/json" \
  -d '{"UserName":"julio.gomez@riogas.com.uy","Password":"VeintiunoDeOctubre!"}' \
  -v 2>&1 | grep -E "HTTP|< HTTP|status|Status"
```

**Esperado**:
```
< HTTP/1.1 200 OK
```

O si las credenciales no son válidas:
```
< HTTP/1.1 401 Unauthorized
```

**Ambos son ÉXITO** - significa que llegó al backend correcto.

---

### 🎯 También en los Logs de PM2

Busca en los logs:
```bash
pm2 logs track --lines 100 | grep "Constructed URL"
```

**Esperado**:
```
🌐 Constructed URL: https://sgm.glp.riogas.com.uy/gestion/login
```

---

### 🔒 Cuando Confirmes que Funciona

Habilita la seguridad:

```bash
nano .env.production
# Cambiar:
# ENABLE_SECURITY_CHECKS=false
# A:
# ENABLE_SECURITY_CHECKS=true

pm2 restart track
```

---

## 📋 Resumen de Comandos (Copy-Paste Completo)

```bash
cd /var/www/track
cp .env.production .env.production.backup-$(date +%Y%m%d-%H%M%S)
sed -i 's|EXTERNAL_API_URL=https://www.riogas.com.uy|EXTERNAL_API_URL=https://sgm.glp.riogas.com.uy|g' .env.production
sed -i 's|NEXT_PUBLIC_EXTERNAL_API_URL=https://www.riogas.com.uy|NEXT_PUBLIC_EXTERNAL_API_URL=https://sgm.glp.riogas.com.uy|g' .env.production
cat .env.production | grep EXTERNAL_API_URL
pnpm build
pm2 restart track
pm2 logs track --lines 50
```

Después de ver logs, presiona `Ctrl+C` y ejecuta:

```bash
curl -X POST http://localhost:3002/api/proxy/gestion/login \
  -H "Content-Type: application/json" \
  -d '{"UserName":"test","Password":"test"}' \
  -v 2>&1 | head -30
```

---

**EJECUTA Y PEGA EL RESULTADO** 🚀
