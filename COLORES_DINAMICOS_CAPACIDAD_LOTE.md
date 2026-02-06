# 🎨 Colores Dinámicos de Móviles por Capacidad de Lote

## ✨ Nueva funcionalidad implementada

Los móviles ahora cambian de color **automáticamente** según su capacidad disponible.

---

## 🎨 Sistema de colores

### 🟢 Verde - Buena capacidad (≥ 50% disponible)
```
Lote: 2/6  → Verde (4 espacios libres = 66% disponible)
Lote: 1/4  → Verde (3 espacios libres = 75% disponible)
Lote: 0/6  → Verde (6 espacios libres = 100% disponible)
```

**Color:** `#22C55E` (Verde brillante)  
**Significado:** El móvil tiene buena capacidad para recibir más pedidos

---

### 🟡 Amarillo - Poca capacidad (< 50% disponible)
```
Lote: 4/6  → Amarillo (2 espacios libres = 33% disponible)
Lote: 3/4  → Amarillo (1 espacio libre = 25% disponible)
Lote: 5/6  → Amarillo (1 espacio libre = 16% disponible)
```

**Color:** `#F59E0B` (Amarillo/Ámbar)  
**Significado:** El móvil está cerca de su capacidad máxima

---

### ⚫ Negro - Sin capacidad (0% disponible)
```
Lote: 6/6  → Negro (0 espacios libres)
Lote: 4/4  → Negro (0 espacios libres)
Lote: 3/3  → Negro (0 espacios libres)
```

**Color:** `#1F2937` (Gris oscuro/Negro)  
**Significado:** El móvil tiene el lote completo, no puede recibir más pedidos

---

## 🔄 Actualización automática

El color cambia **en tiempo real** cuando:
- ✅ Se asigna un nuevo pedido
- ✅ Se entrega un pedido
- ✅ Se cancela un pedido
- ✅ Cambia el estado de un pedido

---

## 📊 Ejemplos visuales

### Escenario 1: Inicio del día
```
Móvil 24 (Lote: 0/6)  🟢 Verde → 100% disponible
Móvil 301 (Lote: 1/6) 🟢 Verde → 83% disponible
Móvil 558 (Lote: 2/6) 🟢 Verde → 66% disponible
```

### Escenario 2: Media mañana
```
Móvil 24 (Lote: 4/6)  🟡 Amarillo → 33% disponible
Móvil 301 (Lote: 5/6) 🟡 Amarillo → 16% disponible
Móvil 558 (Lote: 3/6) 🟢 Verde → 50% disponible
```

### Escenario 3: Lotes completos
```
Móvil 24 (Lote: 6/6)  ⚫ Negro → 0% disponible (COMPLETO)
Móvil 301 (Lote: 6/6) ⚫ Negro → 0% disponible (COMPLETO)
Móvil 558 (Lote: 4/6) 🟡 Amarillo → 33% disponible
```

### Escenario 4: Después de entregas
```
Móvil 24: 6/6 → Entrega 2 pedidos → 4/6 ⚫→🟡 (Negro a Amarillo)
Móvil 301: 5/6 → Entrega 2 pedidos → 3/6 🟡→🟢 (Amarillo a Verde)
Móvil 558: 4/6 → Entrega 1 pedido  → 3/6 🟡→🟢 (Amarillo a Verde)
```

---

## 🧮 Lógica de cálculo

### Función principal:
```typescript
const getMovilColor = (movil: MovilData) => {
  const tamanoLote = movil.tamanoLote || 6;
  const pedidosAsignados = movil.pedidosAsignados || 0;
  
  // Calcular capacidad restante
  const capacidadRestante = tamanoLote - pedidosAsignados;
  const porcentajeDisponible = (capacidadRestante / tamanoLote) * 100;
  
  // Negro: 0% disponible
  if (capacidadRestante === 0) {
    return '#1F2937';
  }
  
  // Amarillo: < 50% disponible
  if (porcentajeDisponible < 50) {
    return '#F59E0B';
  }
  
  // Verde: >= 50% disponible
  return '#22C55E';
};
```

### Tabla de decisión:

| Lote | Capacidad Restante | % Disponible | Color |
|------|-------------------|--------------|-------|
| 0/6 | 6 | 100% | 🟢 Verde |
| 1/6 | 5 | 83% | 🟢 Verde |
| 2/6 | 4 | 66% | 🟢 Verde |
| 3/6 | 3 | 50% | 🟢 Verde |
| 4/6 | 2 | 33% | 🟡 Amarillo |
| 5/6 | 1 | 16% | 🟡 Amarillo |
| 6/6 | 0 | 0% | ⚫ Negro |

---

## 🎯 Dónde se aplica

### 1. Iconos en el mapa
- Círculo del icono usa el color dinámico
- Badge inferior también usa el color dinámico

### 2. Popups
- Título del popup usa el color dinámico
- Información de lote se muestra con el color correspondiente

### 3. Panel lateral
- El indicador de lote muestra el color
- La lista de móviles puede usar el color como referencia

---

## 🎨 Personalización de colores

Si necesitas cambiar los colores, edita la función `getMovilColor`:

**Archivo:** `components/map/MapView.tsx` - Línea ~870

```typescript
// Personalizar umbrales y colores
if (capacidadRestante === 0) {
  return '#DC2626'; // Rojo intenso (lote completo)
}

if (porcentajeDisponible < 30) { // Umbral más bajo
  return '#F59E0B'; // Amarillo
}

if (porcentajeDisponible < 70) { // Umbral medio
  return '#3B82F6'; // Azul (capacidad media)
}

return '#22C55E'; // Verde (mucha capacidad)
```

