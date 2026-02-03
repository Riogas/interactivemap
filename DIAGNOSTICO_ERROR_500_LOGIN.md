# 🔍 Diagnóstico: Error 500 en Login - Backend GeneXus

**Fecha:** Febrero 3, 2026
**Error:** Internal Server Error (500) en `/api/proxy/gestion/login`
**Backend:** https://sgm.glp.riogas.com.uy

---

## 📊 Análisis del Problema

### ✅ Lo que SÍ funciona:

1. **Servidor Next.js**: ✅ Corriendo correctamente en localhost:3001
2. **Compilación**: ✅ Proxy y rutas compiladas sin errores
3. **Autenticación Frontend**: ✅ Login page renderiza correctamente
4. **Proxy Route**: ✅ Recibe y procesa la petición
5. **Conexión Backend**: ✅ Llega a `sgm.glp.riogas.com.uy`
6. **Headers Enviados**: ✅ Content-Type y Accept correctos

### ❌ Lo que NO funciona:

**El backend de GeneXus devuelve error 500:**
```json
{
  "error": {
    "code": 500,
    "message": "Internal Server Error"
  }
}
```

**Headers de respuesta del backend:**
```javascript
{
  'access-control-allow-origin': 'gx-file://.',  // ⚠️ Configurado para GeneXus Desktop
  'content-type': 'application/json',
  'server': 'Apache',
  'strict-transport-security': 'max-age=63072000; includeSubDomains; preload'
}
```

---

## 🔎 Diagnóstico Detallado

### 1. Logs de la Petición

```
[2026-02-03T18:14:13.378Z] POST /api/proxy/gestion/login

🔄 Proxy POST https://sgm.glp.riogas.com.uy/gestion/login

📤 Headers: { 
  'Content-Type': 'application/json', 
  Accept: 'application/json' 
}

📥 Response Status: 500
📥 Response Data: {
  "error": {
    "code": 500,
    "message": "Internal Server Error"
  }
}
```

### 2. Posibles Causas del Error 500

#### Causa A: Body Vacío o Malformado
**Probabilidad:** 🔴 ALTA

El endpoint de GeneXus espera un body específico:
```json
{
  "Usuario": "string",
  "Contrasenia": "string"
}
```

**Verificar:**
- ¿El frontend está enviando los campos correctamente?
- ¿Los nombres de los campos coinciden (case-sensitive)?
- ¿El body llega al proxy?

#### Causa B: Headers Incorrectos
**Probabilidad:** 🟡 MEDIA

El backend podría requerir headers adicionales:
- `X-Requested-With: XMLHttpRequest`
- `Origin: https://sgm.glp.riogas.com.uy`
- `Referer: https://sgm.glp.riogas.com.uy`
- `User-Agent` específico

#### Causa C: CORS Misconfiguration
**Probabilidad:** 🟡 MEDIA

El header `access-control-allow-origin: gx-file://.` indica que:
- El backend está configurado para aplicaciones GeneXus Desktop
- Puede estar rechazando peticiones de orígenes web

#### Causa D: Sesión o Cookie Requerida
**Probabilidad:** 🟢 BAJA

Aunque el endpoint de login normalmente no requiere sesión previa, el backend podría:
- Requerir un `GX_CLIENT_ID` inicial
- Esperar una cookie de sesión previa
- Tener protección CSRF

#### Causa E: Problema en el Backend
**Probabilidad:** 🟢 BAJA

Error interno del servidor GeneXus:
- Base de datos caída
- Servicio no disponible
- Configuración incorrecta

---

## 🔧 Soluciones Propuestas

### Solución 1: Verificar Body del Login ⭐ PRIORIDAD ALTA

**Agregar logging detallado en el proxy:**

```typescript
// En app/api/proxy/[...path]/route.ts
if (['POST', 'PUT', 'PATCH'].includes(method)) {
  try {
    const requestBody = await request.json();
    body = JSON.stringify(requestBody);
    console.log(`📤 Body being sent:`, body);  // ✅ Ya existe
    console.log(`📤 Body parsed:`, requestBody);  // 👈 AGREGAR ESTO
  } catch (e) {
    console.error(`❌ Error parsing body:`, e);  // 👈 Y ESTO
  }
}
```

**Verificar en el frontend (login page):**

```typescript
// Buscar en app/login/page.tsx o componente de login
const response = await fetch('/api/proxy/gestion/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    Usuario: username,      // ✅ Verificar estos nombres
    Contrasenia: password   // ✅ Y estos valores
  })
});
```

### Solución 2: Headers Adicionales para GeneXus

**Modificar proxy para incluir headers típicos de GeneXus:**

```typescript
// En app/api/proxy/[...path]/route.ts
const headers: HeadersInit = {
  'Content-Type': 'application/json',
  'Accept': 'application/json',
  'X-Requested-With': 'XMLHttpRequest',  // 👈 Agregar
  'Origin': API_BASE_URL,                 // 👈 Agregar
  'Referer': API_BASE_URL,                // 👈 Agregar
  'User-Agent': 'TrackMovil/1.0',        // 👈 Agregar
};
```

### Solución 3: Test Directo con cURL

**Probar la API directamente sin proxy:**

