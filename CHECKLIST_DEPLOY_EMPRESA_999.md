# ✅ Checklist: Deploy Empresa Fletera 999 Fix

## 🎯 Objetivo
Permitir que móviles sin `EFleteraId` se creen automáticamente con empresa genérica (999 "Sin Empresa").

---

## 📋 Pre-Requisitos

- [x] ✅ Código commiteado y pusheado a GitHub
- [ ] ⏳ SQL ejecutado en Supabase
- [ ] ⏳ Código deployed en servidor
- [ ] ⏳ Testing completado

---

## 🚀 Pasos de Deployment

### 1️⃣ Crear Empresa 999 en Supabase (CRÍTICO)

**URL:** https://supabase.com/dashboard/project/lgniuhelyyizoursmsmi/sql

**Pasos:**
1. ⏳ Abrir Supabase SQL Editor (link arriba)
2. ⏳ Copiar contenido de `fix-empresa-fletera-999.sql`
3. ⏳ Pegar en el editor
4. ⏳ Click en "Run" (Ctrl+Enter)
5. ⏳ Verificar mensaje: "Success. No rows returned"
6. ⏳ Ejecutar query de verificación:
   ```sql
   SELECT * FROM empresas_fleteras 
   WHERE empresa_fletera_id = 999 
     AND escenario_id = 1000;
   ```
7. ⏳ Confirmar que retorna 1 fila con nombre "Sin Empresa"

**Estado:** ⏳ PENDIENTE

---

### 2️⃣ Deploy del Código en Servidor

**Opción A - Script Automático (Recomendado):**
```bash
ssh jgomez@192.168.7.13
cd /var/www/track
chmod +x deploy-empresa-999-fix.sh
./deploy-empresa-999-fix.sh
```

**Opción B - Manual:**
```bash
ssh jgomez@192.168.7.13
cd /var/www/track

# Pull código
git pull origin main

# Build
rm -rf .next
pnpm build

# Restart
pm2 restart track

# Verificar logs
pm2 logs track --lines 50
```

**Estado:** ⏳ PENDIENTE

---

### 3️⃣ Verificar Deployment

```bash
# Verificar que PM2 está corriendo
pm2 status

# Ver últimos logs
pm2 logs track --lines 100 | grep empresa_fletera_id

# Verificar memoria/CPU
pm2 monit
```

**Checklist:**
- [ ] ⏳ PM2 status: `online`
- [ ] ⏳ Uptime: `0s` (recién reiniciado)
- [ ] ⏳ Memory: < 500MB (inicial)
- [ ] ⏳ CPU: < 10%

**Estado:** ⏳ PENDIENTE

---

### 4️⃣ Testing Manual

#### Test A: Importar móvil SIN empresa

**Desde Postman o curl:**
```bash
curl -X POST http://192.168.7.13:3002/api/import/moviles \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_API_KEY" \
  -d '{
    "IdentificadorId": 9991,
    "EscenarioId": 1000,
    "Accion": "Publicar"
  }'
```

**Resultado Esperado:**
```json
{
  "success": true,
  "message": "Móvil(es) importado(s) correctamente",
  "data": { ... }
}
```

**Verificar en logs:**
```bash
pm2 logs track --lines 50 | grep "9991"
```

**Debe mostrar:**
```
empresa_fletera_id: 999
✅ Móvil insertado exitosamente
```

**Verificar en Supabase:**
```sql
SELECT id, descripcion, empresa_fletera_id, escenario_id
FROM moviles
WHERE id = '9991';
```

**Debe retornar:**
```
id    | descripcion  | empresa_fletera_id | escenario_id
9991  | Móvil 9991   | 999                | 1000
```

**Checklist:**
- [ ] ⏳ Response: 200 OK
- [ ] ⏳ Logs muestran: `empresa_fletera_id: 999`
- [ ] ⏳ Supabase: Móvil existe con empresa 999
- [ ] ⏳ NO hay error 23502

**Estado:** ⏳ PENDIENTE

---

#### Test B: Importar móvil CON empresa

```bash
curl -X POST http://192.168.7.13:3002/api/import/moviles \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_API_KEY" \
  -d '{
    "IdentificadorId": 9992,
    "EscenarioId": 1000,
    "EFleteraId": 1,
    "Accion": "Publicar"
  }'
```

**Verificar empresa correcta:**
```sql
SELECT id, descripcion, empresa_fletera_id
FROM moviles
WHERE id = '9992';
```

**Debe mostrar:**
```
id    | descripcion  | empresa_fletera_id
9992  | Móvil 9992   | 1  (NO 999, usa el valor enviado)
```

**Checklist:**
- [ ] ⏳ Response: 200 OK
- [ ] ⏳ empresa_fletera_id = 1 (NO 999)

**Estado:** ⏳ PENDIENTE

