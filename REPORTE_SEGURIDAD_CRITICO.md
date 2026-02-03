# 🚨 REPORTE DE SEGURIDAD - VULNERABILIDADES CRÍTICAS DETECTADAS

**Fecha:** 2 de febrero de 2026  
**Aplicación:** TrackMovil  
**Severidad:** CRÍTICA - Requiere acción inmediata

---

## 📋 RESUMEN EJECUTIVO

Se han identificado **VULNERABILIDADES CRÍTICAS** en tu aplicación que permiten:
- ✅ Acceso sin autenticación a TODAS las rutas API
- ✅ Manipulación de datos sin validación
- ✅ Exposición de documentación pública
- ✅ CORS completamente abierto (`Access-Control-Allow-Origin: *`)
- ✅ Path traversal potencial en rutas dinámicas

**El ataque que describiste (intentos de minería, comandos rm) es típico de bots que escanean aplicaciones web buscando estas vulnerabilidades.**

---

## 🔴 VULNERABILIDADES CRÍTICAS (ACCIÓN INMEDIATA)

### 1. **AUSENCIA TOTAL DE AUTENTICACIÓN EN APIs** ⚠️ CRÍTICO

**Ubicación:** Todas las rutas en `app/api/**/*.ts`

**Problema:**
```typescript
// ❌ TODAS tus APIs están así:
export async function GET(request: NextRequest) {
  // SIN VALIDACIÓN DE TOKEN
  // SIN VERIFICACIÓN DE USUARIO
  // ACCESO DIRECTO A BASE DE DATOS
  const { data } = await supabase.from('pedidos').select('*');
  return NextResponse.json(data);
}
```

**APIs afectadas:**
- `/api/pedidos` - Lectura total de pedidos
- `/api/empresas` - Lectura de empresas
- `/api/coordinates` - GPS tracking
- `/api/moviles-extended` - Datos de móviles
- `/api/import/*` - **Inserción/modificación/eliminación SIN AUTENTICACIÓN**
- `/api/puntos-interes` - POST/PUT/DELETE sin validación
- `/api/proxy/[...path]` - Proxy abierto a tu backend

**Riesgo:**
- ✅ **Cualquiera puede leer todos los datos**
- ✅ **Cualquiera puede insertar/modificar/eliminar registros**
- ✅ **Exposición de datos sensibles (GPS, pedidos, empresas)**

---

### 2. **PROXY ABIERTO CON SSL DESHABILITADO** ⚠️ CRÍTICO

**Ubicación:** `app/api/proxy/[...path]/route.ts`

```typescript
// ❌ PELIGRO: Proxy catch-all sin autenticación
const httpsAgent = new https.Agent({
  rejectUnauthorized: false  // ⚠️ Acepta certificados inválidos
});

// ❌ Cualquiera puede hacer peticiones a través de tu servidor
export async function GET(request, { params }) {
  const { path } = await params;
  // path puede ser CUALQUIER COSA
  const url = `${API_BASE_URL}/${path}`;
  return fetch(url, { agent: httpsAgent });
}
```

**Riesgo:**
- ✅ **Open Proxy** - Tu servidor puede usarse para atacar otros sistemas
- ✅ **SSRF (Server-Side Request Forgery)** - Acceso a redes internas
- ✅ **Man-in-the-middle** por certificados inválidos aceptados

---

### 3. **RUTAS DE IMPORTACIÓN SIN VALIDACIÓN** ⚠️ CRÍTICO

**Ubicación:** `app/api/import/**/*.ts`

```typescript
// ❌ POST /api/import/moviles - SIN AUTENTICACIÓN
export async function POST(request: NextRequest) {
  const body = await request.json(); // ⚠️ Sin validación
  const movilesArray = Array.isArray(moviles) ? moviles : [moviles];
  
  // ❌ UPSERT directo sin validación de datos
  const { data } = await supabase
    .from('moviles')
    .upsert(transformedMoviles);  // ⚠️ Permite sobrescribir datos
}
```

**APIs afectadas:**
- `/api/import/moviles` - POST/PUT/DELETE
- `/api/import/gps` - POST/DELETE
- `/api/import/pedidos` - POST/PUT/DELETE
- `/api/import/puntoventa` - POST/PUT/DELETE
- `/api/import/zonas` - POST/PUT/DELETE
- `/api/import/demoras` - POST/PUT/DELETE

**Riesgo:**
- ✅ **Inyección masiva de datos falsos**
- ✅ **Eliminación de registros existentes**
- ✅ **Manipulación de ubicaciones GPS**
- ✅ **Modificación de pedidos y estado de móviles**

---

### 4. **DOCUMENTACIÓN PÚBLICA EXPUESTA** ⚠️ MEDIO

