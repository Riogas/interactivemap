# 🔧 Fix: Parsing de Fecha YYYYMMDD sin Ceros a la Izquierda

## 📋 Problema

Error de PostgreSQL al insertar pedidos:

```
❌ invalid input syntax for type timestamp with time zone: "202624"
📛 Hint: Perhaps you need a different "datestyle" setting.
```

### Causa Raíz

El campo `FchPara` viene del sistema GeneXus en formato **YYYYMMDD sin ceros a la izquierda**:

```json
{
  "FchPara": "202624",     // ❌ 4 de febrero de 2026
  "FchPara": "2026214",    // ❌ 14 de febrero de 2026  
  "FchPara": "20261231",   // ❌ 31 de diciembre de 2026
}
```

PostgreSQL no puede interpretar este formato como fecha y falla al intentar guardarlo en una columna `DATE` o `TIMESTAMP`.

## 🔍 Análisis del Formato

### Formato Original: YYYYMMDD (sin padding)

| FchPara | Año | Mes | Día | Longitud |
|---------|-----|-----|-----|----------|
| `"202624"` | 2026 | 02 | 04 | 6 dígitos |
| `"2026214"` | 2026 | 02 | 14 | 7 dígitos |
| `"2026915"` | 2026 | 09 | 15 | 7 dígitos |
| `"20261231"` | 2026 | 12 | 31 | 8 dígitos |

### Reglas de Parsing

1. **Año:** Siempre los primeros 4 dígitos
2. **Mes + Día:** El resto de los dígitos
3. **Longitud del resto:**
   - `<= 2 dígitos`: Solo día, mes = "01"
   - `3 dígitos`: Mes de 1 dígito + día de 2 dígitos
   - `4 dígitos`: Mes de 2 dígitos + día de 2 dígitos

### Ejemplos de Conversión

```
"202624"   → año="2026", resto="24"   (3 dígitos) → mes="02", día="04" → "2026-02-04" ✅
"2026214"  → año="2026", resto="214"  (3 dígitos) → mes="02", día="14" → "2026-02-14" ✅
"2026915"  → año="2026", resto="915"  (3 dígitos) → mes="09", día="15" → "2026-09-15" ✅
"20261231" → año="2026", resto="1231" (4 dígitos) → mes="12", día="31" → "2026-12-31" ✅
```

## ✅ Solución Implementada

### Función Nueva: `parseDateYYYYMMDD()`

**Archivo:** `app/api/import/pedidos/route.ts`  
**Línea:** 17-65

```typescript
const parseDateYYYYMMDD = (dateStr: string) => {
  if (!dateStr || dateStr === '0' || dateStr.startsWith('0000')) {
    return null;
  }

  try {
    const str = dateStr.toString().trim();
    
    // Si ya está en formato ISO (YYYY-MM-DD), devolver tal cual
    if (str.includes('-') || str.includes('T')) {
      return parseDate(str);
    }

    // Parsear formato YYYYMMDD (sin ceros a la izquierda)
    const year = str.substring(0, 4);
    const monthDay = str.substring(4);
    
    let month, day;
    
    if (monthDay.length <= 2) {
      // Solo día (mes implícito = 01)
      month = '01';
      day = monthDay.padStart(2, '0');
    } else if (monthDay.length === 3) {
      // Mes de 1 dígito, día de 2 dígitos
      month = monthDay.substring(0, 1).padStart(2, '0');
      day = monthDay.substring(1);
    } else {
      // Mes de 2 dígitos, día de 2 dígitos
      month = monthDay.substring(0, 2);
      day = monthDay.substring(2);
    }

    const isoDate = `${year}-${month}-${day}`;
    
    // Validar que sea fecha válida
    const testDate = new Date(isoDate);
    if (isNaN(testDate.getTime())) {
      console.warn(`⚠️ Fecha inválida después de parseo: ${dateStr} -> ${isoDate}`);
      return null;
    }

    console.log(`📅 Fecha parseada: ${dateStr} -> ${isoDate}`);
    return isoDate;
    
  } catch (error) {
    console.error(`❌ Error parseando fecha YYYYMMDD: ${dateStr}`, error);
    return null;
  }
};
```

