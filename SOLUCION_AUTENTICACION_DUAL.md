# 🔄 Sincronización de Autenticación: GeneXus + Supabase

**Problema Detectado:** Febrero 3, 2026  
**Estado:** 🔴 Login funciona pero dashboard da 401

---

## 🔍 El Problema

### Dos Sistemas de Autenticación Separados

**Sistema 1: GeneXus (JWT)**
- Endpoint: `/api/proxy/gestion/login`
- Retorna: Token JWT + user data
- Se guarda en: localStorage (`trackmovil_token`, `trackmovil_user`)
- Usado para: Login frontend

**Sistema 2: Supabase (Sessions)**
- Usado por: `requireAuth()` en rutas API
- Verifica: Sesión de Supabase
- Problema: ❌ No hay sesión de Supabase después del login

### El Flujo Actual (Roto)

```
1. Usuario ingresa credenciales
2. POST /api/proxy/gestion/login → ✅ Success con JWT
3. localStorage guarda token JWT
4. Usuario entra al dashboard
5. Dashboard intenta GET /api/all-positions
6. requireAuth() verifica sesión Supabase → ❌ No existe
7. Retorna 401 Unauthorized
```

---

## 🎯 Soluciones Posibles

### Opción A: Crear Sesión de Supabase Después del Login ⭐ RECOMENDADA

**Flujo:**
```
1. Login GeneXus exitoso → JWT recibido
2. Crear usuario en Supabase (si no existe)
3. Crear sesión de Supabase
4. Guardar ambos tokens (JWT + Supabase)
5. Todas las rutas funcionan
```

**Pros:**
- ✅ Mantiene seguridad de Supabase
- ✅ No requiere cambiar todas las rutas
- ✅ Permite usar Row Level Security de Supabase

**Contras:**
- ⚠️ Requiere tabla de usuarios en Supabase
- ⚠️ Dos sistemas de auth activos

---

### Opción B: Cambiar Todas las Rutas a Usar JWT

**Flujo:**
```
1. Login GeneXus exitoso → JWT recibido
2. Guardar JWT en localStorage
3. Enviar JWT en header Authorization
4. Cambiar requireAuth() a verificar JWT
5. Eliminar Supabase auth
```

**Pros:**
- ✅ Un solo sistema de auth (más simple)
- ✅ No necesita Supabase Auth
- ✅ Menos dependencias

**Contras:**
- ⚠️ Hay que cambiar 42 rutas API
- ⚠️ Perder features de Supabase Auth
- ⚠️ Implementar validación JWT manual

---

### Opción C: Usar Solo Supabase Auth

**Flujo:**
```
1. Login directo en Supabase (sin GeneXus)
2. Sesión de Supabase creada
3. Todas las rutas funcionan
4. Eliminar login de GeneXus
```

**Pros:**
- ✅ Sistema unificado
- ✅ Features completas de Supabase
- ✅ No requiere sincronización

**Contras:**
- ❌ Perder integración con GeneXus
- ❌ Usuarios deben existir en Supabase
- ❌ No usa la API de GeneXus

---

## 🚀 Implementación Recomendada: Opción A

### Paso 1: Crear Endpoint de Sincronización

Crear `/api/auth/sync-session` que:
1. Recibe JWT de GeneXus
2. Verifica el JWT
3. Crea/actualiza usuario en Supabase
4. Crea sesión de Supabase
5. Retorna ambas credenciales

### Paso 2: Modificar AuthContext

Después del login exitoso en GeneXus:
1. Llamar a `/api/auth/sync-session`
2. Crear sesión de Supabase
3. Guardar ambos tokens

### Paso 3: Mantener Sincronización

- Al refrescar página: verificar ambas sesiones
- Al logout: cerrar ambas sesiones
- Al expirar JWT: cerrar sesión de Supabase

---

## 📝 Código de Implementación

### 1. Crear `/app/api/auth/sync-session/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';

/**
 * Sincroniza sesión de GeneXus con Supabase
 * Crea una sesión de Supabase usando el token JWT de GeneXus
 */
