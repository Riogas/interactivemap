# 🔍 Problema con Auto-Import de Móviles - Análisis y Fix

## 📋 Problema Detectado en Logs

```
⚠️ Error de integridad referencial detectado - móvil no existe
🔍 Móvil faltante identificado: 403
🔄 Importando móvil 403 desde GeneXus...
❌ Error al importar móvil 403: HTTP 500  ← PROBLEMA AQUÍ
❌ No se pudo importar el móvil 403
```

## 🎯 Causas Posibles

### 1. ❌ URL Incorrecta (PRINCIPAL)

**Estábamos usando**:
```typescript
const importUrl = 'https://sgm-dev.glp.riogas.com.uy/tracking/importacion';
```

**Deberíamos usar**:
```typescript
const importUrl = 'https://sgm.glp.riogas.com.uy/tracking/importacion';
// (sin -dev)
```

### 2. ⚠️ Timeout Insuficiente

**Antes**: 500ms de espera  
**Ahora**: 1500ms de espera

El servicio de GeneXus puede tardar más en procesar la importación.

### 3. 🔍 Falta de Logging Detallado

**Antes**: Solo veíamos "HTTP 500"  
**Ahora**: Vemos el payload enviado y la respuesta completa

---

## ✅ Cambios Aplicados (Commit `c511a7b`)

### 1. URL Corregida

```typescript
// ❌ Antes
const importUrl = 'https://sgm-dev.glp.riogas.com.uy/tracking/importacion';

// ✅ Ahora
const importUrl = 'https://sgm.glp.riogas.com.uy/tracking/importacion';
```

### 2. Logging Mejorado

```typescript
const payload = {
  EscenarioId: 1000,
  IdentificadorId: movilId,
  Accion: 'Publicar',
  Entidad: 'Moviles',
  ProcesarEn: 1,
};

console.log(`📤 Enviando a ${importUrl}:`, JSON.stringify(payload));

const response = await fetch(importUrl, { /* ... */ });

const responseText = await response.text();
console.log(`📥 Respuesta (${response.status}):`, responseText.substring(0, 200));

if (!response.ok) {
  console.error(`📄 Respuesta completa:`, responseText);
  return false;
}
```

### 3. Timeout Aumentado

```typescript
// ❌ Antes: 500ms
await new Promise(resolve => setTimeout(resolve, 500));

// ✅ Ahora: 1500ms
console.log(`⏱️ Esperando 1500ms para que se procese la importación...`);
await new Promise(resolve => setTimeout(resolve, 1500));
```

### 4. Mejor Manejo de Errores

```typescript
catch (error: any) {
  console.error(`❌ Error al importar móvil ${movilId}:`, error);
  console.error(`❌ Error stack:`, error.stack);
  return false;
}
```

---

## 🚀 Deploy en Servidor

### 1. Pull del Código

```bash
cd /var/www/track
git pull origin main
```

**Esperado**:
```
Updating aebbcec..c511a7b
Fast-forward
 app/api/import/gps/route.ts | 43 ++++++++++++++++++++++++++-------------
 1 file changed, 30 insertions(+), 13 deletions(-)
```

### 2. Restart PM2

```bash
pm2 restart track
```

### 3. Monitorear Logs

```bash
pm2 logs track --lines 100
```

**Buscar**:
```
🔄 Importando móvil XXX desde GeneXus...
📤 Enviando a https://sgm.glp.riogas.com.uy/tracking/importacion: {...}
📥 Respuesta (200): {...}
✅ Móvil XXX importado exitosamente
⏱️ Esperando 1500ms para que se procese la importación...
🔄 Reintentando inserción de GPS después de importar móvil XXX...
✅ Inserción exitosa después de importar móvil XXX
```

---

## 🧪 Testing

### Provocar un Error FK Intencional

```bash
# En el servidor, insertar coordenada con móvil que NO existe
curl -X POST http://localhost:3002/api/import/gps \
  -H "Content-Type: application/json" \
  -H "X-API-Key: <tu-key>" \
  -d '{
    "movil": 99999,
    "latitud": -34.9,
    "longitud": -56.1,
    "timestamp_local": "2026-02-04T12:00:00Z"
  }'
```

### Logs Esperados con el Fix

```
📍 Insertando 1 registro(s) GPS...
⚠️ Error de integridad referencial detectado - móvil no existe
🔍 Móvil faltante identificado: 99999
🔄 Importando móvil 99999 desde GeneXus...
📤 Enviando a https://sgm.glp.riogas.com.uy/tracking/importacion: {"EscenarioId":1000,"IdentificadorId":99999,"Accion":"Publicar","Entidad":"Moviles","ProcesarEn":1}
📥 Respuesta (200): {"success":true,"message":"Móvil importado"}
✅ Móvil 99999 importado exitosamente
⏱️ Esperando 1500ms para que se procese la importación...
🔄 Reintentando inserción de GPS después de importar móvil 99999...
✅ Inserción exitosa después de importar móvil 99999
✅ 1 registros GPS insertados
```

---

## 🔍 Si Sigue Fallando

### Verificar que el Endpoint de GeneXus Funciona

```bash
# En el servidor
curl -X POST https://sgm.glp.riogas.com.uy/tracking/importacion \
  -H "Content-Type: application/json" \
  -d '{
    "EscenarioId": 1000,
    "IdentificadorId": 403,
    "Accion": "Publicar",
    "Entidad": "Moviles",
    "ProcesarEn": 1
  }' \
  -v
```

**Esperado**: HTTP 200 OK

**Si da 500**:
- El endpoint de GeneXus tiene un problema
- El móvil 403 no existe en el sistema origen
- Falta autenticación/headers

### Verificar Logs Detallados

```bash
pm2 logs track | grep -A 5 "Importando móvil"
```

Ahora veremos:
- El payload exacto enviado
- La respuesta completa del servidor
- El código de estado HTTP

---

## 📊 Comparación Antes/Después

| Aspecto | Antes | Después |
|---------|-------|---------|
| **URL** | `sgm-dev.glp...` ❌ | `sgm.glp...` ✅ |
| **Timeout** | 500ms ⏱️ | 1500ms ⏱️⏱️⏱️ |
| **Logging** | Básico 📝 | Detallado 📊 |
| **Error Info** | Solo status | Status + body + stack |

---

## 🎯 Próximos Pasos

1. **Deploy en servidor**: `git pull && pm2 restart track`
2. **Monitorear logs**: `pm2 logs track`
3. **Esperar un móvil nuevo** que reporte GPS
4. **Verificar** que la auto-importación funciona
5. **Reportar** si sigue dando error (ahora tendremos más info)

---

**Estado**: ✅ Fix aplicado y pusheado  
**Commit**: `c511a7b`  
**Próximo**: Deploy en servidor y testing
