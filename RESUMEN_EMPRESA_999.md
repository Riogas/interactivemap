# 🎯 RESUMEN RÁPIDO: Fix Empresa Fletera 999

## ❌ PROBLEMA
```
Error: null value in column "empresa_fletera_id" violates not-null constraint
Código: 23502
```

SGM envía móviles **sin `EFleteraId`** → Supabase requiere `empresa_fletera_id` NOT NULL → ❌ Falla

---

## ✅ SOLUCIÓN

### 1️⃣ Crear Empresa Genérica (ID 999)
```sql
-- Ejecutar en Supabase SQL Editor:
-- https://supabase.com/dashboard/project/lgniuhelyyizoursmsmi/sql

INSERT INTO empresas_fleteras (
  empresa_fletera_id, escenario_id, nombre, estado
) VALUES (
  999, 1000, 'Sin Empresa', 1
);
```

### 2️⃣ Código Usa 999 por Default
```typescript
// app/api/import/moviles/route.ts
const empresaFleteraId = movil.EFleteraId ?? movil.empresa_fletera_id ?? 999;
//                                                                         ↑↑↑
//                                                              DEFAULT si no viene
```

---

## 🚀 DEPLOYMENT

### Paso 1: Ejecutar SQL (5 minutos)
1. Abrir: https://supabase.com/dashboard/project/lgniuhelyyizoursmsmi/sql
2. Copiar contenido de `fix-empresa-fletera-999.sql`
3. Ejecutar (Run)
4. Verificar: `SELECT * FROM empresas_fleteras WHERE empresa_fletera_id = 999;`

### Paso 2: Deploy Código (5 minutos)
```bash
ssh jgomez@192.168.7.13
cd /var/www/track
./deploy-empresa-999-fix.sh  # Script automático

# O manual:
git pull && rm -rf .next && pnpm build && pm2 restart track
```

### Paso 3: Testing (2 minutos)
```bash
# Enviar móvil de prueba sin EFleteraId
curl -X POST http://192.168.7.13:3002/api/import/moviles \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_API_KEY" \
  -d '{"IdentificadorId": 9991, "EscenarioId": 1000}'

# Verificar logs
pm2 logs track --lines 50 | grep "empresa_fletera_id"
# Debe mostrar: "empresa_fletera_id": 999
```

---

## 📊 RESULTADOS ESPERADOS

| Métrica | Antes | Después |
|---------|-------|---------|
| Errores 23502 | 100% | 0% ✅ |
| GPS auto-create | 50% falla | 100% éxito ✅ |
| Importación SGM | Bloqueada ❌ | Funciona ✅ |
| Móviles con empresa 999 | N/A | ~30% |

---

## 📝 ARCHIVOS

- ✅ `fix-empresa-fletera-999.sql` - SQL para Supabase
- ✅ `app/api/import/moviles/route.ts` - Código modificado
- ✅ `deploy-empresa-999-fix.sh` - Script deployment automático
- ✅ `CHECKLIST_DEPLOY_EMPRESA_999.md` - Checklist detallado
- ✅ `FIX_EMPRESA_999_DEFAULT.md` - Documentación completa

---

## ⏱️ TIEMPO TOTAL: ~15 minutos

1. SQL (5 min)
2. Deploy (5 min)
3. Testing (5 min)

---

## 🔗 SIGUIENTE

Después de este deploy, completar:
- [ ] Rate limit whitelist (ya commiteado)
- [ ] Forensic analysis
- [ ] Security hardening

---

**Status:** ✅ CÓDIGO LISTO - ⏳ DEPLOYMENT PENDIENTE
