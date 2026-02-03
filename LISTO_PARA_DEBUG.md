# ✅ Logs Exhaustivos Implementados - Listo para Debug

**Fecha:** Febrero 3, 2026  
**Estado:** 🟢 Servidor corriendo en http://localhost:3001  
**Objetivo:** Identificar por qué login devuelve 500 después de proteger rutas

---

## 🎯 ¿Qué se implementó?

### Sistema de Logging en 3 Capas

#### 🌐 Capa 1: Middleware Global (`proxy.ts`)
```typescript
🌐 ╔══════════════════════════════════════════════════════════════════╗
🌐 ║ PROXY/MIDDLEWARE - Request Received
🌐 ╚══════════════════════════════════════════════════════════════════╝
```

**Logs en cada request:**
- ✅ Timestamp, Method, Pathname, Search
- ✅ Origin, Referer, User-Agent
- ✅ Verificación de actividad sospechosa
- ✅ Verificación de rate limits
- ✅ Configuración de CORS (allowed origins)
- ✅ Headers de seguridad

#### 🚦 Capa 2: Rate Limiting (`lib/rate-limit.ts`)
```typescript
🚦 autoRateLimit:
   - Pathname: /api/proxy/gestion/login
   - Tipo detectado: PROXY
   - Config: 50 req / 60000ms
```

**Logs en funciones de seguridad:**
- ✅ `detectSuspiciousActivity()`: IP, pathname, user-agent, patrones
- ✅ `autoRateLimit()`: Tipo detectado, config aplicada
- ✅ `checkRateLimit()`: IP, record count, resetTime, blockedUntil

#### 🔄 Capa 3: Proxy Handler (`app/api/proxy/[...path]/route.ts`)
```typescript
════════════════════════════════════════════════════════════════════
🚀 PROXY REQUEST INICIADO
════════════════════════════════════════════════════════════════════
```

**Logs en TODAS las fases:**

**📍 Fase 1: Inicio**
- Timestamp, Method, Path Segments, Full URL

**🔐 Fase 2: Autenticación**
- Is Login Path? (true/false)
- Skip auth si es login
- Resultado de requireAuth() si no es login

**🔍 Fase 3: Whitelist**
- Validación contra ALLOWED_PATHS
- ✅ Ruta permitida / 🚫 Ruta bloqueada

**🌐 Fase 4: Construcción**
- Base URL, Query String, Full URL
- Authorization header

**📦 Fase 5: Body (POST/PUT/PATCH)**
- Body parseado: type, keys, values
- Body stringified: length y contenido completo
- **Errores de parsing con detalles**

**📤 Fase 6: Envío**
- Method, URL, Headers, Body completo

**📥 Fase 7: Respuesta**
- Status (✅ AQUÍ VEREMOS EL 500)
- Todos los headers
- Response data parseado

**📤 Fase 8: Retorno**
- Status, Headers, Data final

**❌ Fase 9: Errores**
- Error type, message, stack trace

---

## 🚀 Cómo Usar Este Sistema

### Paso 1: Verificar que el servidor esté corriendo
```
✅ Servidor ya está corriendo en http://localhost:3001
```

### Paso 2: Intentar Login desde el Navegador
1. Abrir http://localhost:3001/login
2. Ingresar credenciales (cualquiera para probar)
3. Click en "Login" o enviar form

### Paso 3: Observar Logs en la Terminal
Los logs aparecerán INMEDIATAMENTE después de enviar el form.

**Buscar específicamente:**

#### ¿El body tiene datos?
```typescript
📦 Body parseado exitosamente:
   - Type: object
   - Keys: [Usuario, Contrasenia]  ← ✅ CORRECTO
   - Values: { Usuario: 'admin', Contrasenia: 'pass123' }
```

**Si muestra:**
- `Keys: []` → ❌ Body vacío
- `Keys: [username, password]` → ❌ Nombres incorrectos
- `Error parseando body` → ❌ No es JSON

#### ¿Se está saltando la autenticación?
```typescript
🔐 Is Login Path: true  ← ✅ CORRECTO
⚠️ SALTANDO autenticación (es login path)
```

**Si muestra:**
- `Is Login Path: false` → ❌ PROBLEMA
- `Requiriendo autenticación` → ❌ PROBLEMA

#### ¿Hay bloqueo de rate limit?
```typescript
🚦 checkRateLimit:
   - Record count: 0  ← ✅ CORRECTO (primer intento)
```

**Si muestra:**
- `Record count: 6` → ⚠️ Múltiples intentos
- `IP bloqueada` → ❌ Bloqueado

#### ¿Qué responde el backend?
```typescript
📥 Response Status: 500 Internal Server Error  ← ❌ AQUÍ ESTÁ
📥 Response Data: {
  "error": {
    "code": 500,
    "message": "Internal Server Error"
  }
}
```

