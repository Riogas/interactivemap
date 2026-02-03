# 🔒 GUÍA DE CONFIGURACIÓN DE SEGURIDAD

## 📋 Resumen

Esta guía te ayudará a configurar todas las medidas de seguridad implementadas en TrackMovil. **Sigue estos pasos en orden**.

---

## ✅ PASO 1: Configurar Variables de Entorno

### 1.1. Crear archivo de producción

```bash
cp .env.example .env.production
```

### 1.2. Generar API Key segura

Ejecuta en terminal:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

O genera una online: https://www.uuidgenerator.net/

### 1.3. Completar `.env.production`

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://tu-proyecto.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=tu_clave_aqui
SUPABASE_SERVICE_ROLE_KEY=tu_clave_service_role

# API Key (la que generaste)
INTERNAL_API_KEY=a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6

# CORS - Dominios permitidos
NEXT_PUBLIC_APP_URL=https://tu-dominio.com
ALLOWED_ORIGIN_1=https://app.tu-dominio.com
ALLOWED_ORIGIN_2=https://genexus.tu-empresa.com

# Backend GeneXus
API_BASE_URL=https://tu-backend.com/api
NODE_TLS_REJECT_UNAUTHORIZED=1

# Next.js
NODE_ENV=production
PORT=3002
HOSTNAME=0.0.0.0
```

---

## ✅ PASO 2: Proteger Rutas de Importación

Agrega esto al **inicio** de cada archivo en `app/api/import/**/route.ts`:

```typescript
import { requireApiKey } from '@/lib/auth-middleware';

export async function POST(request: NextRequest) {
  // ✅ VALIDAR API KEY
  const keyValidation = requireApiKey(request);
  if (keyValidation instanceof NextResponse) return keyValidation;
  
  // ... resto del código
}
```

### Archivos a modificar:
- ✅ `app/api/import/gps/route.ts`
- ✅ `app/api/import/moviles/route.ts`
- ✅ `app/api/import/pedidos/route.ts`
- ✅ `app/api/import/puntoventa/route.ts`
- ✅ `app/api/import/zonas/route.ts`
- ✅ `app/api/import/demoras/route.ts`

---

## ✅ PASO 3: Proteger Rutas de Lectura

Agrega autenticación a las rutas GET:

```typescript
import { requireAuth } from '@/lib/auth-middleware';
import { validateQueryParams, coordinatesQuerySchema } from '@/lib/validation';

export async function GET(request: NextRequest) {
  // ✅ AUTENTICACIÓN
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;
  
  const { session, user } = authResult;
  
  // ✅ VALIDACIÓN DE PARÁMETROS
  const validation = validateQueryParams(request, coordinatesQuerySchema);
  if (!validation.success) return validation.error;
  
  const { movilId, limit } = validation.data;
  
  // ... resto del código
}
```

### Archivos a modificar:
- ✅ `app/api/coordinates/route.ts`
- ✅ `app/api/pedidos/route.ts`
- ✅ `app/api/empresas/route.ts`
- ✅ `app/api/moviles-extended/route.ts`
- ✅ `app/api/latest/route.ts`
- ✅ `app/api/movil/[id]/route.ts`

---

## ✅ PASO 4: Proteger Ruta del Proxy

Modifica `app/api/proxy/[...path]/route.ts`:

```typescript
import { requireAuth } from '@/lib/auth-middleware';

// ✅ Lista blanca de rutas permitidas
const ALLOWED_PATHS = [
  'gestion/login',
  'gestion/moviles',
  'gestion/pedidos',
  'gestion/empresas',
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
  
  // ✅ VALIDAR SSL EN PRODUCCIÓN
  const httpsAgent = process.env.NODE_ENV === 'production' 
    ? undefined
    : new https.Agent({ rejectUnauthorized: false });
  
  // ... resto del código
}
```

---

## ✅ PASO 5: Proteger Ruta de Documentación

Modifica `app/api/doc/route.ts`:

```typescript
import { requireAuth, requireRole } from '@/lib/auth-middleware';

export async function GET(request: NextRequest) {
  // ✅ AUTENTICACIÓN
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;
  
  // ✅ VERIFICAR ROL ADMIN
  const roleCheck = requireRole(authResult.user, 'admin');
  if (roleCheck instanceof NextResponse) return roleCheck;
  
  // ... resto del código
}
```

---

## ✅ PASO 6: Configurar Cliente (GeneXus, etc.)

### 6.1. Para endpoints de importación

Agregar header en cada petición:

```javascript
// GeneXus
&HttpClient.AddHeader("x-api-key", "tu_api_key_aqui")
&HttpClient.Execute('POST', 'https://tu-app.com/api/import/moviles')

// JavaScript
fetch('https://tu-app.com/api/import/moviles', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': 'tu_api_key_aqui'
  },
  body: JSON.stringify({ moviles: [...] })
})
```

### 6.2. Para endpoints autenticados

Usar el token de Supabase:

```javascript
// Después del login
const { data: { session } } = await supabase.auth.signInWithPassword({
  email: 'usuario@example.com',
  password: 'password'
});

