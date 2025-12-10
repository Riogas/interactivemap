# 🧹 Limpieza de LocalStorage

## ❌ Error: JSON.parse Unexpected Character

Este error ocurre cuando hay datos corruptos en `localStorage`.

## 🔧 Solución Rápida

### Opción 1: Consola del Navegador (F12)

```javascript
// Limpiar localStorage de TrackMovil
localStorage.removeItem('trackmovil_user');
localStorage.removeItem('trackmovil_token');

// Verificar
console.log('User:', localStorage.getItem('trackmovil_user'));
console.log('Token:', localStorage.getItem('trackmovil_token'));

// Recargar página
location.reload();
```

### Opción 2: Limpiar Todo el localStorage

```javascript
// ⚠️ CUIDADO: Esto borra TODO el localStorage
localStorage.clear();
location.reload();
```

### Opción 3: DevTools Application Tab

1. Abrir DevTools (F12)
2. Ir a la pestaña **Application**
3. En el menú lateral: **Storage** > **Local Storage**
4. Click en tu dominio (localhost:3000)
5. Encontrar `trackmovil_user` y `trackmovil_token`
6. Click derecho > **Delete**
7. Recargar la página

## ✅ Prevención Implementada

### 1. Validación al Cargar Sesión

**`contexts/AuthContext.tsx`**:
```typescript
useEffect(() => {
  const savedUser = localStorage.getItem('trackmovil_user');
  const savedToken = localStorage.getItem('trackmovil_token');
  
  if (savedUser && savedToken) {
    try {
      // Validar formato JSON
      if (!savedUser.startsWith('{')) {
        throw new Error('Invalid user data format');
      }
      
      const parsedUser = JSON.parse(savedUser);
      
      // Validar campos requeridos
      if (!parsedUser.username || !parsedUser.id) {
        throw new Error('Invalid user data structure');
      }
      
      setUser({ ...parsedUser, token: savedToken });
    } catch (e) {
      console.error('Error al cargar sesión, limpiando localStorage:', e);
      // Auto-limpieza de datos corruptos
      localStorage.removeItem('trackmovil_user');
      localStorage.removeItem('trackmovil_token');
    }
  }
  setIsLoading(false);
}, []);
```

### 2. No Guardar Usuario Inválido

**`lib/api/auth.ts`**:
```typescript
// Solo guardar si hay usuario válido
if (parsedResponse.user && parsedResponse.user.id && parsedResponse.user.username) {
  localStorage.setItem('trackmovil_token', parsedResponse.token);
  localStorage.setItem('trackmovil_user', JSON.stringify(parsedResponse.user));
} else {
  console.warn('⚠️ Login sin datos de usuario. No se guarda en localStorage.');
}
```

### 3. Rechazo de Login Sin Usuario

**`contexts/AuthContext.tsx`**:
```typescript
// El login es exitoso SOLO si success=true Y viene el objeto user
if (response.success && response.user && response.user.id && response.user.username) {
  // Login exitoso
  setUser(newUser);
  return { success: true };
} else if (response.success && !response.user) {
  // Success=true pero sin usuario = credenciales inválidas
  return { 
    success: false, 
    error: 'Usuario o contraseña incorrectos' 
  };
}
```

## 📊 Respuestas Válidas vs Inválidas

### ✅ Respuesta VÁLIDA (Login Exitoso)

```json
{
  "RespuestaLogin": "{
    \"success\": true,
    \"token\": \"eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9...\",
    \"user\": {
      \"email\": \"\",
      \"id\": \"5\",
      \"isRoot\": \"S\",
      \"nombre\": \"\",
      \"roles\": [{
        \"RolId\": \"1\",
        \"RolNombre\": \"Administrador del Puesto\",
        \"RolTipo\": \"G\"
      }],
      \"username\": \"JGOMEZ\"
    }
  }"
}
```

**Resultado**: ✅ Usuario logueado, redirige a `/dashboard`

### ❌ Respuesta INVÁLIDA (Credenciales Incorrectas)

```json
{
  "RespuestaLogin": "{
    \"expiresIn\": \"0\",
    \"message\": \"\",
    \"requireIdentity\": true,
    \"success\": true,
    \"token\": \"eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9...\",
    \"verifiedBy\": \"\"
  }"
}
```

**Problema**: `user` no existe

**Resultado**: ❌ "Usuario o contraseña incorrectos"

## 🔍 Debugging

### Ver datos en localStorage

```javascript
// En consola del navegador (F12)
console.log('User:', localStorage.getItem('trackmovil_user'));
console.log('Token:', localStorage.getItem('trackmovil_token'));

// Parse del usuario
try {
  const user = JSON.parse(localStorage.getItem('trackmovil_user'));
  console.log('Parsed User:', user);
} catch (e) {
  console.error('Error parseando user:', e);
}
```

### Verificar formato correcto

```javascript
const savedUser = localStorage.getItem('trackmovil_user');

// Debe empezar con '{'
console.log('Starts with {:', savedUser?.startsWith('{'));

// Debe ser JSON válido
try {
  JSON.parse(savedUser);
  console.log('✅ JSON válido');
} catch {
  console.log('❌ JSON inválido');
}
```

## 🚀 Pasos para Resolver el Error Actual

1. **Abrir consola (F12)**

2. **Ejecutar**:
```javascript
localStorage.removeItem('trackmovil_user');
localStorage.removeItem('trackmovil_token');
```

3. **Recargar página**: `F5` o `Ctrl+R`

4. **Intentar login nuevamente** con credenciales correctas:
   - Usuario: `jgomez`
   - Password: `VeintiunoDeOctubre!`

5. **Verificar que funcione**:
```javascript
console.log('User:', localStorage.getItem('trackmovil_user'));
// Debe mostrar: {"id":"5","username":"JGOMEZ",...}
```

## 📝 Notas

- El error `JSON.parse: unexpected character at line 1 column 1` indica que el string no es JSON válido
- Común cuando se guarda algo como `"undefined"`, `"null"`, o texto plano
- La validación ahora previene este problema automáticamente
- Si el problema persiste, revisar qué se está guardando exactamente antes del `JSON.parse`

## ✅ Cambios Implementados

```
✅ Validación de formato JSON antes de parsear
✅ Validación de estructura (username e id requeridos)
✅ Auto-limpieza de datos corruptos
✅ No guardar usuario si no viene en la respuesta
✅ Mensaje claro: "Usuario o contraseña incorrectos"
✅ Logs de debugging en consola
```

---

**¡El sistema ahora es más robusto!** 🎉