---

## 🔍 Escenarios Posibles

### Escenario A: Body Vacío o Malformado
**Logs mostrarían:**
```
📦 Error parseando body: SyntaxError: Unexpected end of JSON input
   - Content-Type: application/json
   - Body as text (0 chars): 
```

**Solución:** Revisar componente de login en frontend

---

### Escenario B: Nombres de Campos Incorrectos
**Logs mostrarían:**
```
📦 Body Keys: [username, password]  ← Debería ser Usuario, Contrasenia
```

**Solución:** Cambiar nombres en frontend o backend

---

### Escenario C: Autenticación Prematura
**Logs mostrarían:**
```
🔐 Is Login Path: false  ← PROBLEMA
🔐 Requiriendo autenticación...
❌ Autenticación falló - retornando respuesta de auth
```

**Solución:** Verificar detección de path en proxy handler

---

### Escenario D: Rate Limit Bloqueado
**Logs mostrarían:**
```
🚦 checkRateLimit:
   - Record count: 6
   - Record blockedUntil: 2026-02-03T18:20:00.000Z
🚫 IP bloqueada: ::1 (300s restantes)
```

**Solución:** Esperar o limpiar rate limit

---

### Escenario E: Backend con Error Real
**Logs mostrarían:**
```
📦 Body parseado exitosamente:
   - Keys: [Usuario, Contrasenia]  ✅
   - Values: { Usuario: 'admin', Contrasenia: 'pass123' }  ✅
🔐 Is Login Path: true  ✅
⚠️ SALTANDO autenticación  ✅
✅ Ruta permitida  ✅
📤 Body (49 chars): {"Usuario":"admin","Contrasenia":"pass123"}  ✅
📥 Response Status: 500  ❌ PROBLEMA EN BACKEND
```

**Solución:** Problema está en el backend de GeneXus, no en nuestro código

---

## 🛠️ Comandos Útiles

### Ver qué componente hace el login
```powershell
Get-ChildItem -Path . -Recurse -Filter "*login*" -Include "*.tsx","*.ts","*.jsx","*.js" | Select-Object FullName
```

### Test directo al backend (bypass proxy)
```powershell
curl -X POST https://sgm.glp.riogas.com.uy/gestion/login `
  -H "Content-Type: application/json" `
  -d '{"Usuario":"test","Contrasenia":"test"}' `
  -k -v
```

### Limpiar rate limit (si está bloqueado)
```typescript
// En la consola del servidor:
// Agregar temporalmente al código:
import { clearRateLimitStore } from './lib/rate-limit';
clearRateLimitStore();
```

### Reiniciar servidor con logs frescos
```powershell
# Ctrl+C para detener
Remove-Item -Path ".next" -Recurse -Force
pnpm dev -- --webpack
```

---

## 📊 Qué Hacer Ahora

### ✅ Paso Inmediato:

**1. Mantener la terminal visible**
   - No cerrar la ventana de PowerShell/Terminal
   - Los logs aparecerán aquí

**2. Abrir navegador y hacer login**
   - http://localhost:3001/login
   - Ingresar cualquier usuario/contraseña
   - Enviar

**3. Leer los logs EN ORDEN**
   - Comenzar desde arriba:
     ```
     🌐 ╔═══════════════════════════════════════╗
     🌐 ║ PROXY/MIDDLEWARE - Request Received
     ```
   - Seguir hasta el final:
     ```
     📤 RETORNANDO AL CLIENTE
     ════════════════════════════════════════
     ```

**4. Identificar el problema**
   - Buscar ❌ o ⚠️ en los logs
   - Ver qué sección falla primero

**5. Reportar hallazgos**
   - Copiar los logs relevantes
   - Compartir qué sección tiene el problema

---

## 🎯 Objetivo

Con estos logs, sabremos **EXACTAMENTE** dónde está el problema:

- ✅ Si es el frontend (body malformado)
- ✅ Si es nuestro código (autenticación, rate limit)
- ✅ Si es el backend (error 500 legítimo)

**No más adivinanzas. Los logs nos dirán la verdad.** 🔍

---

## 📝 Archivos Modificados

```
C:\Users\jgomez\Documents\Projects\trackmovil\
├── proxy.ts                              ← Logs en middleware
├── lib\rate-limit.ts                     ← Logs en seguridad
├── app\api\proxy\[...path]\route.ts     ← Logs en proxy handler
└── LOGS_EXHAUSTIVOS_DEBUG.md            ← Este documento
```

---

## 🚨 Recordatorio

**Los logs son EXHAUSTIVOS.** Habrá MUCHA información.

**Pero eso es bueno.** Mejor tener más información que menos.

**Scroll hacia arriba** después del login para ver los logs completos desde el inicio.

---

**¿Listo? Haz login ahora y observa los logs.** 🚀
