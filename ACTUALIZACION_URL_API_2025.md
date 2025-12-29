# 🔄 Actualización URL API - Diciembre 2025

## 📋 Resumen de Cambios

La API de login de RioGas ha cambiado su URL base y endpoint:

### ❌ URL Anterior (DEPRECADA)
```
Base: https://www.riogas.com.uy
Endpoint: /puestos/gestion/login
URL Completa: https://www.riogas.com.uy/puestos/gestion/login
```

### ✅ Nueva URL (ACTIVA)
```
Base: https://sgm.glp.riogas.com.uy
Endpoint: /gestion/login
URL Completa: https://sgm.glp.riogas.com.uy/gestion/login
```

---

## 📝 Archivos Actualizados

### 1. Archivos de Configuración (.env)

#### ✅ `.env.production`
```bash
EXTERNAL_API_URL=https://sgm.glp.riogas.com.uy
NEXT_PUBLIC_EXTERNAL_API_URL=https://sgm.glp.riogas.com.uy
```

#### ✅ `.env.local`
```bash
EXTERNAL_API_URL=https://sgm.glp.riogas.com.uy
NEXT_PUBLIC_EXTERNAL_API_URL=https://sgm.glp.riogas.com.uy
```

#### ✅ `.env.production.template`
```bash
EXTERNAL_API_URL=https://sgm.glp.riogas.com.uy
NEXT_PUBLIC_EXTERNAL_API_URL=https://sgm.glp.riogas.com.uy
```

### 2. Scripts de Automatización

#### ✅ `scripts/update-env-api.sh`
```bash
API_URL="https://sgm.glp.riogas.com.uy"
```

### 3. Código Fuente TypeScript/JavaScript

#### ✅ `app/api/proxy/login/route.ts`
```typescript
// ANTES: /puestos/gestion/login
// AHORA: /gestion/login
const response = await fetch(`${API_BASE_URL}/gestion/login`, {
  method: 'POST',
  // ...
});
```

#### ✅ `app/api/proxy/[...path]/route.ts`
```typescript
/**
 * Ejemplos:
 * - POST /api/proxy/gestion/login  ← ACTUALIZADO
 * - GET /api/proxy/gestion/moviles
 */
```

#### ✅ `lib/api/auth.ts`
```typescript
const response = await apiClient.post<LoginResponse>(
  '/gestion/login',  // ← ACTUALIZADO desde /puestos/gestion/login
  credentials
);
```

#### ✅ `test-api-connection.js`
```javascript
// ANTES: '/api/proxy/puestos/gestion/login'
// AHORA: '/api/proxy/gestion/login'
const response = await fetch('/api/proxy/gestion/login', {
  method: 'POST',
  // ...
});
```

### 4. Documentación Actualizada

- ✅ `URL_API_ACTUALIZADA.md` - Actualizado con nueva URL
- ✅ `LISTO_PARA_APLICAR.md` - Actualizado ejemplos
- ✅ `DOCKER_DEPLOYMENT_DESDE_CERO.md` - Actualizado referencias

---

## 🎯 Impacto de los Cambios

### Cambios en el Flujo de Autenticación

**Antes:**
```
Cliente → Next.js → /api/proxy/puestos/gestion/login
                 → https://www.riogas.com.uy/puestos/gestion/login
```

**Ahora:**
```
Cliente → Next.js → /api/proxy/gestion/login
                 → https://sgm.glp.riogas.com.uy/gestion/login
```

### Lo que NO cambió:
- ✅ La estructura de la petición (UserName, Password)
- ✅ La estructura de la respuesta (RespuestaLogin JSON)
- ✅ El manejo de sesiones y tokens
- ✅ La lógica de autenticación en el frontend
- ✅ El sistema de proxy Next.js

### Lo que SÍ cambió:
- 🔄 URL base de la API externa
- 🔄 Path del endpoint (se removió `/puestos`)
- 🔄 Dominio del servidor API

---

## 🚀 Aplicar Cambios en Producción

### Opción 1: Usando PM2 (Windows/Linux)

```bash
# 1. Ir al proyecto
cd c:\Users\jgomez\Documents\Projects\trackmovil

# 2. Reiniciar la aplicación
pm2 restart trackmovil

# 3. Ver logs
pm2 logs trackmovil
```

### Opción 2: Usando Docker (Linux)

