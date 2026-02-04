# 🔐 Control de Seguridad con Variable de Entorno

## 📋 Descripción

Se ha implementado una variable de entorno `ENABLE_SECURITY_CHECKS` que permite habilitar o deshabilitar **todos los controles de seguridad** de la aplicación con un solo cambio.

## 🎯 Funcionalidad

### Variable de Entorno

```bash
ENABLE_SECURITY_CHECKS=false  # Deshabilita TODOS los checks de seguridad
ENABLE_SECURITY_CHECKS=true   # Habilita TODOS los checks de seguridad (recomendado en producción)
```

**Valor por defecto**: `false` (si no está definida)

### Funciones Afectadas

Cuando `ENABLE_SECURITY_CHECKS=false`, las siguientes funciones hacen bypass:

| Función | Comportamiento Normal | Con Security Disabled |
|---------|----------------------|----------------------|
| `requireAuth()` | Valida sesión de Supabase | ✅ Retorna sesión simulada |
| `requireApiKey()` | Valida X-API-Key header | ✅ Siempre retorna true |
| `requireRole()` | Valida rol del usuario | ✅ Siempre retorna true |

## 🔧 Implementación

### 1. En `lib/auth-middleware.ts`

```typescript
// Variable de control global
const SECURITY_ENABLED = process.env.ENABLE_SECURITY_CHECKS === 'true';

// En cada función de seguridad:
export async function requireAuth(request: NextRequest) {
  // ⚠️ MODO SIN SEGURIDAD: Bypass de autenticación
  if (!SECURITY_ENABLED) {
    console.log('⚠️ SECURITY_CHECKS DISABLED: Saltando requireAuth()');
    return {
      session: { user: { id: 'bypass-mode' } },
      user: { id: 'bypass-mode', email: 'bypass@disabled.local' }
    };
  }
  
  // ... resto del código de validación
}
```

### 2. En `.env.local` (Desarrollo)

```bash
# Security Controls
# Set to 'true' to enable authentication checks
# Set to 'false' to disable all security validations (⚠️ SOLO PARA DESARROLLO)
ENABLE_SECURITY_CHECKS=false
```

### 3. En `.env.production` (Producción)

```bash
# Security Controls
# ⚠️ IMPORTANTE: En producción SIEMPRE debe ser 'true'
ENABLE_SECURITY_CHECKS=true
```

## 🚀 Casos de Uso

### Desarrollo Local
```bash
# .env.local
ENABLE_SECURITY_CHECKS=false
```

**Ventajas:**
- ✅ No necesitas login para probar rutas
- ✅ No necesitas configurar API keys
- ✅ Desarrollo más rápido
- ✅ Pruebas de UI sin backend completo

**Desventajas:**
- ⚠️ No pruebas el flujo de autenticación real
- ⚠️ Puede ocultar problemas de seguridad

### Testing/Staging
```bash
# .env.staging
ENABLE_SECURITY_CHECKS=true
```

**Ventajas:**
- ✅ Pruebas realistas de autenticación
- ✅ Detectar problemas de seguridad antes de producción

### Producción
```bash
# .env.production
ENABLE_SECURITY_CHECKS=true  # ⚠️ OBLIGATORIO
```

**Ventajas:**
- ✅ Seguridad completa habilitada
- ✅ Protección contra accesos no autorizados

## 📊 Logs de Diagnóstico

Cuando la seguridad está **deshabilitada**, verás estos logs:

```
⚠️ SECURITY_CHECKS DISABLED: Saltando requireAuth()
⚠️ SECURITY_CHECKS DISABLED: Saltando requireApiKey()
⚠️ SECURITY_CHECKS DISABLED: Saltando requireRole('admin')
```

Esto te ayuda a identificar rápidamente si estás en modo sin seguridad.

## 🔍 Verificación

### Comprobar Estado Actual

```bash
# En desarrollo local
pnpm dev

# Ver logs de consola
# Si ves "⚠️ SECURITY_CHECKS DISABLED" → Seguridad deshabilitada
# Si NO ves ese mensaje → Seguridad habilitada
```

### Probar con curl

```bash
# Con seguridad DESHABILITADA (debería funcionar sin headers)
curl http://localhost:3000/api/dashboard/pedidos

# Con seguridad HABILITADA (debería dar 401 sin sesión)
curl http://localhost:3000/api/dashboard/pedidos
# Respuesta esperada: {"success":false,"error":"No autenticado"}
```

## ⚠️ Advertencias de Seguridad

### 🚨 NUNCA en Producción sin Seguridad

```bash
# ❌ PELIGROSO en producción
ENABLE_SECURITY_CHECKS=false

# ✅ CORRECTO en producción
ENABLE_SECURITY_CHECKS=true
```

### 🔒 Recomendaciones

1. **Desarrollo Local**: `false` está bien, acelera el desarrollo
2. **Staging/QA**: `true` para probar flujos completos
3. **Producción**: `true` **SIEMPRE**
4. **CI/CD**: Verificar que producción tenga `true`

## 📝 Checklist de Deployment

Antes de hacer deploy a producción:

- [ ] Verificar que `.env.production` tenga `ENABLE_SECURITY_CHECKS=true`
- [ ] Probar login con credenciales reales
- [ ] Verificar que rutas protegidas den 401 sin sesión
- [ ] Probar que API keys funcionen correctamente
- [ ] Revisar logs en producción (no debería aparecer "SECURITY_CHECKS DISABLED")

## 🛠️ Troubleshooting

### Problema: "No puedo acceder a ninguna ruta"

```bash
# Solución temporal: Deshabilitar seguridad
ENABLE_SECURITY_CHECKS=false
pnpm dev
```

### Problema: "Seguridad deshabilitada en producción"

```bash
# En el servidor:
echo "ENABLE_SECURITY_CHECKS=true" >> /var/www/track/.env.production
pm2 restart track
```

### Problema: "No sé si la seguridad está habilitada"

```bash
# Ver logs de PM2
pm2 logs track | grep "SECURITY_CHECKS"

# Si ves "DISABLED" → Está deshabilitada
# Si NO ves nada → Está habilitada
```

## 📚 Archivos Modificados

1. **`lib/auth-middleware.ts`**
   - Agregada constante `SECURITY_ENABLED`
   - Modificadas funciones: `requireAuth()`, `requireApiKey()`, `requireRole()`
   - Agregados logs de diagnóstico

2. **`.env.local`**
   - Agregada variable: `ENABLE_SECURITY_CHECKS=false`
   - Documentación de uso

3. **Esta documentación**
   - Guía completa de uso
   - Casos de uso y advertencias

## 🎓 Ejemplo Práctico

### Escenario 1: Desarrollo Rápido

```bash
# .env.local
ENABLE_SECURITY_CHECKS=false
```

```typescript
// Tu código en app/api/dashboard/route.ts
export async function GET(request: NextRequest) {
  // Este requireAuth se saltará automáticamente
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;
  
  // Aquí siempre llegarás sin problemas
  return NextResponse.json({ data: 'test' });
}
```

**Resultado**: Puedes probar el endpoint sin necesidad de login.

### Escenario 2: Producción Segura

```bash
# .env.production
ENABLE_SECURITY_CHECKS=true
```

Mismo código anterior, pero ahora:
- ✅ Se valida la sesión de Supabase
- ✅ Si no hay sesión → 401 Unauthorized
- ✅ Si hay sesión → Continúa normalmente

---

**Fecha de Implementación**: 2026-02-04  
**Versión**: 1.0.0  
**Autor**: GitHub Copilot + jgomez
