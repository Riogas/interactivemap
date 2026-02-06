# 🚦 Configuración de Rate Limiting - SGM Import

## 📋 Resumen del Cambio

Se modificó el sistema de rate limiting para **permitir importaciones masivas desde IPs internas** (SGM → Track).

---

## 🔧 Cambios Aplicados

### 1. **Whitelist de IPs Internas**

**Archivo:** `lib/rate-limit.ts`

```typescript
const WHITELISTED_IPS = [
  '127.0.0.1',           // Localhost
  '::1',                 // Localhost IPv6
  '192.168.7.13',        // Track server (self)
  '192.168.7.12',        // SGM server (importación masiva)
];
```

**Comportamiento:**
- IPs en whitelist **NO tienen límite** de requests
- Se detectan automáticamente rangos privados (192.168.x.x, 10.x.x.x, 172.16-31.x.x)
- Útil para servidores internos de confianza

---

### 2. **Límites Aumentados para Importación**

```typescript
import: {
  maxRequests: 100,    // Aumentado de 20 → 100
  windowMs: 60000,     // 1 minuto
}
```

**Antes:** 20 requests/minuto (muy bajo para importación masiva)  
**Ahora:** 100 requests/minuto + **bypass para IPs internas**

---

## 📊 Funcionamiento

### Flujo de Rate Limiting

```
Request → Extraer IP → ¿IP en whitelist?
                             ↓
                     YES ↙       ↘ NO
            ✅ BYPASS          Verificar límite
         (sin restricción)            ↓
                               ¿Excede límite?
                                 ↙        ↘
                            YES           NO
                      429 Error      ✅ Permitir
```

### Caso: SGM Importando Datos

```
SGM (192.168.7.12) → POST /api/import/moviles
    ↓
IP detectada: 192.168.7.12
    ↓
¿En whitelist? → SÍ (rango privado 192.168.x.x)
    ↓
✅ BYPASS rate limit
    ↓
Request procesado sin limitación
```

---

## 🔍 Logs de Diagnóstico

### Request Normal (Con Whitelist)

```
🚦 checkRateLimit:
   - IP: 192.168.7.12
   - Type: import
   - Config: 100 req / 60000ms
   ✅ IP en whitelist - BYPASS rate limit
```

### Request Público (Con Límite)

```
🚦 checkRateLimit:
   - IP: 203.45.67.89
   - Type: import
   - Config: 100 req / 60000ms
   - Key: 203.45.67.89:import
   - Record count: 95
   - Remaining: 5 requests
```

### Request Excede Límite

```
⚠️  Rate limit excedido: 203.45.67.89 (tipo: import, intentos: 101)

Response 429:
{
  "success": false,
  "error": "Límite de peticiones excedido",
  "message": "Demasiadas peticiones de importación. Intenta de nuevo en 1 minuto.",
  "code": "RATE_LIMIT_EXCEEDED",
  "retryAfter": 27
}
```

---

## 🔒 Seguridad Mantenida

### IPs Externas (Públicas)
- ❌ **NO en whitelist**
- ✅ Rate limit aplicado (100 req/min)
- ✅ Protección contra brute force

### IPs Internas (Privadas)
- ✅ **En whitelist automática**
- ✅ Sin límite de requests
- ✅ Solo accesibles desde red interna

---

## 🛠️ Agregar Más IPs a la Whitelist

### Opción 1: IP Específica

Editar `lib/rate-limit.ts`:

```typescript
const WHITELISTED_IPS = [
  '127.0.0.1',
  '::1',
  '192.168.7.13',
  '192.168.7.12',
  '192.168.7.50',    // ← Agregar aquí
];
```

### Opción 2: Automática (Rangos Privados)

**Ya incluido:**
- `192.168.x.x` → Whitelist automática
- `10.x.x.x` → Whitelist automática
- `172.16-31.x.x` → Whitelist automática

No necesitas agregar IPs privadas manualmente.

---

## 📋 Casos de Uso

### 1. Importación Masiva desde SGM

**Escenario:**
- SGM ejecuta 500 requests en 1 minuto
- Importa móviles, coordenadas, pedidos

**Sin Whitelist:**
```
Request 1-20: ✅ OK
Request 21+:  ❌ 429 Error (rate limit excedido)
```