```bash
# 1. SSH al servidor
ssh riogas@node

# 2. Ir al proyecto
cd ~/trackmovil

# 3. Hacer git pull (si los cambios están en el repo)
git pull origin main

# 4. Reconstruir la imagen
docker build -t trackmovil:latest .

# 5. Detener y eliminar contenedor anterior
docker stop trackmovil
docker rm trackmovil

# 6. Iniciar nuevo contenedor
docker run -d \
  --name trackmovil \
  -p 3001:3000 \
  --env-file .env.production \
  --restart unless-stopped \
  trackmovil:latest

# 7. Ver logs
docker logs -f trackmovil
```

### Opción 3: Usando Script Automático (Linux)

```bash
# 1. SSH al servidor
ssh riogas@node

# 2. Ir al proyecto y ejecutar script
cd ~/trackmovil
git pull origin main
chmod +x scripts/update-env-api.sh
./scripts/update-env-api.sh
```

---

## ✅ Verificación Post-Despliegue

### 1. Verificar Variables de Entorno

```bash
# En el servidor, verificar el archivo .env.production
cat .env.production | grep EXTERNAL_API_URL

# Debería mostrar:
# EXTERNAL_API_URL=https://sgm.glp.riogas.com.uy
# NEXT_PUBLIC_EXTERNAL_API_URL=https://sgm.glp.riogas.com.uy
```

### 2. Verificar Logs de la Aplicación

**Con PM2:**
```bash
pm2 logs trackmovil --lines 50
```

**Con Docker:**
```bash
docker logs trackmovil --tail 50
```

**Logs esperados al hacer login:**
```
🔐 Login Request
📤 Body: { UserName: 'usuario', Password: '***' }
📥 Login Response Status: 200
✅ Login exitoso: usuario
```

### 3. Probar Login desde el Navegador

1. Abrir la aplicación en el navegador
2. Intentar hacer login
3. Abrir DevTools (F12) → Network
4. Verificar la petición a `/api/proxy/gestion/login`
5. Verificar que la respuesta sea 200 OK

---

## 🔍 Troubleshooting

### Error: "Failed to fetch" o "Network Error"

**Causa:** La URL nueva no es accesible desde el servidor

**Solución:**
```bash
# Verificar conectividad desde el servidor
curl -X POST https://sgm.glp.riogas.com.uy/gestion/login \
  -H "Content-Type: application/json" \
  -d '{"UserName":"test","Password":"test"}'

# Si no responde, verificar DNS/firewall
ping sgm.glp.riogas.com.uy
```

### Error: 404 Not Found

**Causa:** El endpoint cambió o no existe

**Solución:**
1. Verificar con el equipo de backend la URL correcta
2. Probar la URL directamente con curl
3. Actualizar el endpoint si es necesario

### Login funciona pero no guarda sesión

**Causa:** La respuesta de la API cambió de formato

**Solución:**
1. Revisar logs del servidor
2. Verificar que la respuesta tenga el campo `RespuestaLogin`
3. Verificar que el JSON parseado tenga `success: true` y `user.id`

---

## 📅 Historial de Cambios

| Fecha | Cambio | Versión |
|-------|--------|---------|
| 2025-12-29 | Actualización URL API de `www.riogas.com.uy/puestos/gestion/login` a `sgm.glp.riogas.com.uy/gestion/login` | 2.0 |
| 2025-01-XX | URL original configurada | 1.0 |

---

## 👥 Contactos

- **Backend API:** Equipo RioGas
- **Frontend/Deploy:** jgomez
- **Documentación:** Este archivo

---

## 📚 Archivos Relacionados

- `URL_API_ACTUALIZADA.md` - Guía de actualización
- `LISTO_PARA_APLICAR.md` - Pasos para aplicar en Linux
- `DOCKER_DEPLOYMENT_DESDE_CERO.md` - Guía completa de deployment
- `scripts/update-env-api.sh` - Script de actualización automática

---

## ✨ Notas Adicionales

- Los cambios son **backward compatible** en términos de estructura de datos
- No se requieren cambios en la base de datos
- No se requieren cambios en Supabase
- La migración es **transparente** para los usuarios finales
- Se recomienda hacer un **backup** antes de aplicar en producción

---

**Última actualización:** 29 de diciembre de 2025
**Estado:** ✅ Completado y documentado