export async function POST(request: NextRequest) {
  try {
    const { token, user } = await request.json();

    if (!token || !user) {
      return NextResponse.json(
        { error: 'Token y usuario requeridos' },
        { status: 400 }
      );
    }

    const supabase = createRouteHandlerClient({ cookies });

    // Opción 1: Crear sesión de Supabase con email/password
    // (requiere que los usuarios existan en Supabase)
    
    // Opción 2: Usar signInAnonymously + metadata
    // (no requiere usuarios pre-existentes)
    const { data, error } = await supabase.auth.signInAnonymously({
      options: {
        data: {
          genexus_token: token,
          genexus_user_id: user.id,
          genexus_username: user.username,
          genexus_roles: user.roles,
        }
      }
    });

    if (error) {
      console.error('Error creando sesión Supabase:', error);
      return NextResponse.json(
        { error: 'Error al crear sesión' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      supabase_session: data.session,
    });
  } catch (error) {
    console.error('Error en sync-session:', error);
    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500 }
    );
  }
}
```

### 2. Modificar `contexts/AuthContext.tsx`

```typescript
const login = async (username: string, password: string): Promise<{ success: boolean; error?: string }> => {
  try {
    // 1. Login en GeneXus
    const response: ParsedLoginResponse = await authService.login(username, password);
    
    if (response.success && response.user && response.user.id && response.user.username) {
      const newUser: User = {
        id: response.user.id,
        username: response.user.username,
        email: response.user.email || '',
        nombre: response.user.nombre || response.user.username,
        isRoot: response.user.isRoot || 'N',
        roles: response.user.roles || [],
        loginTime: new Date().toISOString(),
        token: response.token,
      };
      
      // 2. Sincronizar con Supabase
      try {
        const syncResponse = await fetch('/api/auth/sync-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token: response.token,
            user: newUser,
          }),
        });

        if (!syncResponse.ok) {
          console.warn('No se pudo sincronizar sesión con Supabase');
          // No fallar el login si Supabase falla
        } else {
          console.log('✅ Sesión sincronizada con Supabase');
        }
      } catch (syncError) {
        console.warn('Error sincronizando sesión:', syncError);
        // No fallar el login si Supabase falla
      }
      
      setUser(newUser);
      return { success: true };
    } else {
      return { 
        success: false, 
        error: response.message || 'Usuario o contraseña incorrectos' 
      };
    }
  } catch (error) {
    console.error('Error en login:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Error de conexión' 
    };
  }
};
```

### 3. Modificar Logout

```typescript
const logout = async () => {
  // 1. Cerrar sesión en Supabase
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  
  await supabase.auth.signOut();
  
  // 2. Cerrar sesión local
  setUser(null);
  authService.logout();
};
```

---

## 🔄 Alternativa Simple: Cambiar requireAuth()

Si no quieres implementar Opción A, puedes cambiar `requireAuth()` para aceptar JWT:

### Modificar `lib/auth-middleware.ts`

```typescript
export async function requireAuth(request: NextRequest) {
  // 1. Intentar Supabase primero
  const { supabase, response } = createClient(request);
  const { data: { session } } = await supabase.auth.getSession();
  
  if (session?.user) {
    return { user: session.user, session };
  }

  // 2. Si no hay sesión Supabase, verificar JWT de GeneXus
  const authHeader = request.headers.get('Authorization');
  const token = authHeader?.replace('Bearer ', '');
  
  if (token) {
    try {
      // Verificar JWT (puedes usar jsonwebtoken o verificar con GeneXus)
      const decoded = verifyJWT(token); // Implementar esta función
      
      if (decoded && decoded.username) {
        return {
          user: {
            id: decoded.id || decoded.username,
            email: decoded.email || '',
          },
          session: null, // No hay sesión Supabase pero sí JWT válido
        };
      }
    } catch (error) {
      // JWT inválido, continuar al 401
    }
  }

  // 3. No hay autenticación válida
  console.log('⚠️  Intento de acceso sin autenticación');
  return NextResponse.json(
    { success: false, error: 'No autorizado', code: 'UNAUTHORIZED' },
    { status: 401 }
  );
}
```

---

## 🎯 Recomendación Final

**Para tu caso, recomiendo:**

### Opción A (Corto Plazo) - 15 minutos
Implementar endpoint `/api/auth/sync-session` para crear sesión de Supabase después del login.

**Ventajas:**
- ✅ Rápido de implementar
- ✅ No rompe nada existente
- ✅ Mantiene seguridad de Supabase

### Opción B (Mediano Plazo) - 1 hora
Modificar `requireAuth()` para aceptar JWT de GeneXus como alternativa a sesión Supabase.

**Ventajas:**
- ✅ No requiere crear sesiones adicionales
- ✅ Usa el token que ya tienes
- ✅ Más simple conceptualmente

---

## 📊 Decisión

**¿Qué prefieres?**

1. **Opción A**: Crear sesión de Supabase (más robusto, mantiene features de Supabase)
2. **Opción B**: Modificar requireAuth() para aceptar JWT (más simple, menos dependencias)
3. **Opción C**: Otra solución que tengas en mente

**Dime cuál prefieres y lo implemento ahora.** 🚀
