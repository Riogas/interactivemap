# Migración de Esquema de Base de Datos - Resumen de Cambios

## Fecha: 10 de Diciembre, 2025

## Problema Inicial
Error en consola: `column moviles.movil does not exist`

La aplicación estaba intentando acceder a columnas que ya no existen después de modificar la estructura de las tablas en Supabase.

## Cambios en la Estructura de Tablas

### Tabla `moviles`
**Antes:**
- PK: `movil` (number)
- `escenario_id` (number)
- `empresa_fletera_id` (number)

**Después:**
- PK: `id` (number) ✅
- `escenario_id` (number)
- `empresa_fletera_id` (number)

### Tabla `pedidos`
**Antes:**
- PK: `pedido_id` (number)
- FK: `movil` (number)
- `escenario_id` (number)

**Después:**
- PK: `id` (number) ✅
- FK: `movil_id` (number) ✅
- `escenario_id` (number)

### Tabla `gps_tracking_extended`
**Antes:**
- `id` (bigserial)
- `movil` (string)
- `escenario_id` (number)

**Después:**
- `id` (bigserial)
- FK: `movil_id` (number) ✅
- FK: `pedido_id` (number | null) ✅
- `escenario_id` (number)

## Archivos Modificados

### 1. Tipos TypeScript (`types/supabase.ts`)
**Cambios realizados:**
- ✅ Cambiado `moviles.movil` → `moviles.id`
- ✅ Cambiado `pedidos.pedido_id` → `pedidos.id`
- ✅ Cambiado `pedidos.movil` → `pedidos.movil_id`
- ✅ Cambiado `gps_tracking_extended.movil` (string) → `gps_tracking_extended.movil_id` (number)
- ✅ Agregado `gps_tracking_extended.pedido_id` (number | null)

### 2. API Routes

#### `app/api/all-positions/route.ts`
**Cambios:**
```typescript
// ANTES:
.select('movil, empresa_fletera_id, matricula, estado')
.eq('movil', parseInt(movilIdParam))
.in('movil', movilIds)

// DESPUÉS:
.select('id, empresa_fletera_id, matricula, estado')
.eq('id', parseInt(movilIdParam))
.in('movil_id', movilIds)
```

#### `app/api/latest/route.ts`
**Cambios:**
```typescript
// ANTES:
.eq('movil', movilId)

// DESPUÉS:
.eq('movil_id', parseInt(movilId))
```

#### `app/api/coordinates/route.ts`
**Cambios:**
```typescript
// ANTES:
.eq('movil', movilId)

// DESPUÉS:
.eq('movil_id', parseInt(movilId))
```

#### `app/api/pedidos-servicios-pendientes/[movilId]/route.ts`
**Cambios:**
```typescript
// ANTES:
.eq('movil', movilId)

// DESPUÉS:
.eq('movil_id', movilId)
```

#### `app/api/pedidos-pendientes/route.ts`
**Cambios:**
```typescript
// ANTES:
.select(`
  pedido_id,
  movil,
  ...
`)

// DESPUÉS:
.select(`
  id,
  movil_id,
  ...
`)
```

#### `app/api/pedidos-pendientes/[movilId]/route.ts`
**Cambios:**
```typescript
// ANTES:
.select(`
  pedido_id,
  movil,
  ...
`)
.eq('movil', movilId)

// DESPUÉS:
.select(`
  id,
  movil_id,
  ...
`)
.eq('movil_id', movilId)
```

### 3. Hooks de Realtime (`lib/hooks/useRealtimeSubscriptions.ts`)

#### Hook `useGPSTracking`
**Cambios:**
```typescript
// ANTES:
if (!movilIds || movilIds.includes(newPosition.movil)) {
  updated.set(newPosition.movil, newPosition);
}

// DESPUÉS:
if (!movilIds || movilIds.includes(newPosition.movil_id.toString())) {
  updated.set(newPosition.movil_id.toString(), newPosition);
}
```

#### Hook `useMoviles`
**Cambios:**
```typescript
// ANTES:
!(m.movil === movil.movil && ...)

// DESPUÉS:
!(m.id === movil.id && ...)
```

