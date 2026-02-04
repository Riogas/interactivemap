# 🚀 FIX: Bypass Rate Limit para GPS Tracking

## 🎯 Problema

El endpoint `/api/import/gps` estaba siendo bloqueado por rate limiting después de 20 peticiones por minuto, causando que los móviles en la calle no pudieran reportar sus coordenadas GPS.

**Logs del problema:**
```
3|track  | 2026-02-04 13:09:03 +00:00: ⚠️  Rate limit excedido: 192.168.7.1 (tipo: import, intentos: 20)
3|track  | 2026-02-04 13:09:03 +00:00:    ⚠️ Rate limit excedido!
3|track  | 2026-02-04 13:09:03 +00:00: ⚠️ Rate limit excedido para: /api/import/gps
```

## 🔍 Causa Raíz

El middleware de rate limiting (`lib/rate-limit.ts`) aplicaba el límite de **"import"** (20 req/min) a todos los endpoints que comienzan con `/api/import/`, incluyendo `/api/import/gps`.

```typescript
// ANTES - aplicaba rate limit a TODOS los /api/import/*
if (pathname.startsWith('/api/import/')) {
  type = 'import'; // ← 20 req/min
}
```

Este límite es apropiado para endpoints de importación manual (móviles, pedidos, empresas), pero **NO** para GPS tracking que recibe cientos de peticiones por minuto de múltiples móviles en la calle.

## ✅ Solución Implementada

### 1. **Bypass Específico para GPS**

Agregamos una excepción ANTES de la detección de tipo para que `/api/import/gps` no tenga rate limit:

```typescript
// 🚀 BYPASS para GPS tracking - sin rate limit (muchos móviles reportando)
if (pathname === '/api/import/gps') {
  console.log(`   - 🚀 GPS Tracking endpoint - SIN RATE LIMIT`);
  return true;
}

// Determinar tipo basándose en la ruta
let type: keyof typeof RATE_LIMIT_CONFIGS = 'default';

if (pathname.startsWith('/api/import/')) {
  type = 'import'; // ← Otros imports siguen con 20 req/min
  console.log(`   - Tipo detectado: IMPORT`);
}
```

### 2. **Justificación del Bypass**

| Endpoint | Rate Limit | Justificación |
|----------|-----------|---------------|
| `/api/import/moviles` | 20 req/min | Importación manual, pocos usuarios |
| `/api/import/pedidos` | 20 req/min | Importación manual, pocos usuarios |
| `/api/import/empresas` | 20 req/min | Importación manual, pocos usuarios |
| `/api/import/gps` | **ILIMITADO** ✅ | Cientos de móviles reportando 24/7 |

**Razones para bypass:**
- **Volumen alto**: Decenas de móviles reportando cada 10-30 segundos
- **Crítico**: GPS tracking es funcionalidad core del sistema
- **Autenticación propia**: Ya tiene validación de token (`GPS_TRACKING_TOKEN`)
- **No abusable**: Requiere token válido para funcionar

## 🔒 Seguridad Mantenida

El endpoint GPS sigue protegido con:

1. **Autenticación por Token**:
   ```typescript
   const hasValidToken = token && token === process.env.GPS_TRACKING_TOKEN;
   if (!hasValidToken) {
     return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
   }
   ```

2. **Validación de API Key** (opcional):
   ```typescript
   const hasApiKey = request.headers.get('X-API-Key') === process.env.INTERNAL_API_KEY;
   ```

3. **Detección de Actividad Sospechosa**:
   - Path traversal
   - SQL injection
   - XSS attempts
   - Escaneo de vulnerabilidades

## 📊 Comparación Antes/Después

### Antes (Con Rate Limit)
```
Móvil 1 reporta GPS → OK (1/20)
Móvil 2 reporta GPS → OK (2/20)
...
Móvil 20 reporta GPS → OK (20/20)
Móvil 21 reporta GPS → ❌ 429 Rate Limit Exceeded
↓
Móviles quedan sin reportar por 1 minuto
```