**Ubicación:** `app/api/doc/route.ts`

```typescript
// ❌ Ruta pública que expone toda la documentación de tu API
export async function GET() {
  const docPath = path.join(process.cwd(), 'API_DOCUMENTATION.md');
  const markdown = fs.readFileSync(docPath, 'utf-8');
  // Retorna HTML con toda la documentación
}
```

**Riesgo:**
- ✅ **Reconocimiento** - Los atacantes conocen todos tus endpoints
- ✅ **Exposición de estructura** - Facilita ataques dirigidos

---

### 5. **CORS COMPLETAMENTE ABIERTO** ⚠️ ALTO

**Ubicación:** `middleware.ts`

```typescript
// ❌ Permite peticiones desde CUALQUIER origen
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',  // ⚠️ Wildcard
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, PATCH',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Credentials': 'true',  // ⚠️ Con credentials!
};
```

**Riesgo:**
- ✅ **CSRF (Cross-Site Request Forgery)**
- ✅ **Acceso desde dominios maliciosos**
- ✅ **Robo de datos mediante JavaScript externo**

---

### 6. **PATH TRAVERSAL EN RUTA DE DOCUMENTACIÓN** ⚠️ MEDIO

**Ubicación:** `app/api/doc/route.ts`

```typescript
// ❌ Potencial path traversal
const docPath = path.join(process.cwd(), 'API_DOCUMENTATION.md');
fs.readFileSync(docPath, 'utf-8');
```

**Aunque no acepta parámetros externos directamente, es una práctica insegura.**

---

### 7. **VALIDACIÓN DE ENTRADA INSUFICIENTE** ⚠️ ALTO

**Problema generalizado:** No hay validación de tipos, rangos ni sanitización de datos.

```typescript
// ❌ Sin validación de tipos
const movilId = searchParams.get('movilId');  // Puede ser cualquier string
const query = supabase.from('gps_tracking').eq('movil_id', parseInt(movilId));
// Si movilId no es número, parseInt retorna NaN

// ❌ Sin validación de rangos
const limit = searchParams.get('limit');  // Podría ser 999999999
.limit(limit ? parseInt(limit) : 100);  // DoS por queries masivas

// ❌ Sin sanitización de SQL
const escenario = searchParams.get('escenario');
query = query.eq('escenario', parseInt(escenario));
```

**Riesgo:**
- ✅ **SQL Injection** (aunque Supabase ayuda, no es garantía)
- ✅ **DoS** por queries sin límite
- ✅ **Crash de aplicación** por datos malformados

---

### 8. **LOGS DETALLADOS EN PRODUCCIÓN** ⚠️ BAJO

**Ubicación:** Múltiples archivos

```typescript
console.log(`📥 Response Data:`, JSON.stringify(data, null, 2));
console.log('📦 Body:', body);
console.log('🔑 Authorization:', authHeader);
```

**Riesgo:**
- ✅ **Exposición de datos sensibles** en logs
- ✅ **Información para atacantes** si acceden a logs

---

## 🛡️ SOLUCIONES PRIORITARIAS

### FASE 1: AUTENTICACIÓN (URGENTE - Implementar HOY)

#### 1.1. Crear Middleware de Autenticación

```typescript
// lib/auth-middleware.ts
import { NextRequest, NextResponse } from 'next/server';
import { createMiddlewareClient } from '@supabase/auth-helpers-nextjs';

export async function requireAuth(request: NextRequest) {
  const res = NextResponse.next();
  const supabase = createMiddlewareClient({ req: request, res });
  
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    return NextResponse.json(
      { error: 'No autorizado', message: 'Token inválido o expirado' },
      { status: 401 }
    );
  }

  return { session, supabase };
}

// Validación adicional de API Key para endpoints de importación
export function requireApiKey(request: NextRequest) {
  const apiKey = request.headers.get('x-api-key');
  const validApiKey = process.env.INTERNAL_API_KEY;

  if (!apiKey || apiKey !== validApiKey) {
    return NextResponse.json(
      { error: 'API Key inválida o faltante' },
      { status: 403 }
    );
  }

  return true;
}
```

#### 1.2. Proteger TODAS las rutas API

```typescript
// app/api/pedidos/route.ts
import { requireAuth } from '@/lib/auth-middleware';

export async function GET(request: NextRequest) {
  // ✅ VALIDAR AUTENTICACIÓN
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;
  
  const { session, supabase } = authResult;
  
  // Resto del código...
}
```

#### 1.3. Proteger rutas de importación con API Key

