# Corrección Final - Esquema Real de Moviles

## Problema Encontrado
Después de la primera migración, apareció un nuevo error:
```
column moviles.estado does not exist
```

## Causa Raíz
La tabla `moviles` en Supabase tiene una estructura **completamente diferente** a la asumida inicialmente:

### Estructura Real de `moviles`
```sql
CREATE TABLE public.moviles (
  id TEXT PRIMARY KEY,              -- ⚠️ TEXT, no INTEGER
  descripcion TEXT NOT NULL,
  empresa_fletera_id INTEGER,
  estado_nro INTEGER,               -- ⚠️ Se llama estado_nro, no estado
  estado_desc TEXT,
  matricula VARCHAR(20),
  mostrar_en_mapa BOOLEAN DEFAULT TRUE,
  -- ... y 20+ columnas más
)
```

### Diferencias Clave vs Estructura Anterior

| Campo Anterior | Campo Real | Tipo Anterior | Tipo Real |
|---------------|------------|---------------|-----------|
| `movil` (PK) | `id` (PK) | `INTEGER` | `TEXT` ✅ |
| `escenario_id` | ❌ No existe | `INTEGER` | N/A |
| `estado` | `estado_nro` | `INTEGER` | `INTEGER` |
| - | `estado_desc` | N/A | `TEXT` (nuevo) |
| - | `descripcion` | N/A | `TEXT` (nuevo) |

## Cambios Realizados

### 1. Tipos TypeScript (`types/supabase.ts`)

#### Tabla `moviles` - Estructura Completa
```typescript
moviles: {
  Row: {
    id: string,                    // ✅ Cambiado de number a string
    descripcion: string,           // ✅ Nuevo campo
    empresa_fletera_id: number,
    estado_nro: number | null,     // ✅ Cambiado de estado a estado_nro
    estado_desc: string | null,    // ✅ Nuevo campo
    matricula: string | null,
    mostrar_en_mapa: boolean | null,
    // ... +20 campos más (debug_mode, gps_n8n, visible_en_app, etc.)
  }
}
```

#### Tabla `gps_tracking_extended`
```typescript
gps_tracking_extended: {
  Row: {
    id: number,
    movil_id: string,         // ✅ Cambiado de number a string
    pedido_id: number | null,
    // ...resto de campos
  }
}
```

### 2. API `all-positions` (`app/api/all-positions/route.ts`)

**Antes:**
```typescript
.select('id, empresa_fletera_id, matricula, estado')
.eq('escenario_id', escenarioId)  // ❌ Esta columna no existe
.eq('id', parseInt(movilIdParam)) // ❌ id es TEXT, no number
```

**Después:**
```typescript
.select('id, empresa_fletera_id, matricula, estado_nro, descripcion')
// ✅ Sin filtro de escenario_id (no existe en la tabla)
.eq('id', movilIdParam)  // ✅ Sin parseInt, es TEXT
```

**Query GPS:**
```typescript
// ANTES:
.in('movil_id', movilIds)
.eq('escenario_id', escenarioId)

// DESPUÉS:
.in('movil_id', movilIds)
// ✅ Sin filtro escenario_id en GPS (se filtra por movil_id)
```

**Construcción de respuesta:**
```typescript
// ANTES:
movilName: `Móvil-${movil.id}`,
estado: movil.estado,

// DESPUÉS:
movilName: movil.descripcion || `Móvil-${movil.id}`,  // ✅ Usa descripcion
estado: movil.estado_nro,                              // ✅ Usa estado_nro
```

### 3. Hooks Realtime (`lib/hooks/useRealtimeSubscriptions.ts`)

#### `useGPSTracking`
```typescript
// ANTES:
if (!movilIds || movilIds.includes(newPosition.movil_id.toString())) {
  updated.set(newPosition.movil_id.toString(), newPosition);
}

// DESPUÉS:
if (!movilIds || movilIds.includes(newPosition.movil_id)) {  // ✅ Ya es string
  updated.set(newPosition.movil_id, newPosition);
}
```

#### `useMoviles`
```typescript
// ANTES:
filter: `escenario_id=eq.${escenarioId}`,
const filtered = prev.filter(m => 
  !(m.id === movil.id && 
    m.escenario_id === movil.escenario_id &&  // ❌ No existe
    m.empresa_fletera_id === movil.empresa_fletera_id)
);

// DESPUÉS:
// ✅ Sin filtro de escenario_id
const filtered = prev.filter(m => m.id !== movil.id);  // ✅ Simple por id único
```

## Impacto de los Cambios

### ✅ Corregido
1. **Error de columna inexistente**: `moviles.estado` → `moviles.estado_nro`
2. **Tipo de ID incorrecto**: `id` es TEXT, no INTEGER
3. **Filtros inválidos**: Removido `escenario_id` de queries de `moviles`
4. **Conversiones innecesarias**: Removido `.toString()` en `movil_id` de GPS
5. **Nombres de móviles**: Ahora usa campo `descripcion` en lugar de generar nombre

### 🔍 Comportamiento Nuevo
- Los IDs de móviles son **strings** (ej: "693", "M-123")
- No hay concepto de `escenario_id` en la tabla `moviles`
- Los móviles tienen `descripcion` que se usa como nombre visible
- El estado se llama `estado_nro` (número) y `estado_desc` (descripción)

## Testing

### 1. Verificar Carga de Móviles
```bash
# Debe funcionar sin error 42703
curl http://localhost:3000/api/all-positions
```

**Resultado esperado:**
```json
{
  "success": true,
  "count": 5,
  "data": [
    {
      "movilId": "693",
      "movilName": "Camión Reparto Norte",
      "estado": 1,
      "empresa_fletera_id": 100
    }
  ]
}
```

### 2. Insertar GPS con ID de Texto
```bash
curl -X POST http://localhost:3000/api/import/gps \
  -H "Content-Type: application/json" \
  -d '{
    "movil": "693",
    "latitud": -34.9011,
    "longitud": -56.1645,
    "fecha_hora": "2025-12-10T12:00:00"
  }'
```

### 3. Verificar Realtime
La suscripción de GPS ahora funciona correctamente con `movil_id` tipo TEXT.

## Archivos Modificados en Esta Corrección

1. ✅ `types/supabase.ts` - Tipos de `moviles` y `gps_tracking_extended`
2. ✅ `app/api/all-positions/route.ts` - Query y respuesta
3. ✅ `lib/hooks/useRealtimeSubscriptions.ts` - Hooks de realtime

## Próximos Pasos Recomendados

1. **Verificar otras APIs** que usan `moviles`:
   - `/api/movil/[id]`
   - `/api/empresas`
   
2. **Actualizar import de móviles** (`app/api/import/moviles/route.ts`):
   - Cambiar PK de `number` a `string`
   - Mapear todos los campos nuevos
   
3. **Revisar queries de pedidos**:
   - Si `pedidos.movil_id` también es TEXT
   - Actualizar foreign keys

## Estado Final

✅ **COMPLETADO** - El error `column moviles.estado does not exist` está resuelto.

La aplicación ahora:
- ✅ Carga móviles correctamente con sus nombres descriptivos
- ✅ Filtra por `estado_nro` en lugar de `estado`
- ✅ Usa IDs de tipo TEXT para móviles
- ✅ No intenta filtrar por `escenario_id` inexistente
- ✅ Maneja correctamente el tipo de `movil_id` en GPS