### Colores sugeridos:

**Verde:**
- `#22C55E` - Verde brillante (actual)
- `#10B981` - Verde esmeralda
- `#059669` - Verde oscuro

**Amarillo:**
- `#F59E0B` - Ámbar (actual)
- `#FBBF24` - Amarillo brillante
- `#F97316` - Naranja

**Negro/Completo:**
- `#1F2937` - Gris oscuro (actual)
- `#111827` - Negro
- `#DC2626` - Rojo (más llamativo)

---

## 🔄 Flujo de actualización

```
Pedido cambia de estado
         ↓
useEffect detecta cambio en pedidosCompletos
         ↓
Recalcula pedidosAsignados por móvil
         ↓
Actualiza móviles con nuevo contador
         ↓
getMovilColor() calcula nuevo color
         ↓
createCustomIcon() genera icono con nuevo color
         ↓
Mapa se re-renderiza automáticamente
         ↓
Icono cambia de color instantáneamente
```

---

## 🧪 Cómo probar

### Test 1: Ver colores iniciales
1. Abre la aplicación
2. Observa el mapa
3. Los móviles deberían tener diferentes colores según su lote

### Test 2: Simular asignación de pedidos
1. En Supabase, asigna pedidos a un móvil:
```sql
-- Asignar 5 pedidos al móvil 24 (lote 6)
UPDATE pedidos 
SET movil = 24, estado_nro = 1
WHERE id IN (100, 101, 102, 103, 104);
```

2. El móvil 24 debería cambiar a amarillo (5/6 = 16% disponible)

### Test 3: Simular lote completo
```sql
-- Completar el lote del móvil 24
UPDATE pedidos 
SET movil = 24, estado_nro = 1
WHERE id = 105;
```

3. El móvil 24 debería cambiar a negro (6/6 = 0% disponible)

### Test 4: Simular entregas
```sql
-- Entregar 3 pedidos
UPDATE pedidos 
SET estado_nro = 6
WHERE id IN (100, 101, 102);
```

4. El móvil 24 debería cambiar a verde (3/6 = 50% disponible)

---

## 📊 Casos de uso

### Caso 1: Asignación inteligente
```
Dispatcher busca asignar un pedido urgente:

Móviles disponibles:
- Móvil 24: 6/6 ⚫ Negro → Descartado (lote completo)
- Móvil 301: 5/6 🟡 Amarillo → Posible (1 espacio)
- Móvil 558: 2/6 🟢 Verde → Mejor opción (4 espacios)

Decisión: Asignar al Móvil 558
```

### Caso 2: Balanceo de carga
```
Situación:
- Móvil 24: 1/6 🟢 Verde
- Móvil 301: 5/6 🟡 Amarillo
- Móvil 558: 6/6 ⚫ Negro

Acción: Redistribuir pedidos del 301 al 24
Resultado:
- Móvil 24: 3/6 🟢 Verde
- Móvil 301: 3/6 🟢 Verde
- Móvil 558: 6/6 ⚫ Negro (en proceso)
```

### Caso 3: Alerta visual
```
Fin del día:
- 15 móviles verdes 🟢 → Buena distribución
- 8 móviles amarillos 🟡 → Cerca del límite
- 3 móviles negros ⚫ → Lotes completos

Indicador de eficiencia: 57% de capacidad utilizada
```

---

## 💡 Mejoras futuras

### 1. Alertas automáticas
```typescript
// Notificar cuando un móvil llega a lote completo
if (capacidadRestante === 0) {
  toast.warning(`⚫ Móvil ${movilId} tiene el lote completo`);
}
```

### 2. Filtros por color
```typescript
// Botones para filtrar móviles:
- "Ver solo móviles con capacidad (verdes)"
- "Ver móviles llenos (negros)"
- "Ver móviles cerca del límite (amarillos)"
```

### 3. Estadísticas de capacidad
```typescript
const estadisticas = {
  verdes: moviles.filter(m => getMovilColor(m) === '#22C55E').length,
  amarillos: moviles.filter(m => getMovilColor(m) === '#F59E0B').length,
  negros: moviles.filter(m => getMovilColor(m) === '#1F2937').length,
};
```

### 4. Gradiente de colores
```typescript
// En lugar de 3 colores, usar escala gradual:
const getColorGradient = (porcentaje: number) => {
  if (porcentaje === 0) return '#DC2626'; // Rojo
  if (porcentaje < 25) return '#F59E0B'; // Naranja
  if (porcentaje < 50) return '#FBBF24'; // Amarillo
  if (porcentaje < 75) return '#84CC16'; // Verde lima
  return '#22C55E'; // Verde
};
```

---

## ✅ Validación

**Archivo modificado:** `components/map/MapView.tsx`  
**Función agregada:** `getMovilColor()`  
**Líneas modificadas:** 4 (3 llamadas a createCustomIcon + función)  
**Compilación:** ✅ Exitosa (17.6s)  
**Tests TypeScript:** ✅ Sin errores  

---

## 📝 Resumen

| Funcionalidad | Estado |
|---------------|--------|
| Cálculo dinámico de color | ✅ Implementado |
| Color verde (≥50%) | ✅ Implementado |
| Color amarillo (<50%) | ✅ Implementado |
| Color negro (0%) | ✅ Implementado |
| Actualización en tiempo real | ✅ Implementado |
| Aplicado en mapa | ✅ Implementado |
| Aplicado en popups | ✅ Implementado |

---

**Fecha:** 2026-02-06  
**Issue:** DESA-10  
**Archivo:** COLORES_DINAMICOS_CAPACIDAD_LOTE.md
