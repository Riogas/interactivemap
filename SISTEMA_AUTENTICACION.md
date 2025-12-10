# 🔐 Sistema de Autenticación TrackMovil

## Descripción

Sistema de autenticación completo con pantalla de login profesional, gestión de sesiones y protección de rutas. El sistema mantiene la sesión del usuario en localStorage y redirige automáticamente según el estado de autenticación.

## Características

### 🎨 Pantalla de Login Profesional

- **Diseño Moderno**: Gradientes animados, glassmorphism y elementos decorativos
- **Animaciones Fluidas**: Transiciones suaves con Framer Motion
- **Responsive**: Adaptable a todos los tamaños de pantalla
- **UX Optimizada**: 
  - Toggle para mostrar/ocultar contraseña
  - Validación en tiempo real
  - Mensajes de error claros
  - Loading state durante autenticación
  - Feedback visual inmediato

### 🛡️ Gestión de Sesiones

- **Persistencia**: Sesión guardada en localStorage
- **Auto-login**: Si hay sesión válida, redirige directamente al dashboard
- **Logout**: Cierre de sesión desde el navbar
- **Seguridad**: Token de sesión con información del usuario

### 🔒 Protección de Rutas

- **ProtectedRoute Component**: Envuelve páginas que requieren autenticación
- **Redirección Automática**: Si no está autenticado, redirige a /login
- **Loading State**: Spinner mientras valida la sesión

## Estructura de Archivos

```
contexts/
  └── AuthContext.tsx          # Contexto de autenticación global

components/
  └── auth/
      └── ProtectedRoute.tsx   # HOC para proteger rutas

app/
  ├── page.tsx                 # Página principal (redirige)
  ├── login/
  │   └── page.tsx            # Página de login
  └── dashboard/
      └── page.tsx            # Dashboard (protegido)

components/
  └── layout/
      └── Navbar.tsx          # Navbar con botón de logout
```

## Uso del Sistema

### 1. AuthContext

El contexto de autenticación proporciona:

```typescript
interface AuthContextType {
  user: User | null;              // Usuario actual o null
  login: (username, password) => Promise<boolean>;  // Función de login
  logout: () => void;             // Función de logout
  isAuthenticated: boolean;       // Estado de autenticación
}
```

**Uso en componentes:**

```typescript
import { useAuth } from '@/contexts/AuthContext';

function MyComponent() {
  const { user, isAuthenticated, logout } = useAuth();
  
  return (
    <div>
      {isAuthenticated && <p>Hola, {user?.username}!</p>}
    </div>
  );
}
```

### 2. Proteger una Ruta

```typescript
import ProtectedRoute from '@/components/auth/ProtectedRoute';

export default function SecurePage() {
  return (
    <ProtectedRoute>
      <MySecureContent />
    </ProtectedRoute>
  );
}
```

### 3. Login del Usuario

```typescript
const { login } = useAuth();

const handleLogin = async () => {
  const success = await login(username, password);
  if (success) {
    router.push('/dashboard');
  } else {
    setError('Credenciales inválidas');
  }
};
```

### 4. Logout del Usuario

```typescript
const { logout } = useAuth();
const router = useRouter();

const handleLogout = () => {
  logout();
  router.push('/login');
};
```

## Flujo de Navegación

### Usuario No Autenticado

```
1. Usuario visita / 
   → Verifica autenticación
   → No autenticado
   → Redirige a /login

2. Usuario en /login
   → Ingresa credenciales
   → Login exitoso
   → Redirige a /dashboard

3. Usuario intenta acceder /dashboard
   → ProtectedRoute verifica sesión
   → No autenticado
   → Redirige a /login
```

### Usuario Autenticado

```
1. Usuario visita /
   → Verifica autenticación
   → Autenticado
   → Redirige a /dashboard

2. Usuario en /dashboard
   → ProtectedRoute verifica sesión
   → Sesión válida
   → Muestra contenido

3. Usuario hace logout
   → Elimina sesión de localStorage
   → Redirige a /login
```

## Validación Actual

**⚠️ IMPORTANTE**: Por ahora, el sistema acepta **cualquier usuario y contraseña** para testing.

```typescript
// En AuthContext.tsx - login()
if (username.trim() && password.trim()) {
  // ✅ Login exitoso con cualquier credencial
  return true;
}
```

### Implementación Futura

Para integrar autenticación real:

1. **Modificar la función login** en `AuthContext.tsx`:

