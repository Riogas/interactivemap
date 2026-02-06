# 🐛 FIX: Pedidos no se mostraban - Campo de fecha incorrecto

## ❌ Problema encontrado

Los pedidos no se mostraban en el mapa porque el filtro de fecha usaba el campo **incorrecto**.

### Datos en la tabla `pedidos`:
```
fch_hora_para: 2026-02-06 10:20:45+00  ✅ (timestamp con fecha/hora real)
fch_para:      2026-01-26              ❌ (date desactualizado o legacy)
```

### Código anterior (incorrecto):
```typescript
if (fecha) {
  query = query.eq('fch_para', fecha); // ❌ Filtrando por campo desactualizado
}
```

**Resultado:** La API buscaba pedidos con `fch_para = '2026-02-06'` pero ese campo tenía `'2026-01-26'`, por eso devolvía 0 pedidos.

---

## ✅ Solución aplicada

### Código corregido:
```typescript
if (fecha) {
  // Convertir fecha YYYY-MM-DD a rango de timestamp para todo el día
  const fechaInicio = `${fecha}T00:00:00`;
  const fechaFin = `${fecha}T23:59:59`;
  query = query.gte('fch_hora_para', fechaInicio).lte('fch_hora_para', fechaFin);
}
```

**Ahora filtra por:**
- `fch_hora_para >= '2026-02-06T00:00:00'` 
- `fch_hora_para <= '2026-02-06T23:59:59'`

Esto captura **todos los pedidos del día** sin importar la hora.

---

## 📊 Impacto

**Antes:**
```javascript
fetch('/api/pedidos?escenario=1000&fecha=2026-02-06')
// Response: { success: true, count: 0, data: [] } ❌
```

**Después:**
```javascript
fetch('/api/pedidos?escenario=1000&fecha=2026-02-06')
// Response: { success: true, count: N, data: [...] } ✅
```

---

## 🔧 Archivo modificado

**`app/api/pedidos/route.ts`** - Líneas 58-62

**Cambio:**
- ❌ `query.eq('fch_para', fecha)`
- ✅ `query.gte('fch_hora_para', fechaInicio).lte('fch_hora_para', fechaFin)`

---

## 🧪 Cómo probar

### 1. Reinicia el servidor de desarrollo:
```bash
# Detén el servidor (Ctrl+C)
npm run dev
```

### 2. Recarga la aplicación en el navegador:
```
http://localhost:3000
```

### 3. Verifica en la consola del navegador:
```javascript
fetch('/api/pedidos?escenario=1000&fecha=2026-02-06')
  .then(r=>r.json())
  .then(d=>console.log('Pedidos:', d.count, d.data))
```

**Deberías ver:**
```
Pedidos: 9 [Array con pedidos]
```

### 4. Verifica los logs en la consola del navegador:
```
📦 Fetching pedidos from API...
🌐 Fetching URL: /api/pedidos?escenario=1000&fecha=2026-02-06
📡 Response status: 200
✅ Loaded 9 pedidos
📍 Primer pedido: { id: ..., latitud: ..., longitud: ... }
📍 9 pedidos tienen coordenadas
🔷 DASHBOARD: pedidosCompletos calculado
📊 Total pedidos completos: 9
```

---

## 📝 Notas técnicas

### Diferencia entre campos:

| Campo | Tipo | Descripción | Uso |
|-------|------|-------------|-----|
| `fch_para` | `date` | Fecha sin hora (puede ser legacy) | ❌ No usar para filtros |
| `fch_hora_para` | `timestamp with time zone` | Fecha y hora completa | ✅ Usar para filtros |

### Por qué usar rango de timestamp:

En lugar de comparar solo la fecha:
```sql
WHERE fch_hora_para::date = '2026-02-06'  -- Menos eficiente
```

Usamos rango de timestamps:
```sql
WHERE fch_hora_para >= '2026-02-06T00:00:00' 
  AND fch_hora_para <= '2026-02-06T23:59:59'  -- Más eficiente, usa índices
```

Esto permite que Supabase use índices y sea más rápido.

---

## ✅ Validación

**Compilación:** ✅ Exitosa (20.7s)  
**Tests TypeScript:** ✅ Sin errores  
**Impacto:** Todos los pedidos del día ahora serán visibles en el mapa

---

## 🎯 Resumen

**Problema:** Campo de fecha incorrecto causaba 0 pedidos  
**Causa:** Filtro usaba `fch_para` (date) en lugar de `fch_hora_para` (timestamp)  
**Solución:** Cambiar filtro a rango de timestamps en `fch_hora_para`  
**Resultado:** Pedidos ahora se muestran correctamente en el mapa  

---

**Fecha:** 2026-02-06  
**Archivo:** FIX_FILTRO_FECHA_PEDIDOS.md
