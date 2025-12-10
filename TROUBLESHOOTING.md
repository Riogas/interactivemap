# 🔧 Troubleshooting - Problemas Comunes y Soluciones

## 🚨 Problema: CORS Error

### Síntoma
```
Access to XMLHttpRequest blocked by CORS policy
```

### ✅ Solución
Ya implementado el proxy. Verifica que estés usando `/api/proxy` en lugar de la IP directa.

**Verificar en** `lib/api/auth.ts`:
```typescript
const API_BASE_URL = '/api/proxy'; // ✅ Correcto
// const API_BASE_URL = 'http://192.168.1.72:8082'; // ❌ Incorrecto
```

---

## 🚨 Problema: Error de Conexión

### Síntoma
```
Error al conectar con el servidor
```

### Posibles Causas

#### 1. API Externa no está corriendo
**Verificar**:
```bash
curl http://192.168.1.72:8082/puestos/gestion/login
```

**Si no responde**: Inicia el servidor de la API externa.

#### 2. URL incorrecta
**Verificar** `lib/api/config.ts`:
```typescript
export const API_BASE_URL = 'http://192.168.1.72:8082';
```

Asegúrate que la IP y puerto sean correctos.

#### 3. Firewall bloqueando
**Windows**: 
- Abre "Firewall de Windows Defender"
- Permite conexiones entrantes al puerto 8082

**Verificar con ping**:
```bash
ping 192.168.1.72
```

---

## 🚨 Problema: 401 Unauthorized

### Síntoma
```
Response Status: 401
```

### Posibles Causas

#### 1. Credenciales incorrectas
Verifica usuario y contraseña:
```typescript
UserName: 'jgomez'
Password: 'VeintiunoDeOctubre!'
```

#### 2. Token expirado
El token JWT puede haber expirado. Haz logout y vuelve a iniciar sesión.

```typescript
authService.logout();
```

---

## 🚨 Problema: Respuesta Vacía o Inesperada

### Síntoma
```
Response: {}
Response: { response: "..." }
```

### ✅ Solución

#### 1. Verificar formato de respuesta
La API puede devolver texto en lugar de JSON. El proxy ahora maneja ambos casos.

**Ver logs en consola del servidor** (terminal donde corre `pnpm dev`):
```
📥 Response Status: 200
📥 Response Data: ...
```

#### 2. RespuestaLogin como string
La API devuelve un JSON string dentro de `RespuestaLogin`:

```json
{
  "RespuestaLogin": "{\"success\":true,...}"
}
```

El `authService` automáticamente parsea esto:

```typescript
const parsed = JSON.parse(response.data.RespuestaLogin);
```

---

## 🚨 Problema: Cookies no se están enviando

### Síntoma
La API requiere cookies pero no se están enviando.

### ✅ Solución Implementada

El proxy ahora incluye:
```typescript
credentials: 'include'
```

Y copia los headers de cookies:
```typescript
const cookieHeader = request.headers.get('Cookie');
if (cookieHeader) {
  headers['Cookie'] = cookieHeader;
}
```

---

## 🚨 Problema: Timeout

### Síntoma
```
Request timed out
```

### ✅ Solución

Aumenta el timeout en `lib/api/auth.ts`:

```typescript
const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000, // 30 segundos (antes: 10000)
});
```

---

## 🧪 Herramientas de Debugging

### 1. Logs en el Servidor Next.js

El proxy incluye logs detallados. Verifica la **terminal donde corre `pnpm dev`**:

```
🔄 Proxy POST /puestos/gestion/login
📤 Headers: { Content-Type: 'application/json', ... }
📤 Body: {"UserName":"jgomez",...}
📥 Response Status: 200
📥 Response Data: {...}
```

### 2. Logs en el Navegador

Abre DevTools (F12) → Console:

```javascript
// Ver todas las peticiones de red
// Network tab → Filtrar por "proxy"
```

### 3. Script de Prueba

