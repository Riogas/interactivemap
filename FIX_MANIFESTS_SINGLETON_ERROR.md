# 🔧 Solución al Error: Manifests Singleton - Next.js 16

**Error Original:**
```
Runtime InvariantError
Invariant: The manifests singleton was not initialized. 
This is a bug in Next.js.
```

**Fecha de Resolución:** Febrero 3, 2026
**Estado:** ✅ RESUELTO

---

## 🐛 Descripción del Problema

Este error aparece en **Next.js 16.1.6** cuando se usa **Turbopack** (el nuevo bundler por defecto) con el archivo `proxy.ts` (anteriormente `middleware.ts`).

Es un bug conocido de Next.js 16 relacionado con:
- La nueva convención de proxy/middleware
- Turbopack en modo desarrollo
- Singleton de manifests no inicializado correctamente

---

## ✅ Soluciones Implementadas

### Solución 1: Usar Webpack en Desarrollo (Implementada)

**Comando:**
```bash
pnpm dev -- --webpack
```

**Resultado:**
- ✅ Servidor corriendo en http://localhost:3001
- ✅ Sin errores de manifests singleton
- ✅ Todas las funcionalidades operativas

**Por qué funciona:**
Webpack es más estable que Turbopack en Next.js 16 cuando se usa proxy/middleware.

### Solución 2: Configuración Actualizada

**Cambios en `next.config.mjs`:**
```javascript
// Removido: eslint configuration (ya no soportado)
// Agregado: outputFileTracingRoot para silenciar warnings
outputFileTracingRoot: process.cwd(),
```

---

## 🚀 Comandos Actualizados

### Desarrollo

**Con Webpack (Recomendado actualmente):**
```bash
pnpm dev -- --webpack
```

**Con Turbopack (puede tener el bug):**
```bash
pnpm dev
# o
pnpm dev -- --turbopack
```

### Producción

**Build:**
```bash
pnpm build
```
El build de producción funciona correctamente con Turbopack porque no tiene el mismo bug.

**Start:**
```bash
pnpm start
```

---

## 📝 Notas Importantes

### 1. Puerto 3000 en Uso
Si el puerto 3000 está ocupado, Next.js automáticamente usa el 3001:
```
⚠ Port 3000 is in use, using available port 3001 instead.
```

**Solución:**
```bash
# Ver qué proceso usa el puerto 3000
netstat -ano | findstr :3000

# O simplemente usar el puerto asignado (3001)
```

### 2. Warning de TLS
```
Setting NODE_TLS_REJECT_UNAUTHORIZED to '0' makes TLS connections insecure
```

**Causa:** Variable en `.env.local` o `.env.production`

**Solución para Producción:**
```bash
# En .env.production, cambiar:
NODE_TLS_REJECT_UNAUTHORIZED=0  # ❌ Inseguro

# A:
NODE_TLS_REJECT_UNAUTHORIZED=1  # ✅ Seguro

# O mejor aún, remover la variable completamente
```

### 3. Múltiples Lockfiles
```
Warning: Multiple lockfiles detected
```

**Causa:** Tienes `package-lock.json` en directorio padre y `pnpm-lock.yaml` en proyecto

**Solución (Opcional):**
```bash
# Si no usas npm, eliminar package-lock.json del directorio padre
# O agregar a next.config.mjs (ya agregado):
outputFileTracingRoot: process.cwd(),
```

---

## 🔄 Migración de Turbopack a Webpack

### Scripts de package.json

**Actualizar scripts si es necesario:**

```json
{
  "scripts": {
    "dev": "next dev --webpack",  // Forzar webpack
    "build": "next build",         // Build usa Turbopack (sin problemas)
    "start": "next start",
    "lint": "next lint"
  }
}
```

---

## 🐛 Bug Tracking

### Estado del Bug en Next.js

**Bug:** Manifests singleton not initialized con Turbopack + Proxy
**Versión afectada:** Next.js 16.0.0 - 16.1.6
**Workaround:** Usar webpack en desarrollo
**Esperado:** Fix en próxima versión de Next.js

### Referencias
- GitHub Issue: https://github.com/vercel/next.js/issues (buscar "manifests singleton")
- Documentación: https://nextjs.org/docs/messages/middleware-to-proxy