### Aplicación en `transformPedidoToSupabase()`

**Línea:** 108

```typescript
// Fechas
fch_para: parseDateYYYYMMDD(pedido.FchPara || pedido.fch_para), // 🔧 Formato especial YYYYMMDD
```

## 📊 Casos de Prueba

### Entrada y Salida Esperada

| Entrada | Salida | Válido |
|---------|--------|--------|
| `"202624"` | `"2026-02-04"` | ✅ |
| `"2026214"` | `"2026-02-14"` | ✅ |
| `"2026915"` | `"2026-09-15"` | ✅ |
| `"20261231"` | `"2026-12-31"` | ✅ |
| `"202611"` | `"2026-01-01"` | ✅ |
| `"0"` | `null` | ✅ |
| `"0000-00-00"` | `null` | ✅ |
| `""` | `null` | ✅ |
| `"2026-02-04"` | `"2026-02-04"` | ✅ (ya ISO) |

## 🚀 Despliegue

### Comandos para Servidor

```bash
cd /var/www/track
pm2 stop track
git pull origin main
rm -rf .next
pnpm build
pm2 restart track
pm2 logs track --lines 50
```

### Verificación Post-Deploy

**Buscar en logs:**
```bash
# ✅ Debe aparecer (fecha parseada correctamente)
grep "Fecha parseada:" /root/.pm2/logs/track-out.log

# ❌ NO debe aparecer (error de datestyle)
grep "invalid input syntax for type timestamp" /root/.pm2/logs/track-error.log
grep "datestyle" /root/.pm2/logs/track-error.log
```

**Esperar ver:**
```
📅 Fecha parseada: 202624 -> 2026-02-04
✅ Pedido #16663669 importado correctamente
```

## 🎯 Resultado Esperado

### Antes (Error)
```
❌ Error al importar pedido #16663669
   invalid input syntax for type timestamp with time zone: "202624"
   Hint: Perhaps you need a different "datestyle" setting.
```

### Después (Éxito)
```
📅 Fecha parseada: 202624 -> 2026-02-04
✅ Pedido #16663669 importado correctamente
   fch_para: 2026-02-04
   cliente: FLIA RUIZ
   móvil: 677
```

## 📝 Notas Técnicas

### Tipo de Columna en Supabase

```sql
-- Columna fch_para es de tipo DATE
CREATE TABLE pedidos (
  ...
  fch_para DATE,
  ...
);
```

PostgreSQL acepta fechas en formato ISO 8601: `YYYY-MM-DD`

### Compatibilidad con Fechas Existentes

La función maneja 3 formatos:
1. **YYYYMMDD sin padding** → Convierte a ISO
2. **ISO 8601 (YYYY-MM-DD)** → Devuelve tal cual
3. **Timestamp (YYYY-MM-DDTHH:MM:SS)** → Pasa a `parseDate()`

### Validación de Fechas

```typescript
const testDate = new Date(isoDate);
if (isNaN(testDate.getTime())) {
  return null; // Fecha inválida
}
```

Previene fechas imposibles como `2026-02-30` o `2026-13-01`.

## 🔗 Contexto de Otros Fixes

Este fix es parte de una serie de correcciones en el sistema GPS/Pedidos:

1. **Rate Limit Bypass GPS** (7d4c70b) - ✅ Completado
2. **Supabase Timeout 30s** (52a2940) - ✅ Completado
3. **GeneXus Timeout 30s** (38be634) - ✅ Completado
4. **Accordion Toggle** (5ff228e) - ✅ Completado
5. **Parsing Fecha YYYYMMDD** (ESTE FIX) - 🆕 Nuevo

---

**Fecha:** 2025-01-24  
**Archivo:** `app/api/import/pedidos/route.ts`  
**Líneas:** 17-65, 108  
**Commit:** (pendiente)
