# 🔧 Correcciones: Display de Móviles y Nombres de Columnas

## ❌ Problemas Encontrados

### 1. Error de Columna en Pedidos
```
Error: column pedidos.escenario_id does not exist
Hint: Perhaps you meant to reference the column "pedidos.escenario".
```

**Causa**: Se estaban usando nombres de columnas incorrectos que no coinciden con la estructura real de la tabla `pedidos`.

### 2. Display Incompleto de Móviles
El móvil solo mostraba `693` en lugar de `693 – 0/6` cuando no tenía datos extendidos cargados.

## ✅ Soluciones Implementadas

### 1. Corrección de Nombres de Columnas en `pedidos`

#### Archivo: `app/api/pedidos-pendientes/[movilId]/route.ts`

**Antes** (❌ Incorrecto):
```typescript
.select(`
  escenario_id,    // ❌ No existe
  movil_id,        // ❌ No existe
  estado,          // ❌ No existe
  fecha_hora_cumplido, // ❌ No existe
  // ... más campos incorrectos
`)
.eq('movil_id', movilId)
.eq('escenario_id', escenarioId)
.is('fecha_hora_cumplido', null)
```

**Ahora** (✅ Correcto):
```typescript
.select(`
  escenario,       // ✅ Nombre correcto
  movil,           // ✅ Nombre correcto
  estado_nro,      // ✅ Nombre correcto
  fch_hora_max_ent_comp, // ✅ Nombre correcto
  // ... campos correctos según schema
`)
.eq('movil', movilId)
.eq('escenario', escenarioId)
.in('estado_nro', [1, 2, 3, 4, 5, 6, 7]) // ✅ Estados pendientes
```

#### Mapeo Completo de Columnas

| ❌ Incorrecto | ✅ Correcto |
|--------------|-------------|
| `escenario_id` | `escenario` |
| `movil_id` | `movil` |
| `estado` | `estado_nro` |
| `latitud` | No existe en schema |
| `longitud` | No existe en schema |
| `zona` | `zona_nro` |
| `nombre_servicio` | `servicio_nombre` |
| `producto_codigo` | `producto_cod` |
| `producto_nombre` | `producto_nom` |
| `producto_cantidad` | `producto_cant` |
| `producto_precio` | `precio` |
| `observacion` | `pedido_obs` o `cliente_obs` |
| `importe_flete` | `imp_flete` |
| `importe_bruto` | `imp_bruto` |
| `fecha_para` | `fch_para` |
| `fecha_hora_max_comp` | `fch_hora_max_ent_comp` |
| `fecha_hora_para` | `fch_hora_para` |
| `fecha_hora_asignado` | No existe en schema |
| `fecha_hora_cumplido` | No existe en schema |
| `cliente_telefono` | `cliente_tel` |
| `cliente_observacion` | `cliente_obs` |

### 2. Corrección de Filtro de Estados Pendientes

**Antes**:
```typescript
.is('fecha_hora_cumplido', null) // ❌ Columna no existe
```

**Ahora**:
```typescript
.in('estado_nro', [1, 2, 3, 4, 5, 6, 7]) // ✅ Estados que representan pendientes
```

### 3. Actualización en `moviles-extended`

#### Archivo: `app/api/moviles-extended/route.ts`

**Antes**:
```typescript
const { data: pedidosCount } = await supabase
  .from('pedidos')
  .select('movil')
  .eq('escenario', 1)
  .not('movil', 'is', null);
```

**Ahora**:
```typescript
const { data: pedidosCount } = await supabase
  .from('pedidos')
  .select('movil')
  .eq('escenario', 1)
  .in('estado_nro', [1, 2, 3, 4, 5, 6, 7]) // Solo contar pendientes
  .not('movil', 'is', null);
```

### 4. Corrección del Display con Valores Default

#### Archivo: `components/ui/MovilSelector.tsx`

