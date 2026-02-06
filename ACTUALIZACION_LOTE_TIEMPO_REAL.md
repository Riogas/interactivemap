# 🚀 Actualización de Lote en Tiempo Real

## ✨ Nueva funcionalidad implementada

Los móviles ahora muestran su **lote actualizado en tiempo real** basado en los pedidos asignados.

---

## 📊 Formato de visualización

**Antes:**
```
Móvil 24: 0/6
```

**Ahora (en tiempo real):**
```
Móvil 24: 3/6  ← 3 pedidos activos de 6 de capacidad
Móvil 301: 6/6 ← Lote completo
Móvil 558: 0/6 ← Sin pedidos asignados
```

---

## 🔄 Cómo funciona

### 1. Conteo de pedidos activos
El sistema cuenta **solo los pedidos activos** (no entregados ni cancelados):

```typescript
const ESTADOS_ACTIVOS = [1, 2, 3, 4, 5]; 
// Estados pendientes, en camino, etc.
// EXCLUYE: entregados, cancelados, rechazados
```

### 2. Actualización automática
Se actualiza cada vez que:
- ✅ Se carga un nuevo pedido desde la API
- ✅ Un pedido cambia de estado (Realtime)
- ✅ Se asigna un pedido a un móvil
- ✅ Se entrega un pedido (baja el contador)
- ✅ Se cancela un pedido (baja el contador)

### 3. Dónde se muestra

**A) Panel lateral (MovilSelector):**
```
📍 Móvil 24 - SAP 3846
   Lote: 3/6
   [Ver detalles]
```

**B) Popup en el mapa (MovilInfoPopup):**
```
Móvil 24
Matrícula: SAP 3846
Lote: 3/6 ← Actualizado en tiempo real
```

**C) Indicadores del dashboard:**
- Capacidad total usada
- Porcentaje de ocupación

---

## 🎯 Estados de pedidos

### Estados activos (cuentan para el lote):

| Estado | Descripción | Cuenta |
|--------|-------------|--------|
| 1 | Pendiente | ✅ SÍ |
| 2 | En camino | ✅ SÍ |
| 3 | En proceso | ✅ SÍ |
| 4 | Demorado | ✅ SÍ |
| 5 | Reprogramado | ✅ SÍ |

### Estados finales (NO cuentan):

| Estado | Descripción | Cuenta |
|--------|-------------|--------|
| 6 | Entregado | ❌ NO |
| 7 | Cancelado | ❌ NO |
| 8 | Rechazado | ❌ NO |
| 9 | No entregado | ❌ NO |

**💡 Nota:** Ajusta el array `ESTADOS_ACTIVOS` en el código según los estados de tu sistema.

---

## 🔧 Configuración de estados

Si necesitas cambiar qué estados cuentan como "activos", edita:

**Archivo:** `app/dashboard/page.tsx`  
**Línea:** ~862

```typescript
// 🎯 CONFIGURAR AQUÍ: Estados que cuentan como pedidos activos
const ESTADOS_ACTIVOS = [1, 2, 3, 4, 5]; 

// Ejemplos:
// Solo pendientes: [1]
// Pendientes y en camino: [1, 2]
// Todos menos entregados: [1, 2, 3, 4, 5, 7, 8]
```

---

## 📊 Logs de debugging

El sistema registra en consola:

```
📦 Actualizando lote de móviles en tiempo real
📊 Pedidos activos por móvil: { 24: 3, 301: 6, 558: 0, ... }
🔄 Móvil 24: 3/6 pedidos
🔄 Móvil 301: 6/6 pedidos
🔄 Móvil 558: 0/6 pedidos
```

---

## 🎨 Indicadores visuales

### Color del lote (sugerencia futura):

Puedes agregar colores según la capacidad:

```typescript
// Verde: 0-50% de capacidad
if (pedidosAsignados / tamanoLote <= 0.5) return 'text-green-500';

// Amarillo: 51-80% de capacidad
if (pedidosAsignados / tamanoLote <= 0.8) return 'text-yellow-500';

// Naranja: 81-99% de capacidad
if (pedidosAsignados / tamanoLote < 1) return 'text-orange-500';

// Rojo: 100% de capacidad
return 'text-red-500';
```

---