// En cada petición
fetch('https://tu-app.com/api/pedidos', {
  headers: {
    'Authorization': `Bearer ${session.access_token}`
  }
})
```

---

## ✅ PASO 7: Desplegar y Probar

### 7.1. Compilar aplicación

```bash
pnpm build
```

### 7.2. Desplegar

```bash
# Con PM2
pm2 stop track
pm2 start pm2.config.js
pm2 save

# Con Docker
docker stop trackmovil && docker rm trackmovil
docker build -t trackmovil:latest .
docker run -d --name trackmovil -p 3001:3000 --env-file .env.production trackmovil:latest
```

### 7.3. Probar endpoints

```bash
# ❌ SIN API Key - debe fallar
curl -X POST https://tu-app.com/api/import/moviles \
  -H "Content-Type: application/json" \
  -d '{"moviles": []}'

# ✅ CON API Key - debe funcionar
curl -X POST https://tu-app.com/api/import/moviles \
  -H "Content-Type: application/json" \
  -H "x-api-key: tu_api_key_aqui" \
  -d '{"moviles": []}'

# ❌ SIN Autenticación - debe fallar
curl https://tu-app.com/api/pedidos

# ✅ CON Token - debe funcionar
curl https://tu-app.com/api/pedidos \
  -H "Authorization: Bearer tu_token_aqui"
```

---

## ✅ PASO 8: Monitorear Logs

### 8.1. Ver logs en tiempo real

```bash
# PM2
pm2 logs track

# Docker
docker logs -f trackmovil
```

### 8.2. Buscar intentos bloqueados

```bash
# Buscar actividad sospechosa
grep "SUSPICIOUS_ACTIVITY" logs/*.log

# Buscar rate limit excedido
grep "RATE_LIMIT" logs/*.log

# Buscar API Key inválidas
grep "API_KEY_INVALID" logs/*.log
```

---

## 📊 VERIFICACIÓN DE SEGURIDAD

Marca estas casillas cuando estén completas:

- [ ] ✅ Variables de entorno configuradas (`.env.production`)
- [ ] ✅ API Key generada y guardada de forma segura
- [ ] ✅ Rutas de importación protegidas con API Key
- [ ] ✅ Rutas de lectura protegidas con autenticación
- [ ] ✅ Proxy protegido con whitelist
- [ ] ✅ CORS configurado con lista blanca de orígenes
- [ ] ✅ Rate limiting activado
- [ ] ✅ Detección de actividad sospechosa activada
- [ ] ✅ Certificados SSL validándose en producción (`NODE_TLS_REJECT_UNAUTHORIZED=1`)
- [ ] ✅ Documentación protegida (solo admins)
- [ ] ✅ Clientes configurados con headers correctos
- [ ] ✅ Aplicación desplegada y funcionando
- [ ] ✅ Pruebas realizadas (con y sin autenticación)
- [ ] ✅ Logs monitoreados

---

## 🚨 SOLUCIÓN DE PROBLEMAS

### Problema: "API Key inválida"

**Causa:** La API Key en el cliente no coincide con `INTERNAL_API_KEY` en el servidor.

**Solución:**
1. Verifica `.env.production` en el servidor
2. Reinicia la aplicación después de cambiar `.env`
3. Asegúrate de usar la misma key en el cliente

### Problema: "No autorizado" en rutas GET

**Causa:** No se envía el token de autenticación o está expirado.

**Solución:**
1. Verifica que el usuario esté logueado
2. Obtén el token: `const { data: { session } } = await supabase.auth.getSession()`
3. Envía header: `Authorization: Bearer ${session.access_token}`

### Problema: "CORS error"

**Causa:** El origen no está en la lista blanca.

**Solución:**
1. Agrega el origen a `.env.production`:
   ```
   ALLOWED_ORIGIN_1=https://tu-nuevo-dominio.com
   ```
2. Reinicia la aplicación

### Problema: "Rate limit exceeded"

**Causa:** Demasiadas peticiones desde la misma IP.

**Solución:**
- Espera el tiempo indicado en el mensaje
- Si es legítimo, aumenta los límites en `lib/rate-limit.ts`

---

## 📚 RECURSOS ADICIONALES

- **Reporte de vulnerabilidades:** Ver `REPORTE_SEGURIDAD_CRITICO.md`
- **Documentación de autenticación:** `lib/auth-middleware.ts`
- **Documentación de validación:** `lib/validation.ts`
- **Documentación de rate limiting:** `lib/rate-limit.ts`

---

## 🔐 MEJORES PRÁCTICAS

1. **NUNCA** commits `.env.production` a Git
2. **Rota las API Keys** cada 3-6 meses
3. **Monitorea los logs** regularmente
4. **Mantén actualizadas** las dependencias de seguridad
5. **Usa HTTPS** siempre en producción
6. **Haz backups** de las configuraciones

---

## ❓ SOPORTE

Si necesitas ayuda adicional:
1. Revisa los logs de la aplicación
2. Consulta `REPORTE_SEGURIDAD_CRITICO.md`
3. Verifica la configuración en `.env.production`
4. Contacta al equipo de desarrollo

---

**¡Tu aplicación está ahora MUCHO más segura! 🎉**