**Con Whitelist:**
```
Request 1-500: ✅ OK (bypass completo)
```

---

### 2. Usuario Externo Abusando API

**Escenario:**
- IP pública: 203.45.67.89
- Intenta 200 requests en 1 minuto

**Comportamiento:**
```
Request 1-100: ✅ OK
Request 101+:  ❌ 429 Error (rate limit excedido)
```

**Protección:**
- ✅ Previene abuso
- ✅ Protege recursos del servidor
- ✅ Evita saturación de Supabase

---

## 🧪 Testing

### Test 1: Verificar Whitelist

```bash
# Desde SGM (192.168.7.12)
for i in {1..200}; do
  curl -X POST http://192.168.7.13:3002/api/import/moviles \
    -H "Content-Type: application/json" \
    -H "x-api-key: $API_KEY" \
    -d '{"moviles": [{"id": "'$i'", "descripcion": "Test"}]}'
  echo "Request $i"
done

# Resultado esperado:
# ✅ 200 requests exitosos (sin 429 Error)
```

### Test 2: Verificar Rate Limit Externo

```bash
# Desde IP externa (simular con --interface o proxy)
for i in {1..150}; do
  curl -X POST https://track.riogas.com.uy/api/import/moviles \
    -H "Content-Type: application/json" \
    -H "x-api-key: $API_KEY" \
    -d '{"moviles": [{"id": "'$i'", "descripcion": "Test"}]}'
  echo "Request $i"
done

# Resultado esperado:
# ✅ Request 1-100: 200 OK
# ❌ Request 101+: 429 Rate Limit Exceeded
```

---

## 📊 Monitoreo

### Ver Rate Limit Stats

```bash
# En logs de PM2
pm2 logs track | grep "checkRateLimit"

# Buscar IPs en whitelist
pm2 logs track | grep "IP en whitelist"

# Buscar rate limits excedidos
pm2 logs track | grep "Rate limit excedido"
```

### Métricas Esperadas

**Con 100+ móviles reportando GPS:**
- 100 móviles × 1 coord/seg = 100 coords/seg
- Batching: 100 coords cada 5s = 12 batches/min
- **Desde SGM:** 12 batches/min → **sin rate limit** ✅

**Importación manual desde Postman:**
- IP externa (no whitelist)
- Límite: 100 requests/min
- Si excede: 429 Error

---

## ⚙️ Configuración por Endpoint

| Endpoint | Límite (No Whitelist) | Límite (Whitelist) |
|----------|----------------------|-------------------|
| `/api/import/gps` | 100 req/min | ♾️ Sin límite |
| `/api/import/moviles` | 100 req/min | ♾️ Sin límite |
| `/api/import/pedidos` | 100 req/min | ♾️ Sin límite |
| `/api/proxy/*` | 50 req/min | ♾️ Sin límite |
| `/api/login` | 5 req/5min | ♾️ Sin límite |

---

## 🚨 Troubleshooting

### Problema: SGM sigue recibiendo 429 Error

**Causa:** IP no está en whitelist

**Solución:**
```bash
# Ver IP real de SGM en logs
pm2 logs track | grep "checkRateLimit" | grep -v "BYPASS"

# Agregar IP a whitelist
nano lib/rate-limit.ts
# Agregar IP a WHITELISTED_IPS

# Rebuild y restart
rm -rf .next
pnpm build
pm2 restart track
```

---

### Problema: IP externa bypasea rate limit

**Causa:** IP privada enrutada incorrectamente

**Solución:**
```bash
# Verificar headers de proxy
pm2 logs track | grep "x-forwarded-for\|x-real-ip"

# Ajustar función getClientIp() si necesario
```

---

## 📚 Archivos Modificados

- ✅ `lib/rate-limit.ts` - Whitelist y límites aumentados
- ✅ `RATE_LIMIT_SGM_CONFIG.md` - Esta documentación

---

## 🎯 Siguiente Paso

**Deployment:**
```bash
cd /var/www/track
git pull
rm -rf .next
pnpm build
pm2 restart track

# Verificar logs
pm2 logs track --lines 50 | grep "whitelist"
```

**Test desde SGM:**
```bash
# Hacer 50 requests rápidas
# Debe funcionar sin 429 Error
```

---

**Última actualización:** 2026-02-05  
**Responsable:** Optimización para importación masiva desde SGM
