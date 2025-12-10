# 🔄 Proxy API para Evitar CORS

## ❌ Problema Original

Cuando el frontend intenta conectarse directamente a la API en `http://192.168.1.72:8082`, el navegador bloquea la petición con error CORS:

```
Access to XMLHttpRequest at 'http://192.168.1.72:8082/puestos/gestion/login' 
from origin 'http://localhost:3000' has been blocked by CORS policy
```

## ✅ Solución: Proxy de Next.js

Creamos un proxy en Next.js que actúa como intermediario:

```
Cliente (Browser) → Next.js Server → API Externa
```

El navegador NO hace peticiones directas a la API externa, sino que llama al servidor Next.js, que a su vez llama a la API.

## 📁 Archivos del Proxy

### 1. Proxy Específico de Login

**Archivo**: `app/api/proxy/login/route.ts`

```typescript
// Maneja: POST /api/proxy/login
// Redirige a: POST http://192.168.1.72:8082/puestos/gestion/login
```

### 2. Proxy Genérico (Recomendado)

**Archivo**: `app/api/proxy/[...path]/route.ts`

Este proxy maneja TODAS las rutas automáticamente:

```typescript
// Cliente → Next.js → API Externa
POST /api/proxy/puestos/gestion/login
  → http://192.168.1.72:8082/puestos/gestion/login

GET /api/proxy/puestos/gestion/moviles
  → http://192.168.1.72:8082/puestos/gestion/moviles

PUT /api/proxy/puestos/gestion/moviles/123
  → http://192.168.1.72:8082/puestos/gestion/moviles/123
```

## 🔧 Configuración

### URL Base Actualizada

En `lib/api/auth.ts`:

```typescript
// ANTES (CORS Error ❌)
const API_BASE_URL = 'http://192.168.1.72:8082';

// DESPUÉS (Sin CORS ✅)
const API_BASE_URL = '/api/proxy';
```

### El proxy maneja:

✅ Métodos HTTP: GET, POST, PUT, DELETE, PATCH  
✅ Query parameters  
✅ Headers (incluido Authorization)  
✅ Request body (JSON)  
✅ Response status codes  
✅ Logs para debugging  

## 🚀 Uso

### No necesitas cambiar nada en tu código

El servicio `authService` funciona exactamente igual:

```typescript
import { authService } from '@/lib/api/auth';

// Esto ahora usa el proxy automáticamente
const response = await authService.login('jgomez', 'VeintiunoDeOctubre!');
```

### Peticiones directas con axios

```typescript
import { apiClient } from '@/lib/api/auth';

// GET con proxy
const moviles = await apiClient.get('/puestos/gestion/moviles');

// POST con proxy
const nuevo = await apiClient.post('/puestos/gestion/moviles', {
  nombre: 'Movil 123'
});

// PUT con proxy
const actualizado = await apiClient.put('/puestos/gestion/moviles/5', {
  nombre: 'Movil Actualizado'
});

// DELETE con proxy
await apiClient.delete('/puestos/gestion/moviles/5');
```

## 🔍 Cómo Funciona

### 1. Cliente hace petición

```typescript
axios.post('/api/proxy/puestos/gestion/login', {
  UserName: 'jgomez',
  Password: 'VeintiunoDeOctubre!'
});
```

### 2. Next.js Server recibe la petición

El servidor captura la petición en `app/api/proxy/[...path]/route.ts`

### 3. Next.js reenvía a la API externa

```typescript
fetch('http://192.168.1.72:8082/puestos/gestion/login', {
  method: 'POST',
  body: JSON.stringify({ UserName: '...', Password: '...' })
});
```

### 4. API responde al servidor Next.js

```json
{
  "RespuestaLogin": "{\"success\":true,\"token\":\"...\"}"
}
```

### 5. Next.js reenvía la respuesta al cliente

```typescript
return NextResponse.json(data);
```

## 📊 Logs de Debugging

El proxy incluye logs en la consola del servidor:

```bash
🔄 Proxy POST /puestos/gestion/login
✅ 200 OK

🔄 Proxy GET /puestos/gestion/moviles
✅ 200 OK

🔄 Proxy PUT /puestos/gestion/moviles/5
❌ 500 Internal Server Error
```