```typescript
const login = async (username: string, password: string): Promise<boolean> => {
  try {
    // Llamada a API de autenticación
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });

    if (response.ok) {
      const { user, token } = await response.json();
      
      const newUser: User = {
        username: user.username,
        loginTime: new Date().toISOString(),
        token, // Guardar token JWT
      };
      
      setUser(newUser);
      localStorage.setItem('trackmovil_user', JSON.stringify(newUser));
      return true;
    }
    
    return false;
  } catch (error) {
    console.error('Error en login:', error);
    return false;
  }
};
```

2. **Agregar validación de token**:

```typescript
const validateToken = async (token: string): Promise<boolean> => {
  try {
    const response = await fetch('/api/auth/validate', {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    return response.ok;
  } catch {
    return false;
  }
};
```

## Diseño de la Pantalla de Login

### Elementos Visuales

1. **Fondo Animado**:
   - Gradiente: `from-blue-50 via-indigo-50 to-purple-50`
   - 3 círculos animados con blur para efecto de profundidad
   - Rotación y escala continua

2. **Card Principal**:
   - Glassmorphism: `bg-white/80 backdrop-blur-xl`
   - Borde sutil: `border-white/20`
   - Sombra prominente: `shadow-2xl`
   - Bordes redondeados: `rounded-3xl`

3. **Logo**:
   - Icono de ubicación en gradiente azul
   - Animación hover: scale y rotate
   - Fondo blanco con sombra

4. **Campos de Entrada**:
   - Iconos descriptivos (usuario, candado)
   - Placeholder claro
   - Focus state con borde azul
   - Transiciones suaves

5. **Botón de Submit**:
   - Gradiente: `from-blue-500 to-indigo-600`
   - Hover effect con escala
   - Loading state con spinner
   - Deshabilitado durante carga

6. **Mensajes de Error**:
   - Animación de entrada/salida
   - Fondo rojo claro con borde
   - Icono de alerta

### Paleta de Colores

```css
/* Primarios */
--primary-blue: #3B82F6;
--primary-indigo: #4F46E5;
--primary-purple: #7C3AED;

/* Fondos */
--bg-light-blue: #EFF6FF;
--bg-light-indigo: #EEF2FF;
--bg-light-purple: #F5F3FF;

/* Grises */
--gray-50: #F9FAFB;
--gray-600: #4B5563;
--gray-700: #374151;

/* Estados */
--error-bg: #FEF2F2;
--error-border: #FECACA;
--error-text: #B91C1C;
```

## Información de Usuario en el Navbar

El navbar muestra:
- **Avatar circular** con inicial del usuario
- **Nombre de usuario** (oculto en pantallas pequeñas)
- **Botón de logout** con icono y texto

```tsx
<div className="flex items-center gap-3">
  <div className="w-8 h-8 bg-gradient-to-br from-blue-400 to-indigo-500 rounded-full">
    <span>{user?.username?.charAt(0).toUpperCase()}</span>
  </div>
  <span>{user?.username}</span>
  <button onClick={handleLogout}>
    <svg>...</svg>
    Salir
  </button>
</div>
```

## Mejoras Futuras

### Seguridad
- [ ] Implementar autenticación JWT
- [ ] Validación de token en cada request
- [ ] Refresh token automático
- [ ] Expiración de sesión por inactividad
- [ ] Encriptación de credenciales

### Funcionalidad
- [ ] "Recordarme" checkbox
- [ ] Recuperación de contraseña
- [ ] Registro de nuevos usuarios
- [ ] Roles y permisos de usuario
- [ ] Historial de sesiones

### UX
- [ ] Autenticación con Google/Microsoft
- [ ] Autenticación biométrica
- [ ] 2FA (Two-Factor Authentication)
- [ ] Notificaciones de login desde nuevos dispositivos

## Testing

Para probar el sistema:

1. **Login exitoso**:
   - Usuario: `cualquier_texto`
   - Password: `cualquier_password`
   - Resultado: ✅ Redirige a /dashboard

2. **Campos vacíos**:
   - Usuario: ` ` (vacío)
   - Password: ` ` (vacío)
   - Resultado: ❌ Muestra error

3. **Persistencia de sesión**:
   - Hacer login
   - Refrescar página
   - Resultado: ✅ Mantiene sesión activa

4. **Logout**:
   - Click en botón "Salir"
   - Resultado: ✅ Elimina sesión y redirige a /login

5. **Protección de rutas**:
   - Sin login, visitar `/dashboard`
   - Resultado: ✅ Redirige a /login

## Relacionado

- `ARQUITECTURA_REALTIME.md` - Arquitectura del sistema
- `RESUMEN_EJECUTIVO.md` - Resumen del proyecto
- `INICIO_RAPIDO.md` - Guía de inicio rápido