---

#### Test C: GPS Batch Queue Auto-Create

**Enviar GPS de móvil inexistente:**
```bash
curl -X POST http://192.168.7.13:3002/api/import/gps \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '[{
    "movil": 9993,
    "latitud": -34.9011,
    "longitud": -56.1645,
    "fecha": "2026-02-05T18:30:00Z"
  }]'
```

**Monitorear logs:**
```bash
pm2 logs track --lines 100 | grep "9993"
```

**Debe mostrar:**
```
📤 Creando móvil 9993...
empresa_fletera_id: 999
✅ Móvil 9993 creado exitosamente
✅ GPS insertado
```

**Checklist:**
- [ ] ⏳ GPS encolado: 200 OK
- [ ] ⏳ Auto-create exitoso
- [ ] ⏳ Móvil tiene empresa 999
- [ ] ⏳ GPS insertado correctamente

**Estado:** ⏳ PENDIENTE

---

### 5️⃣ Testing desde SGM (Producción)

**Desde SGM, importar móvil real sin EFleteraId:**

```bash
# SGM enviará request similar a:
POST http://192.168.7.13:3002/api/import/moviles
{
  "IdentificadorId": 936,
  "EscenarioId": 1000,
  "Accion": "Publicar",
  "Entidad": "Moviles",
  "ProcesarEn": 1
}
```

**Monitorear en servidor:**
```bash
pm2 logs track --lines 200 | grep "936"
```

**Verificar:**
- [ ] ⏳ NO hay error 23502
- [ ] ⏳ Móvil 936 insertado exitosamente
- [ ] ⏳ empresa_fletera_id = 999

**Estado:** ⏳ PENDIENTE

---

## 📊 Monitoreo Post-Deploy (24 horas)

### Verificaciones Horarias:

```bash
# Cada hora, ejecutar:

# 1. Ver errores 23502 (debe ser 0)
pm2 logs track --lines 1000 | grep "23502" | wc -l

# 2. Contar móviles con empresa 999
# Ejecutar en Supabase:
SELECT COUNT(*) FROM moviles WHERE empresa_fletera_id = 999;

# 3. Ver rate de éxito auto-create
pm2 logs track --lines 1000 | grep "Auto-create móvil" | wc -l

# 4. Verificar memoria estable
pm2 monit  # Memory debe estar < 1.5GB
```

**Métricas Esperadas:**
- ✅ Errores 23502: 0 (antes: ~10/hora)
- ✅ Móviles empresa 999: creciendo
- ✅ Auto-create rate: 100% (antes: ~50%)
- ✅ Memory: < 1.5GB (estable)

---

## 🚨 Rollback Plan (Si algo falla)

### Síntomas de Problema:
- ❌ Errores 23502 siguen apareciendo
- ❌ Móviles no se crean
- ❌ Memory leak (> 2GB)

### Rollback Código:
```bash
cd /var/www/track
git log -5  # Ver commits recientes
git revert 2692e8a  # Revertir último commit
rm -rf .next
pnpm build
pm2 restart track
```

### Rollback SQL (Si empresa 999 causa problemas):
```sql
-- Deshabilitar empresa 999 (NO borrar, solo inactivar)
UPDATE empresas_fleteras
SET estado = 0
WHERE empresa_fletera_id = 999;
```

---

## ✅ Confirmación Final

**Una vez completados TODOS los tests:**

- [ ] ⏳ SQL ejecutado en Supabase
- [ ] ⏳ Código deployed
- [ ] ⏳ Test A exitoso (móvil sin empresa)
- [ ] ⏳ Test B exitoso (móvil con empresa)
- [ ] ⏳ Test C exitoso (GPS auto-create)
- [ ] ⏳ SGM producción OK
- [ ] ⏳ NO hay errores 23502 en logs
- [ ] ⏳ Memory/CPU estables

**Cuando TODOS estén ✅:**

```bash
# Marcar como deployed
git tag -a "empresa-999-fix-deployed" -m "Fix empresa_fletera_id 999 deployed successfully"
git push origin empresa-999-fix-deployed
```

---

## 📝 Notas

**Fecha de deploy:** ____________

**Deployed by:** ____________

**Tests completados:** ___/6

**Problemas encontrados:** 
_____________________________________________
_____________________________________________

**Observaciones:**
_____________________________________________
_____________________________________________

---

**Siguiente Fix Pendiente:**
- [ ] Rate limit whitelist (ya commiteado, necesita deploy)
- [ ] Forensic analysis completo
- [ ] Security hardening

---

**Documentación:**
- `FIX_EMPRESA_999_DEFAULT.md` - Documentación completa
- `fix-empresa-fletera-999.sql` - SQL para Supabase
- `deploy-empresa-999-fix.sh` - Script de deployment