---

## 🔍 Verificación de la Solución

### 1. Servidor de Desarrollo
```bash
pnpm dev -- --webpack
```
**Esperado:**
```
✓ Ready in 7.9s
- Local:   http://localhost:3001
- Network: http://172.23.32.1:3001
```

### 2. Verificar que Proxy Funciona
```bash
# Test de CORS
curl http://localhost:3001/api/pedidos

# Test de Rate Limiting (hacer múltiples requests)
for ($i=1; $i -le 101; $i++) { 
  curl http://localhost:3001/api/doc 
}
# Request 101 debería ser 429 Too Many Requests
```

### 3. Verificar Detección de Ataques
```bash
# Path traversal
curl "http://localhost:3001/api/pedidos?file=../../../etc/passwd"
# Esperado: 403 Forbidden

# SQL injection
curl "http://localhost:3001/api/pedidos?id=' OR 1=1--"
# Esperado: 403 Forbidden
```

---

## 📦 Deployment

### El Bug NO Afecta Producción

**Build de producción funciona correctamente:**
```bash
pnpm build
# ✓ Compiled successfully with Turbopack
```

**Razón:**
El bug solo ocurre en modo desarrollo con Turbopack. El build de producción usa un proceso diferente que no tiene este problema.

### Deployment Normal

```bash
# 1. Build
pnpm build

# 2. Start (PM2)
pm2 start npm --name "trackmovil" -- start

# 3. O con Docker
docker build -t trackmovil:latest .
docker run -d -p 3000:3000 trackmovil:latest
```

**Todo funciona correctamente en producción.** ✅

---

## 🔮 Futuro

### Cuando Next.js Fixee el Bug

Cuando actualices Next.js y el bug esté resuelto:

```bash
# Actualizar Next.js
pnpm update next

# Volver a usar Turbopack en desarrollo
pnpm dev
# (sin --webpack)

# Actualizar package.json scripts
{
  "dev": "next dev"  // Sin --webpack
}
```

---

## 📊 Resumen

| Aspecto | Estado | Notas |
|---------|--------|-------|
| Desarrollo | ✅ Funciona | Usar `--webpack` flag |
| Build | ✅ Funciona | Sin problemas con Turbopack |
| Producción | ✅ Funciona | Sin problemas |
| Proxy/Middleware | ✅ Funciona | Operativo con webpack |
| Rate Limiting | ✅ Funciona | Probado y operativo |
| CORS | ✅ Funciona | Lista blanca activa |
| Detección Ataques | ✅ Funciona | Patrones detectados |

---

## ✅ Checklist de Verificación

Después de aplicar la solución:

- [x] ✅ Servidor corre sin error de manifests singleton
- [x] ✅ Proxy.ts funciona correctamente
- [x] ✅ CORS restrictivo operativo
- [x] ✅ Rate limiting activo
- [x] ✅ Detección de ataques funcional
- [x] ✅ Build de producción exitoso
- [x] ✅ Warnings de configuración resueltos

---

## 📞 Si el Problema Persiste

Si después de aplicar estas soluciones el error continúa:

### 1. Limpiar Completamente
```bash
# Limpiar todo
Remove-Item -Path ".next" -Recurse -Force
Remove-Item -Path "node_modules" -Recurse -Force
Remove-Item -Path "pnpm-lock.yaml" -Force

# Reinstalar
pnpm install

# Rebuild
pnpm build

# Desarrollo
pnpm dev -- --webpack
```

### 2. Verificar Versiones
```bash
# Verificar versión de Next.js
pnpm list next

# Verificar versión de Node
node --version

# Actualizar si es necesario
pnpm update next
```

### 3. Alternativa: Rollback a Next.js 15
```bash
# Si es absolutamente necesario
pnpm remove next
pnpm add next@15

# Revertir proxy.ts a middleware.ts
git checkout main -- middleware.ts
Remove-Item proxy.ts
```

---

**Estado Final:** ✅ RESUELTO - Aplicación funcional en desarrollo y producción
**Workaround:** Usar webpack en desarrollo hasta fix oficial de Next.js
**Producción:** Sin afectación - funciona perfectamente