### Después (Sin Rate Limit)
```
Móvil 1 reporta GPS → ✅ OK
Móvil 2 reporta GPS → ✅ OK
...
Móvil 100 reporta GPS → ✅ OK
Móvil 101 reporta GPS → ✅ OK
↓
Todos los móviles reportan sin problemas 🚀
```

## 🎯 Logs Mejorados

```bash
🚦 autoRateLimit:
   - Pathname: /api/import/gps
   - 🚀 GPS Tracking endpoint - SIN RATE LIMIT
```

Versus otros imports:
```bash
🚦 autoRateLimit:
   - Pathname: /api/import/moviles
   - Tipo detectado: IMPORT
   - Config: 20 req / 60000ms
```

## 🔄 Rate Limits Actuales

| Tipo | Endpoint Pattern | Límite | Ventana | Bloqueo |
|------|-----------------|---------|---------|---------|
| **auth** | `/login`, `/auth` | 5 req | 5 min | 15 min |
| **import** | `/api/import/*` (excepto GPS) | 20 req | 1 min | - |
| **proxy** | `/api/proxy/*` | 50 req | 1 min | - |
| **public** | `/api/*` | 100 req | 1 min | - |
| **default** | Otros | 60 req | 1 min | - |
| **gps** 🚀 | `/api/import/gps` | **ILIMITADO** | - | - |

## 🧪 Testing

### Test Manual
```bash
# Enviar 100 peticiones de GPS rápidamente
for i in {1..100}; do
  curl -X POST https://track.glp.riogas.com.uy/api/import/gps \
    -H "Content-Type: application/json" \
    -d '{"token":"IcA.FwL.1710.!","gps":{"movil":693,"latitud":-34.5,"longitud":-56.1}}'
  echo "Request $i"
done
```

**Resultado esperado**: Todas las peticiones deben responder 200 OK.

### Verificar Otros Imports Siguen Protegidos
```bash
# Intentar 25 importaciones de móviles (debe fallar después de 20)
for i in {1..25}; do
  curl -X POST https://track.glp.riogas.com.uy/api/import/moviles \
    -H "X-API-Key: 96c596ab..." \
    -H "Content-Type: application/json" \
    -d '{"moviles":[{"Nro":1}]}'
  echo "Request $i"
done
```

**Resultado esperado**: 
- Request 1-20: 200 OK ✅
- Request 21-25: 429 Rate Limit Exceeded ✅

## 🔧 Archivo Modificado

- `lib/rate-limit.ts`
  - Función `autoRateLimit()` modificada
  - Agregado bypass para `/api/import/gps`
  - Otros endpoints mantienen rate limits

## ✅ Beneficios

1. **GPS Ilimitado**: Móviles pueden reportar sin restricciones
2. **Seguridad Mantenida**: Token y API key siguen protegiendo el endpoint
3. **Otros Imports Protegidos**: Rate limits se mantienen para importaciones manuales
4. **Performance**: No hay overhead de rate limiting en el endpoint más usado
5. **Escalabilidad**: Sistema puede soportar cientos de móviles simultáneos

## 📚 Documentos Relacionados

- `RATE_LIMIT_SETUP.md` - Configuración general de rate limiting
- `AUTO_IMPORT_MOVILES_GPS.md` - Funcionamiento del endpoint GPS
- `API_TESTING_GUIDE.md` - Cómo testear endpoints
- `DEBUGGING_LOGS_GUIDE.md` - Logs del sistema

## 🚀 Próximos Pasos

1. ✅ Commit y push de cambios
2. ✅ Deploy a producción
3. ✅ Monitorear logs para verificar que no hay más errores 429
4. ⚠️ **OPCIONAL**: Si en el futuro hay abuso, implementar rate limit más alto (ej: 1000 req/min) en lugar de ilimitado

---

**Fecha**: 2025-02-04  
**Autor**: Sistema de Rate Limiting  
**Estado**: ✅ Implementado y listo para deploy
**Impacto**: ⚠️ **CRÍTICO** - Desbloquea GPS tracking de toda la flota