## 🧪 Cómo probar

### Test 1: Verificar conteo inicial
1. Abre la aplicación
2. Abre la consola (F12)
3. Busca: `📦 Actualizando lote de móviles en tiempo real`
4. Verifica que los números sean correctos

### Test 2: Verificar actualización en tiempo real
1. En Supabase, cambia el estado de un pedido:
```sql
UPDATE pedidos 
SET estado_nro = 6 -- Entregado
WHERE id = 12345 AND movil = 24;
```

2. En la app, el lote del móvil 24 debería bajar:
   - Antes: `3/6`
   - Después: `2/6`

### Test 3: Asignar nuevo pedido
1. Asigna un pedido a un móvil:
```sql
UPDATE pedidos 
SET movil = 24, estado_nro = 1
WHERE id = 99999;
```

2. El lote debería subir:
   - Antes: `2/6`
   - Después: `3/6`

---

## 🔄 Flujo de actualización

```
Pedidos cambian (API/Realtime)
         ↓
pedidosCompletos (useMemo)
         ↓
useEffect detecta cambio
         ↓
Cuenta pedidos activos por móvil
         ↓
Actualiza setMoviles()
         ↓
UI se re-renderiza automáticamente
         ↓
Lote actualizado en panel y mapa
```

---

## 📈 Beneficios

1. ✅ **Visibilidad en tiempo real** de la carga de cada móvil
2. ✅ **Optimización de asignaciones** (evitar sobrecargar móviles)
3. ✅ **Detección de móviles disponibles** (lote < capacidad)
4. ✅ **Indicadores de capacidad** para planificación
5. ✅ **Reacción inmediata** a cambios de estado

---

## 🎯 Casos de uso

### Caso 1: Asignar nuevo pedido
```
Dashboard muestra:
  Móvil 24: 3/6 ← Tiene espacio
  Móvil 301: 6/6 ← Lote completo (buscar otro)
  Móvil 558: 0/6 ← Disponible
```

### Caso 2: Monitoreo de entregas
```
Antes:  Móvil 24: 5/6
Entrega 1 pedido → 4/6
Entrega 2 pedidos → 2/6
Nueva asignación → 3/6
```

### Caso 3: Alertas de capacidad
```javascript
// Detectar móviles con lote completo
const movilesCompletos = moviles.filter(m => 
  m.pedidosAsignados >= m.tamanoLote
);
console.log('⚠️ Móviles con lote completo:', movilesCompletos.length);
```

---

## 🔮 Mejoras futuras

### 1. Alertas visuales
```typescript
// Alerta cuando un móvil llega a 100% de capacidad
if (pedidosAsignados >= tamanoLote) {
  toast.warning(`Móvil ${movilId} tiene el lote completo`);
}
```

### 2. Recomendaciones de asignación
```typescript
// Sugerir móvil con más espacio disponible
const movilSugerido = moviles
  .filter(m => m.pedidosAsignados < m.tamanoLote)
  .sort((a, b) => a.pedidosAsignados - b.pedidosAsignados)[0];
```

### 3. Estadísticas agregadas
```typescript
// Dashboard: Capacidad total utilizada
const capacidadTotal = moviles.reduce((sum, m) => sum + m.tamanoLote, 0);
const ocupacionTotal = moviles.reduce((sum, m) => sum + m.pedidosAsignados, 0);
const porcentajeUso = (ocupacionTotal / capacidadTotal) * 100;
```

---

## ✅ Validación

**Archivo modificado:** `app/dashboard/page.tsx`  
**Líneas agregadas:** 41 líneas (useEffect con lógica de actualización)  
**Compilación:** ✅ Exitosa  
**Tests TypeScript:** ✅ Sin errores  

---

## 📝 Resumen

| Funcionalidad | Estado |
|---------------|--------|
| Conteo de pedidos activos | ✅ Implementado |
| Actualización en tiempo real | ✅ Implementado |
| Visualización en panel lateral | ✅ Ya existía |
| Visualización en popup mapa | ✅ Ya existía |
| Logs de debugging | ✅ Agregados |
| Configuración de estados | ✅ Documentado |

---

**Fecha:** 2026-02-06  
**Archivo:** ACTUALIZACION_LOTE_TIEMPO_REAL.md