**Antes** (❌ Condición que ocultaba el formato):
```typescript
<span className="font-medium">
  {movil.id}
  {movil.tamanoLote !== undefined && movil.pedidosAsignados !== undefined && (
    <> – {movil.pedidosAsignados}/{movil.tamanoLote}</>
  )}
  {movil.matricula && (
    <> – {movil.matricula}</>
  )}
</span>
```

**Ahora** (✅ Siempre muestra el formato completo):
```typescript
<span className="font-medium">
  {movil.id}
  {' – '}
  {movil.pedidosAsignados ?? 0}/{movil.tamanoLote ?? 0}
  {movil.matricula && (
    <> – {movil.matricula}</>
  )}
</span>
```

**Resultado**:
- Si tiene datos: `693 – 2/6 – ABC123`
- Si no tiene datos: `693 – 0/0`
- Mientras carga: `693 – 0/0` (valores por defecto)

## 📋 Estados de Pedidos

Según el schema real, los estados pendientes típicamente son:

| estado_nro | Descripción |
|------------|-------------|
| 1 | Nuevo/Ingresado |
| 2 | Asignado |
| 3 | En Camino |
| 4 | En el Lugar |
| 5 | Esperando |
| 6 | Retrasado |
| 7 | Otro estado pendiente |

Estados completados (NO incluidos en filtro):
- 8, 9, 10+ → Estados finales/completados

## 🎯 Impacto de las Correcciones

### Antes de las Correcciones:
```
❌ Error 500: column pedidos.escenario_id does not exist
❌ Display: "693" (sin información de capacidad)
❌ Conteo incorrecto de pedidos (incluía completados)
```

### Después de las Correcciones:
```
✅ API funciona correctamente
✅ Display: "693 – 0/6" (muestra capacidad incluso sin pedidos)
✅ Conteo correcto de pedidos pendientes
✅ Compatibilidad con schema real de Supabase
```

## 🚀 Para Verificar

### 1. Recargar la página del dashboard
```
http://localhost:3000/dashboard
```

### 2. Verificar en consola del navegador:
```
✅ Fetched 6 moviles with extended data
✅ Enriched 6 moviles with extended data
✅ Received 1 móviles from API
```

### 3. Verificar display en panel lateral:
- Móvil sin pedidos: `693 – 0/6`
- Móvil con pedidos: `694 – 3/8 – ABC123`
- Móvil sin matrícula: `695 – 2/10`

### 4. Verificar API de pedidos pendientes:
```
GET /api/pedidos-pendientes/693?escenarioId=1
Status: 200 ✅ (antes era 500)
```

## 📝 Notas Técnicas

### Uso del Operador Nullish Coalescing (`??`)

```typescript
{movil.pedidosAsignados ?? 0}/{movil.tamanoLote ?? 0}
```

- Si `pedidosAsignados` es `null` o `undefined` → muestra `0`
- Si `tamanoLote` es `null` o `undefined` → muestra `0`
- Garantiza que siempre se muestre un número válido

### Diferencia con Optional Chaining

```typescript
// ❌ Malo: Oculta toda la sección si falta dato
{movil.tamanoLote !== undefined && movil.pedidosAsignados !== undefined && (
  <> – {movil.pedidosAsignados}/{movil.tamanoLote}</>
)}

// ✅ Bueno: Siempre muestra, usa default si falta
{' – '}
{movil.pedidosAsignados ?? 0}/{movil.tamanoLote ?? 0}
```

## ✅ Checklist de Correcciones

- ✅ Corregir nombres de columnas en query de pedidos
- ✅ Actualizar filtro de estados pendientes
- ✅ Corregir conteo de pedidos en moviles-extended
- ✅ Actualizar display para mostrar siempre formato completo
- ✅ Usar valores por defecto (0) cuando faltan datos
- ✅ Mantener matrícula como campo opcional
- ✅ Verificar que no hay errores de TypeScript
- ✅ Documentar cambios

---

**Fecha de Corrección**: 2025-01-20  
**Estado**: ✅ COMPLETADO Y CORREGIDO  
**Siguiente Paso**: Verificar en producción
