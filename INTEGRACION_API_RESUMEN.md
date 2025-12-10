# 🔐 Sistema de Autenticación con API Real

## ✅ Implementado

### 1. Servicio de Autenticación (`lib/api/auth.ts`)

✅ **Cliente Axios configurado**
- URL base: `http://192.168.1.72:8082`
- Timeout: 10 segundos
- Headers automáticos

✅ **Interceptores**
- **Request**: Agrega token JWT automáticamente
- **Response**: Maneja errores 401 y redirige a login

✅ **Métodos del servicio**
```typescript
authService.login(username, password)      // Login con API
authService.logout()                       // Limpiar sesión
authService.getCurrentUser()               // Obtener usuario actual
authService.getToken()                     // Obtener token JWT
authService.isAuthenticated()              // Verificar autenticación
```

### 2. Integración con AuthContext

✅ **AuthContext actualizado**
- Usa `authService` para login real
- Guarda token JWT en localStorage
- Maneja errores de la API
- Persiste sesión entre recargas

✅ **Interfaz de Usuario mejorada**
```typescript
interface User {
  id: string;
  username: string;
  email: string;
  nombre: string;
  isRoot: string;
  roles: Array<{
    RolId: string;
    RolNombre: string;
    RolTipo: string;
  }>;
  loginTime: string;
  token: string;
}
```

### 3. Página de Login Actualizada

✅ **Manejo de errores real**
- Muestra mensajes de error de la API
- Feedback visual en caso de fallo
- Loader durante autenticación

### 4. Documentación

✅ **API_AUTH_DOCUMENTATION.md**
- Uso completo del servicio
- Ejemplos de código
- Estructura de respuestas
- Manejo de errores
- Flujo de autenticación

✅ **services.example.ts**
- Ejemplos de servicios adicionales
- Patrones de uso
- Manejo de errores
- Casos de uso comunes

## 🚀 Cómo Usar

### Login Básico

```typescript
import { authService } from '@/lib/api/auth';

const result = await authService.login('jgomez', 'VeintiunoDeOctubre!');

if (result.success) {
  console.log('Token:', result.token);
  console.log('Usuario:', result.user);
}
```

### En Componentes React

```typescript
import { useAuth } from '@/contexts/AuthContext';

const { login, user, isAuthenticated } = useAuth();

const handleLogin = async () => {
  const result = await login(username, password);
  
  if (result.success) {
    // Redirigir al dashboard
  } else {
    // Mostrar error
    console.error(result.error);
  }
};
```

### Hacer Peticiones Autenticadas

```typescript
import { apiClient } from '@/lib/api/auth';

// El token se agrega automáticamente
const response = await apiClient.get('/puestos/gestion/datos');
const data = response.data;
```

## 📊 Estructura de Respuesta de Login

```json
{
  "RespuestaLogin": "{
    \"success\": true,
    \"token\": \"eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9...\",
    \"user\": {
      \"id\": \"5\",
      \"username\": \"JGOMEZ\",
      \"email\": \"\",
      \"nombre\": \"\",
      \"isRoot\": \"S\",
      \"roles\": [
        {
          \"RolId\": \"1\",
          \"RolNombre\": \"Administrador del Puesto\",
          \"RolTipo\": \"G\"
        }
      ]
    }
  }"
}
```

## 🔒 Almacenamiento

### LocalStorage
- **trackmovil_token**: Token JWT
- **trackmovil_user**: Datos del usuario

### Persistencia
- La sesión persiste entre recargas
- Se limpia automáticamente en logout
- Se limpia en errores 401

## ⚙️ Configuración

### Cambiar URL de la API

Edita `lib/api/auth.ts`:

```typescript
const API_BASE_URL = 'http://TU_IP:TU_PUERTO';
```

### Cambiar Timeout

```typescript
const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000, // 10 segundos
});
```

## 🎯 Próximos Pasos

### Para agregar más servicios:

1. Crea archivo: `lib/api/nombreServicio.ts`
2. Importa `apiClient` de `lib/api/auth.ts`
3. Exporta objeto con métodos
4. Usa en componentes

**Ejemplo**:

```typescript
// lib/api/moviles.ts
import { apiClient } from './auth';

export const movilesService = {
  getAll: async () => {
    const response = await apiClient.get('/puestos/gestion/moviles');
    return response.data;
  },
  
  getById: async (id: number) => {
    const response = await apiClient.get(`/puestos/gestion/moviles/${id}`);
    return response.data;
  },
};
```

## 🧪 Testing

### En la consola del navegador (F12):

```javascript
// Importar servicio
const { authService } = await import('/lib/api/auth');

// Test de login
const response = await authService.login('jgomez', 'VeintiunoDeOctubre!');
console.log('Login response:', response);

// Obtener usuario actual
const user = authService.getCurrentUser();
console.log('Current user:', user);

// Obtener token
const token = authService.getToken();
console.log('Token:', token);
```

## ⚠️ Importante

1. **CORS**: La API debe permitir peticiones desde el dominio del frontend
2. **HTTPS**: En producción, usa HTTPS
3. **Seguridad**: El token en localStorage es accesible por JavaScript. Para mayor seguridad, considera cookies HttpOnly
4. **Errores 401**: Se manejan automáticamente y redirigen a `/login`

## 📁 Archivos Modificados/Creados

```
✅ lib/api/auth.ts                          (NUEVO - Servicio de auth)
✅ lib/api/services.example.ts              (NUEVO - Ejemplos)
✅ contexts/AuthContext.tsx                  (MODIFICADO - Integración API)
✅ app/login/page.tsx                        (MODIFICADO - Manejo errores)
✅ API_AUTH_DOCUMENTATION.md                 (NUEVO - Documentación)
✅ INTEGRACION_API_RESUMEN.md               (NUEVO - Este archivo)
```

## 🎉 Listo para Usar

El sistema de autenticación está completamente integrado con la API real. 

**Para probarlo**:

1. Inicia el servidor de desarrollo: `pnpm dev`
2. Ve a: `http://localhost:3000/login`
3. Ingresa credenciales:
   - Usuario: `jgomez`
   - Password: `VeintiunoDeOctubre!`
4. El sistema se conectará a la API real en `http://192.168.1.72:8082`

¡Todo está funcionando! 🚀