```typescript
// app/api/import/moviles/route.ts
import { requireApiKey } from '@/lib/auth-middleware';

export async function POST(request: NextRequest) {
  // ✅ VALIDAR API KEY
  const keyValidation = requireApiKey(request);
  if (keyValidation instanceof NextResponse) return keyValidation;
  
  // Resto del código...
}
```

---

### FASE 2: VALIDACIÓN DE ENTRADA (URGENTE)

#### 2.1. Crear utilidad de validación

```typescript
// lib/validation.ts
import { z } from 'zod';

export const movilIdSchema = z.string().regex(/^\d+$/).transform(Number);
export const limitSchema = z.string().regex(/^\d+$/).transform(Number).refine(n => n <= 1000);
export const escenarioSchema = z.string().regex(/^\d+$/).transform(Number);

export function validateInput<T>(schema: z.ZodSchema<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new Error(`Validación fallida: ${result.error.message}`);
  }
  return result.data;
}
```

#### 2.2. Aplicar validación

```typescript
// app/api/coordinates/route.ts
import { validateInput, movilIdSchema, limitSchema } from '@/lib/validation';

export async function GET(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  const searchParams = request.nextUrl.searchParams;
  
  // ✅ VALIDAR INPUTS
  try {
    const movilId = validateInput(movilIdSchema, searchParams.get('movilId'));
    const limit = validateInput(limitSchema, searchParams.get('limit') || '100');
    
    // Resto del código...
  } catch (error) {
    return NextResponse.json(
      { error: 'Parámetros inválidos', details: error.message },
      { status: 400 }
    );
  }
}
```

---

### FASE 3: SEGURIDAD DEL PROXY (URGENTE)

#### 3.1. Proteger y restringir proxy

```typescript
// app/api/proxy/[...path]/route.ts
import { requireAuth } from '@/lib/auth-middleware';

// ✅ Lista blanca de paths permitidos
const ALLOWED_PATHS = [
  'gestion/login',
  'gestion/moviles',
  'gestion/pedidos'
];

async function proxyRequest(request: NextRequest, pathSegments: string[], method: string) {
  // ✅ AUTENTICACIÓN
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;
  
  const path = pathSegments.join('/');
  
  // ✅ VALIDAR PATH CONTRA LISTA BLANCA
  if (!ALLOWED_PATHS.some(allowed => path.startsWith(allowed))) {
    return NextResponse.json(
      { error: 'Ruta no permitida' },
      { status: 403 }
    );
  }
  
  // ✅ MANTENER SSL VALIDATION EN PRODUCCIÓN
  const httpsAgent = process.env.NODE_ENV === 'production' 
    ? undefined  // ✅ Validar certificados en producción
    : new https.Agent({ rejectUnauthorized: false });  // Solo desarrollo
  
  // Resto del código...
}
```

---

### FASE 4: CORS RESTRICTIVO (URGENTE)

```typescript
// middleware.ts
export function middleware(request: NextRequest) {
  // ✅ Lista blanca de orígenes permitidos
  const allowedOrigins = [
    'https://tu-dominio.com',
    'https://app.tu-dominio.com',
    process.env.NODE_ENV === 'development' ? 'http://localhost:3000' : ''
  ].filter(Boolean);

  const origin = request.headers.get('origin');
  const isAllowed = allowedOrigins.includes(origin || '');

  const corsHeaders = {
    'Access-Control-Allow-Origin': isAllowed ? origin! : allowedOrigins[0],
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '3600',
    // ⚠️ NUNCA usar credentials: true con origin: *
    ...(isAllowed && { 'Access-Control-Allow-Credentials': 'true' })
  };

  // Resto del código...
}
```

---

### FASE 5: PROTEGER DOCUMENTACIÓN

```typescript
// app/api/doc/route.ts
import { requireAuth } from '@/lib/auth-middleware';

export async function GET(request: NextRequest) {
  // ✅ REQUERIR AUTENTICACIÓN ADMIN
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;
  
  const { session } = authResult;
  
  // ✅ Verificar rol de admin
  if (session.user.role !== 'admin') {
    return NextResponse.json(
      { error: 'Acceso denegado - Solo administradores' },
      { status: 403 }
    );
  }
  
  // Resto del código...
}
```

---

### FASE 6: RATE LIMITING

```typescript
// lib/rate-limit.ts
import { NextRequest, NextResponse } from 'next/server';

const rateLimit = new Map<string, { count: number; resetTime: number }>();

export function checkRateLimit(request: NextRequest, maxRequests = 100, windowMs = 60000) {
  const ip = request.headers.get('x-forwarded-for') || 'unknown';
  const now = Date.now();
  
  const record = rateLimit.get(ip);
  
  if (!record || now > record.resetTime) {
    rateLimit.set(ip, { count: 1, resetTime: now + windowMs });
    return true;
  }
  
  if (record.count >= maxRequests) {
    return NextResponse.json(
      { error: 'Demasiadas peticiones, intenta más tarde' },
      { status: 429 }
    );
  }
  
  record.count++;
  return true;
}
```