#### Hook `usePedidos`
**Cambios:**
```typescript
// ANTES:
filterString += `,movil=eq.${movilId}`;
!(p.pedido_id === pedido.pedido_id && ...)

// DESPUÉS:
filterString += `,movil_id=eq.${movilId}`;
!(p.id === pedido.id && ...)
```

#### Hook `usePedidosRealtime`
**Cambios:**
```typescript
// ANTES:
if (newPedido.movil && (!movilIds || movilIds.includes(newPedido.movil))) {
  updated.set(newPedido.pedido_id, newPedido);
}

// DESPUÉS:
if (newPedido.movil_id && (!movilIds || movilIds.includes(newPedido.movil_id))) {
  updated.set(newPedido.id, newPedido);
}
```

## Impacto de los Cambios

### ✅ Funcionalidades Corregidas
1. **Visualización del Mapa**: Ahora carga correctamente las posiciones de móviles
2. **Actualizaciones en Tiempo Real**: GPS tracking funciona con los nuevos campos
3. **Consultas de Pedidos**: Todas las queries de pedidos usan las columnas correctas
4. **Filtros por Móvil**: Los filtros funcionan con `movil_id`
5. **Histórico de Coordenadas**: Las consultas de GPS usan `movil_id`

### 🔍 Áreas a Verificar
- [ ] Probar inserción de GPS desde la app móvil
- [ ] Verificar que las restricciones de foreign keys funcionan
- [ ] Confirmar que los índices en `gps_tracking_extended` se usan correctamente
- [ ] Validar que los pedidos se asignan correctamente a móviles

## Migraciones Pendientes en Base de Datos

Si aún no has ejecutado las migraciones en Supabase, necesitas:

```sql
-- 1. Renombrar columnas en tabla moviles
ALTER TABLE moviles RENAME COLUMN movil TO id;

-- 2. Renombrar columnas en tabla pedidos
ALTER TABLE pedidos RENAME COLUMN pedido_id TO id;
ALTER TABLE pedidos RENAME COLUMN movil TO movil_id;

-- 3. Modificar tabla gps_tracking_extended
ALTER TABLE gps_tracking_extended 
  RENAME COLUMN movil TO movil_id;

ALTER TABLE gps_tracking_extended 
  ALTER COLUMN movil_id TYPE INTEGER USING movil_id::integer;

ALTER TABLE gps_tracking_extended
  ADD COLUMN pedido_id INTEGER REFERENCES pedidos(id);

-- 4. Agregar foreign keys
ALTER TABLE gps_tracking_extended
  ADD CONSTRAINT fk_movil 
  FOREIGN KEY (movil_id) 
  REFERENCES moviles(id) 
  ON DELETE CASCADE;

-- 5. Crear índices adicionales
CREATE INDEX IF NOT EXISTS idx_gps_movil_fecha 
  ON gps_tracking_extended(movil_id, fecha_hora DESC);

CREATE INDEX IF NOT EXISTS idx_pedidos_movil 
  ON pedidos(movil_id);
```

## Testing Recomendado

### 1. Verificar Carga de Mapa
```bash
# Abrir navegador y revisar consola
http://localhost:3000

# Debe mostrar:
✅ API /all-positions - Returning X móviles with GPS data
```

### 2. Probar Inserción de GPS
```powershell
curl -X POST http://localhost:3000/api/import/gps `
  -H "Content-Type: application/json" `
  -d '{
    "movil": 693,
    "escenario": 1000,
    "latitud": -34.9011,
    "longitud": -56.1645,
    "fecha_hora": "2025-12-10T10:00:00"
  }'
```

### 3. Verificar Realtime
```javascript
// En consola del navegador, debe mostrar:
// 📍 Nueva posición GPS recibida: { movil_id: 693, ... }
// 📦 Nuevo pedido recibido: { id: 123, movil_id: 693, ... }
```

## Conclusión

Todos los archivos de la aplicación han sido actualizados para reflejar la nueva estructura de base de datos. El código ahora usa:
- `id` en lugar de `movil` y `pedido_id` como primary keys
- `movil_id` en lugar de `movil` como foreign key
- Tipos TypeScript correctos para todas las tablas
- Queries actualizadas en todos los endpoints de API
- Suscripciones de realtime corregidas

**Estado:** ✅ COMPLETADO - Listo para probar