Ejecuta `test-api-connection.js` en la consola:

```javascript
// Copia el contenido de test-api-connection.js
// Pégalo en la consola del navegador (F12)
```

Esto ejecutará 3 tests:
1. ✅ Verificar que el proxy está activo
2. ✅ Test de login con credenciales
3. ✅ Verificar authService

### 4. cURL directo

Prueba la API directamente sin el proxy:

```bash
curl --location 'http://192.168.1.72:8082/puestos/gestion/login' \
--header 'Content-Type: application/json' \
--data '{
  "UserName":"jgomez",
  "Password":"VeintiunoDeOctubre!"
}'
```

Si esto funciona pero el proxy no, el problema está en el proxy.
Si esto NO funciona, el problema está en la API externa.

---

## 📋 Checklist de Verificación

Antes de reportar un problema, verifica:

- [ ] `pnpm dev` está corriendo sin errores
- [ ] La API externa (`http://192.168.1.72:8082`) está corriendo
- [ ] El archivo `lib/api/config.ts` tiene la URL correcta
- [ ] El archivo `lib/api/auth.ts` usa `/api/proxy`
- [ ] No hay errores en la consola del navegador (F12)
- [ ] No hay errores en la terminal del servidor (`pnpm dev`)
- [ ] cURL directo a la API funciona
- [ ] Credenciales son correctas

---

## 🔍 Verificar Estado Actual

### En la consola del navegador (F12):

```javascript
// 1. Verificar configuración
const { PROXY_BASE_URL } = await import('/lib/api/config.ts');
console.log('Proxy URL:', PROXY_BASE_URL);

// 2. Test rápido del proxy
const test = await fetch('/api/proxy/puestos/gestion/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ UserName: 'test', Password: 'test' })
});
console.log('Status:', test.status);
console.log('Response:', await test.json());

// 3. Verificar authService
const { authService } = await import('/lib/api/auth.ts');
console.log('authService:', authService);
console.log('isAuthenticated:', authService.isAuthenticated());
```

---

## 🆘 Ayuda Adicional

### Logs Útiles

**En el servidor (terminal)**: Muestra detalles de las peticiones
**En el navegador (F12 → Console)**: Muestra errores del cliente
**En el navegador (F12 → Network)**: Muestra todas las peticiones HTTP

### Información para Soporte

Si necesitas ayuda, incluye:
1. Logs del servidor (terminal)
2. Logs del navegador (consola)
3. Screenshot de Network tab
4. Resultado de cURL directo a la API
5. Contenido de `lib/api/config.ts`

---

## ✅ Estado del Sistema

Verifica que todo esté correcto:

```bash
# 1. Servidor Next.js corriendo
# Terminal debe mostrar:
# ▲ Next.js 14.x.x
# - Local: http://localhost:3000

# 2. Archivos del proxy existen
ls app/api/proxy/login/route.ts
ls app/api/proxy/[...path]/route.ts

# 3. Configuración correcta
cat lib/api/config.ts
cat lib/api/auth.ts

# 4. API externa responde
curl http://192.168.1.72:8082/puestos/gestion/login
```

---

## 🎯 Soluciones Rápidas

| Problema | Solución Rápida |
|----------|-----------------|
| CORS Error | Ya está solucionado con el proxy |
| 401 Unauthorized | Verifica credenciales |
| Timeout | Aumenta timeout en `lib/api/auth.ts` |
| Cookies no funcionan | Ya está implementado `credentials: 'include'` |
| Error de conexión | Verifica que la API externa esté corriendo |
| Respuesta vacía | Revisa logs del servidor |

---

**¿Necesitas más ayuda?** Revisa la documentación completa en:
- `PROXY_API_CORS.md` - Documentación del proxy
- `API_AUTH_DOCUMENTATION.md` - Documentación del servicio de auth
- `SOLUCION_CORS_RESUMEN.md` - Resumen de la solución CORS