## ⚙️ Configuración Avanzada

### Cambiar URL de la API Externa

Edita `app/api/proxy/[...path]/route.ts`:

```typescript
const API_BASE_URL = 'http://TU_IP:TU_PUERTO';
```

### Agregar Headers Personalizados

```typescript
const headers: HeadersInit = {
  'Content-Type': 'application/json',
  'X-Custom-Header': 'value',
};
```

### Timeout

```typescript
const response = await fetch(fullUrl, {
  method,
  headers,
  body,
  signal: AbortSignal.timeout(10000), // 10 segundos
});
```

### Manejo de Errores Específicos

```typescript
if (response.status === 401) {
  return NextResponse.json(
    { error: 'No autorizado' },
    { status: 401 }
  );
}
```

## 🎯 Ventajas del Proxy

1. ✅ **Sin CORS**: El navegador solo ve peticiones al mismo origen
2. ✅ **Seguridad**: Puedes ocultar la URL real de la API
3. ✅ **Centralizado**: Un solo lugar para configurar la API
4. ✅ **Logging**: Fácil monitorear peticiones en el servidor
5. ✅ **Transformación**: Puedes modificar requests/responses si es necesario
6. ✅ **Caché**: Puedes agregar caché en el servidor
7. ✅ **Rate Limiting**: Controlar límite de peticiones

## 🔒 Seguridad

### Validación de Tokens

El proxy respeta los tokens JWT:

```typescript
// El token se envía automáticamente
const authHeader = request.headers.get('Authorization');
if (authHeader) {
  headers['Authorization'] = authHeader;
}
```

### Variables de Entorno (Recomendado)

Para producción, usa variables de entorno:

**`.env.local`**:
```
API_BASE_URL=http://192.168.1.72:8082
```

**`route.ts`**:
```typescript
const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:8082';
```

## 🧪 Testing

### En desarrollo (localhost:3000)

```bash
# Terminal 1: Servidor Next.js
pnpm dev

# Terminal 2: Test con curl
curl -X POST http://localhost:3000/api/proxy/puestos/gestion/login \
  -H "Content-Type: application/json" \
  -d '{"UserName":"jgomez","Password":"VeintiunoDeOctubre!"}'
```

### En consola del navegador (F12)

```javascript
// Test de login
const response = await fetch('/api/proxy/puestos/gestion/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    UserName: 'jgomez',
    Password: 'VeintiunoDeOctubre!'
  })
});

const data = await response.json();
console.log(data);
```

## 🚀 Despliegue

### Desarrollo
```bash
pnpm dev
```
Las peticiones irán a `http://192.168.1.72:8082`

### Producción

1. Configura variable de entorno `API_BASE_URL`
2. Despliega en Vercel/Netlify/otro hosting
3. El proxy funcionará automáticamente

## 📝 Rutas Disponibles

| Método | Ruta Cliente | Ruta API Real |
|--------|--------------|---------------|
| POST | `/api/proxy/puestos/gestion/login` | `http://192.168.1.72:8082/puestos/gestion/login` |
| GET | `/api/proxy/puestos/gestion/moviles` | `http://192.168.1.72:8082/puestos/gestion/moviles` |
| GET | `/api/proxy/puestos/gestion/moviles/5` | `http://192.168.1.72:8082/puestos/gestion/moviles/5` |
| POST | `/api/proxy/puestos/gestion/moviles` | `http://192.168.1.72:8082/puestos/gestion/moviles` |
| PUT | `/api/proxy/puestos/gestion/moviles/5` | `http://192.168.1.72:8082/puestos/gestion/moviles/5` |
| DELETE | `/api/proxy/puestos/gestion/moviles/5` | `http://192.168.1.72:8082/puestos/gestion/moviles/5` |

## ✅ Resumen

1. **Problema**: CORS bloqueaba peticiones directas a la API
2. **Solución**: Proxy en Next.js que actúa como intermediario
3. **Resultado**: Sin errores de CORS, todo funciona transparentemente
4. **Cambios necesarios**: Solo cambiar `API_BASE_URL` en `lib/api/auth.ts`
5. **Funcionamiento**: Automático, sin cambios en el código del cliente

¡El proxy está listo y funcionando! 🎉
