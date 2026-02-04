# 🎯 SOLUCIÓN CONFIRMADA: Problema de URL del Backend

## 📋 Configuración Actual (INCORRECTA)

```env
# En .env.production:
EXTERNAL_API_URL=https://www.riogas.com.uy
NEXT_PUBLIC_EXTERNAL_API_URL=https://www.riogas.com.uy
```

**Comentario en el archivo dice**:
```
# Endpoint completo: https://www.riogas.com.uy/puestos/gestion/login
```

## ❌ El Problema

El proxy está construyendo:
```
Base: https://www.riogas.com.uy
Path: gestion/login
Result: https://www.riogas.com.uy/gestion/login ❌ (404 - WordPress)
```

**Debería construir**:
```
Base: https://www.riogas.com.uy/puestos
Path: gestion/login
Result: https://www.riogas.com.uy/puestos/gestion/login ✅
```

## ✅ Solución Inmediata

### Opción 1: Agregar `/puestos` a la base URL

```bash
nano .env.production
```

**Cambiar**:
```env
EXTERNAL_API_URL=https://www.riogas.com.uy/puestos
NEXT_PUBLIC_EXTERNAL_API_URL=https://www.riogas.com.uy/puestos
```

### Opción 2: Usar el dominio sgm.glp

**Si el backend está en otro dominio**:
```env
EXTERNAL_API_URL=https://sgm.glp.riogas.com.uy
NEXT_PUBLIC_EXTERNAL_API_URL=https://sgm.glp.riogas.com.uy
```

---

## 🚀 Comandos para Aplicar (COPIA Y PEGA)

### 1️⃣ Hacer backup del archivo actual

```bash
cp .env.production .env.production.backup
```

### 2️⃣ Actualizar la configuración

```bash
# Opción A: Usando /puestos
sed -i 's|EXTERNAL_API_URL=https://www.riogas.com.uy|EXTERNAL_API_URL=https://www.riogas.com.uy/puestos|g' .env.production
sed -i 's|NEXT_PUBLIC_EXTERNAL_API_URL=https://www.riogas.com.uy|NEXT_PUBLIC_EXTERNAL_API_URL=https://www.riogas.com.uy/puestos|g' .env.production
```

O si prefieres **editar manualmente**:
```bash
nano .env.production
# Cambiar las líneas 18 y 21 para agregar /puestos al final
```

### 3️⃣ Verificar el cambio

```bash
cat .env.production | grep EXTERNAL_API_URL
```

**Esperado**:
```
EXTERNAL_API_URL=https://www.riogas.com.uy/puestos
NEXT_PUBLIC_EXTERNAL_API_URL=https://www.riogas.com.uy/puestos
```

### 4️⃣ Rebuild (importante porque NEXT_PUBLIC_* se compila)

```bash
pnpm build
```

⏱️ **Esto puede tardar 1-2 minutos**

### 5️⃣ Restart PM2

```bash
pm2 restart track
```

### 6️⃣ Ver logs y esperar el primer request

```bash
pm2 logs track --lines 50
```

Espera a que aparezca un request de login y presiona `Ctrl+C`

### 7️⃣ TEST FINAL

```bash
curl -X POST http://localhost:3002/api/proxy/gestion/login \
  -H "Content-Type: application/json" \
  -d '{"UserName":"test","Password":"test"}' \
  -v 2>&1 | head -20
```

---

## 🎯 Lo que Deberías Ver Después del Fix

**En los logs de PM2**:
```
🌐 Base URL: https://www.riogas.com.uy/puestos
🌐 Constructed URL: https://www.riogas.com.uy/puestos/gestion/login
📥 Status: 200 OK  (o 401 si las credenciales son inválidas)
```

**En el curl**:
```
< HTTP/1.1 200 OK
```

o

```
< HTTP/1.1 401 Unauthorized
{"error": "Invalid credentials"}
```

**Ambos son ÉXITO** - significa que el endpoint existe y está respondiendo.

---

## 📊 Confirmación del Fix

| Antes | Después |
|-------|---------|
| `https://www.riogas.com.uy/gestion/login` | `https://www.riogas.com.uy/puestos/gestion/login` |
| 404 Not Found (WordPress) | 200 OK o 401 (GeneXus) |
| HTML de error | JSON response |

---

## ⚠️ IMPORTANTE

Después de hacer el rebuild, también deberías:

```bash
# Habilitar la seguridad en producción
nano .env.production
# Cambiar: ENABLE_SECURITY_CHECKS=true

pm2 restart track
```

Pero **primero** confirma que el login funciona con la URL correcta.

---

**EJECUTA LOS COMANDOS EN ORDEN Y PEGA EL RESULTADO DEL PASO 7** 🎯