---

## 📝 VARIABLES DE ENTORNO REQUERIDAS

Añade a `.env.production`:

```bash
# API Keys
INTERNAL_API_KEY=tu_api_key_secreta_generada_aleatoria_min_32_caracteres

# Supabase Auth
NEXT_PUBLIC_SUPABASE_URL=tu_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=tu_key
SUPABASE_SERVICE_ROLE_KEY=tu_service_role_key

# CORS
ALLOWED_ORIGINS=https://tu-dominio.com,https://app.tu-dominio.com

# Proxy Backend
API_BASE_URL=https://tu-backend.com/api
NODE_TLS_REJECT_UNAUTHORIZED=1  # ✅ ACTIVAR en producción
```

---

## 🔒 CHECKLIST DE IMPLEMENTACIÓN

### Prioridad CRÍTICA (Implementar AHORA):
- [ ] ✅ Implementar autenticación en todas las rutas API
- [ ] ✅ Proteger rutas de importación con API Key
- [ ] ✅ Validar todos los inputs de usuario
- [ ] ✅ Restringir proxy con lista blanca
- [ ] ✅ Configurar CORS restrictivo
- [ ] ✅ Habilitar validación SSL en producción

### Prioridad ALTA (Próximas 48 horas):
- [ ] ✅ Implementar rate limiting
- [ ] ✅ Proteger ruta de documentación
- [ ] ✅ Sanitizar logs en producción
- [ ] ✅ Añadir logging de intentos de acceso no autorizado

### Prioridad MEDIA (Próxima semana):
- [ ] ✅ Implementar CSP (Content Security Policy)
- [ ] ✅ Añadir headers de seguridad (HSTS, X-Frame-Options, etc.)
- [ ] ✅ Auditoría completa de dependencias
- [ ] ✅ Implementar monitoreo de seguridad

---

## 🚨 ACCIONES INMEDIATAS

**1. Revisar logs actuales:**
```bash
# Buscar intentos de ataque
grep -i "minería\|mining\|rm -rf\|attlasian" logs/*.log

# Ver IPs sospechosas
grep "401\|403\|404" logs/*.log | awk '{print $1}' | sort | uniq -c | sort -rn
```

**2. Bloquear IPs maliciosas (temporal):**
Añade a tu firewall o nginx:
```bash
# Si usas nginx
deny 123.45.67.89;  # IP del atacante
```

**3. Desplegar correcciones:**
```bash
# 1. Implementa autenticación básica AHORA
# 2. Despliega a producción
# 3. Monitorea logs
```

---

## 📊 EVALUACIÓN DE RIESGO

| Vulnerabilidad | Severidad | Explotación | Impacto | Prioridad |
|----------------|-----------|-------------|---------|-----------|
| APIs sin autenticación | CRÍTICO | Trivial | Crítico | P0 |
| Proxy abierto | CRÍTICO | Fácil | Alto | P0 |
| Rutas import sin validación | CRÍTICO | Trivial | Crítico | P0 |
| CORS abierto | ALTO | Fácil | Alto | P1 |
| Sin validación de entrada | ALTO | Medio | Alto | P1 |
| Documentación pública | MEDIO | Trivial | Medio | P2 |
| Logs detallados | BAJO | Difícil | Bajo | P3 |

---

## 🎯 CONCLUSIÓN

Tu aplicación está **COMPLETAMENTE EXPUESTA**. Los atacantes pueden:
- ✅ Leer todos los datos sin autenticación
- ✅ Insertar/modificar/eliminar registros
- ✅ Usar tu servidor como proxy para ataques
- ✅ Ejecutar código remoto (potencialmente)

**El ataque que viste (archivos de minería, comandos rm) es típico de bots automatizados que buscan aplicaciones vulnerables. Probablemente intentaron:**
1. Subir un script de minería de criptomonedas
2. Ejecutar comandos para instalar herramientas
3. Usar tu servidor como parte de una botnet

**ACCIÓN REQUERIDA:** Implementa INMEDIATAMENTE las correcciones de FASE 1, 2 y 3.

---

## 📞 SOPORTE

Si necesitas ayuda para implementar estas correcciones, házmelo saber. Puedo ayudarte a:
1. Generar los archivos de autenticación completos
2. Modificar todas las rutas API
3. Configurar el middleware de seguridad
4. Implementar monitoreo de seguridad

**¡NO ESPERES! Cada minuto que tu aplicación esté expuesta es un riesgo.**