```bash
# Test 1: Sin body
curl -X POST https://sgm.glp.riogas.com.uy/gestion/login \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -k

# Test 2: Con credenciales (USAR CREDENCIALES REALES)
curl -X POST https://sgm.glp.riogas.com.uy/gestion/login \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d '{\"Usuario\":\"test\",\"Contrasenia\":\"test\"}' \
  -k

# Test 3: Con headers adicionales
curl -X POST https://sgm.glp.riogas.com.uy/gestion/login \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -H "X-Requested-With: XMLHttpRequest" \
  -H "Origin: https://sgm.glp.riogas.com.uy" \
  -d '{\"Usuario\":\"test\",\"Contrasenia\":\"test\"}' \
  -k
```

### Solución 4: Capturar Request del Navegador

**Usar DevTools para ver qué envía la petición:**

1. Abrir DevTools (F12)
2. Ir a Network tab
3. Intentar login
4. Click derecho en la petición `/api/proxy/gestion/login`
5. "Copy as cURL"
6. Comparar con lo que nuestro proxy envía

### Solución 5: Endpoint de Healthcheck

**Probar si el backend está accesible:**

```bash
# Test de conectividad
curl -I https://sgm.glp.riogas.com.uy -k

# Test de ruta base
curl https://sgm.glp.riogas.com.uy/gestion -k

# Test de metadata
curl https://sgm.glp.riogas.com.uy/gestion?gxobject=GXServices -k
```

---

## 🚀 Plan de Acción Inmediato

### Paso 1: Agregar Logging Detallado ⏱️ 2 minutos

```typescript
// En app/api/proxy/[...path]/route.ts
// Línea ~143, dentro del if de POST/PUT/PATCH:

if (['POST', 'PUT', 'PATCH'].includes(method)) {
  try {
    const requestBody = await request.json();
    body = JSON.stringify(requestBody);
    
    // 👇 AGREGAR ESTOS LOGS
    console.log(`📤 RAW Body Object:`, requestBody);
    console.log(`📤 Body Keys:`, Object.keys(requestBody));
    console.log(`📤 Body Values:`, Object.values(requestBody));
    console.log(`📤 Stringified Body:`, body);
    
  } catch (e) {
    console.error(`❌ Error parsing request body:`, e);
    console.error(`❌ Request content-type:`, request.headers.get('content-type'));
  }
}
```

### Paso 2: Test Manual con Postman/Insomnia ⏱️ 5 minutos

1. Abrir Postman
2. Crear request POST a `http://localhost:3001/api/proxy/gestion/login`
3. Body:
   ```json
   {
     "Usuario": "admin",
     "Contrasenia": "password123"
   }
   ```
4. Observar logs en consola del servidor

### Paso 3: Comparar con Versión Anterior ⏱️ 3 minutos

**Ver cómo funcionaba antes de las protecciones:**

```bash
# Ver el login route anterior
git log --all --full-history --oneline -- "app/api/proxy/**/*route.ts"

# Ver diferencias
git diff HEAD~5 HEAD -- app/api/proxy/
```

### Paso 4: Test Directo al Backend ⏱️ 5 minutos

```bash
# Usar PowerShell
Invoke-WebRequest -Uri "https://sgm.glp.riogas.com.uy/gestion/login" `
  -Method POST `
  -Headers @{
    "Content-Type"="application/json"
    "Accept"="application/json"
  } `
  -Body '{"Usuario":"test","Contrasenia":"test"}' `
  -SkipCertificateCheck
```

---

## 📝 Información Adicional Necesaria

Para diagnosticar completamente, necesitamos:

### Del Frontend:
1. **¿Qué está enviando el login form?**
   - Ver código de `app/login/page.tsx`
   - Ver componente que hace el fetch
   - Ver body exacto de la petición

### Del Backend:
2. **Documentación de la API de GeneXus:**
   - Formato esperado del body
   - Headers requeridos
   - Respuesta esperada de éxito

3. **Acceso a logs del backend (si es posible):**
   - Logs de Apache
   - Logs de GeneXus
   - Stack trace del error 500

### De Pruebas Anteriores:
4. **¿Funcionaba antes?**
   - ¿Cuándo fue la última vez que funcionó?
   - ¿Qué cambió desde entonces?
   - ¿Hay alguna versión que sí funcione?

---

## 🎯 Hipótesis Principal

**La causa más probable es que el body no esté llegando correctamente al backend.**

**Evidencia:**
1. El backend responde (no hay timeout ni connection error)
2. El error es 500 (server error, no 400 bad request)
3. El endpoint es `/login` que típicamente falla si no recibe credenciales

**Próximo paso:**
Agregar el logging detallado del Paso 1 y verificar qué body exacto se está enviando.

---

## 📊 Checklist de Verificación

- [ ] Agregar logging detallado del body en proxy
- [ ] Verificar qué envía el frontend en login form
- [ ] Probar con Postman/Insomnia directamente
- [ ] Test con cURL al backend directamente
- [ ] Capturar request completo con DevTools
- [ ] Revisar documentación API GeneXus
- [ ] Comparar con versión anterior que funcionaba
- [ ] Agregar headers adicionales (X-Requested-With, etc.)
- [ ] Verificar configuración CORS del backend
- [ ] Contactar administrador del backend GeneXus

---

## 🔄 Siguiente Paso Recomendado

**AHORA:** Agregar el logging detallado del Paso 1 y reintentar el login para ver exactamente qué body se está enviando.

¿Quieres que agregue ese logging ahora?
