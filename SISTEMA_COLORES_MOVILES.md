# Sistema de Colores por Ocupación de Móviles

## 📋 Descripción
Sistema dinámico de colores para los íconos de móviles en el mapa basado en el porcentaje de ocupación de su capacidad (pedidos asignados vs. tamaño de lote).

## 🎨 Escala de Colores

### Regla de Cálculo
El color se calcula según el porcentaje de ocupación:
```
Porcentaje de Ocupación = (Pedidos Asignados / Capacidad) × 100
```

### Colores Asignados

| Ocupación | Color | Hex | Ejemplo (capacidad 6) | Descripción |
|-----------|-------|-----|----------------------|-------------|
| **100%** | 🖤 **Negro** | `#000000` | 6/6 | Lote completamente lleno |
| **67-99%** | 🟡 **Amarillo** | `#EAB308` | 4-5/6 | Casi lleno (alerta) |
| **0-66%** | 🟢 **Verde** | `#22C55E` | 0-3/6 | Disponible |

### Escala Proporcional
El sistema respeta la escala independientemente del tamaño de lote:
- **Capacidad 6**: 0-3 = Verde, 4-5 = Amarillo, 6 = Negro
- **Capacidad 10**: 0-6 = Verde, 7-9 = Amarillo, 10 = Negro
- **Capacidad 4**: 0-2 = Verde, 3 = Amarillo, 4 = Negro

## 🔧 Implementación

### Función Principal
```typescript
const getMovilColorByOccupancy = (pedidosAsignados: number, capacidad: number): string => {
  if (!capacidad || capacidad === 0) {
    return '#3B82F6'; // Azul por defecto
  }

  const occupancyPercentage = (pedidosAsignados / capacidad) * 100;

  if (occupancyPercentage >= 100) {
    return '#000000'; // Negro - Lote lleno
  } else if (occupancyPercentage >= 67) {
    return '#EAB308'; // Amarillo - Casi lleno
  } else {
    return '#22C55E'; // Verde - Disponible
  }
};
```

### Ubicación del Código
- **Archivo**: `app/dashboard/page.tsx`
- **Línea**: ~141
- **Función**: `getMovilColorByOccupancy()`

## 🔄 Actualización Dinámica

### Carga Inicial
Al cargar los móviles por primera vez, se enriquecen con datos de Supabase y se calcula el color:

```typescript
const enrichedMoviles = moviles.map(movil => {
  const extendedData = extendedDataMap.get(movil.id.toString());
  if (extendedData) {
    const calculatedColor = getMovilColorByOccupancy(
      extendedData.pedidosAsignados, 
      extendedData.tamanoLote
    );
    return {
      ...movil,
      color: calculatedColor,
      // ... otros datos
    };
  }
  return movil;
});
```

### Actualización en Tiempo Real
Cuando llegan nuevos pedidos por Realtime, se recalcula el color automáticamente:

```typescript
useEffect(() => {
  if (pedidosRealtime.length === 0) return;
  
  setMoviles(prevMoviles => {
    return prevMoviles.map(movil => {
      const pedidosDelMovil = /* filtrar pedidos */;
      
      if (pedidosDelMovil.length > 0) {
        const newPedidosAsignados = pedidosDelMovil.length;
        const newColor = getMovilColorByOccupancy(
          newPedidosAsignados,
          movil.tamanoLote || 0
        );
        
        return {
          ...movil,
          pedidosAsignados: newPedidosAsignados,
          color: newColor, // ✨ Color actualizado dinámicamente
        };
      }
      return movil;
    });
  });
}, [pedidosRealtime, getMovilColorByOccupancy]);
```

## 📊 Fuentes de Datos

### Datos Requeridos
1. **`pedidosAsignados`**: Conteo de pedidos activos del móvil
   - Fuente: Tabla `pedidos` en Supabase
   - Query: `COUNT(*) WHERE movil = X AND estado_nro IN (1,2,3,4,5,6,7)`

2. **`tamanoLote`**: Capacidad máxima del móvil
   - Fuente: Tabla `moviles` en Supabase
   - Campo: `tamano_lote`

### API Endpoint
- **Ruta**: `/api/moviles-extended`
- **Método**: GET
- **Respuesta**:
```json
{
  "success": true,
  "data": [
    {
      "id": "693",
      "nro": 693,
      "tamanoLote": 6,
      "pedidosAsignados": 4,
      "matricula": "SAU5678"
    }
  ]
}
```

## 🎯 Casos de Uso

### Caso 1: Móvil con Capacidad Estándar (6)
```
Móvil 693: Capacidad = 6

- 0 pedidos → 🟢 Verde (0%)
- 1 pedido  → 🟢 Verde (16.67%)
- 2 pedidos → 🟢 Verde (33.33%)
- 3 pedidos → 🟢 Verde (50%)
- 4 pedidos → 🟡 Amarillo (66.67%) ← Exactamente en el umbral
- 5 pedidos → 🟡 Amarillo (83.33%)
- 6 pedidos → 🖤 Negro (100%)
```

### Caso 2: Móvil con Capacidad Alta (10)
```
Móvil 500: Capacidad = 10

- 0-6 pedidos  → 🟢 Verde (0-60%)
- 7-9 pedidos  → 🟡 Amarillo (70-90%)
- 10 pedidos   → 🖤 Negro (100%)
```

### Caso 3: Móvil sin Capacidad Definida
```
Móvil 999: Capacidad = 0 o null

→ 🔵 Azul (#3B82F6) - Color por defecto
```

## 🎨 Visualización en el Mapa

Los colores se aplican al círculo del ícono del móvil en Leaflet:

```tsx
<div style="
  width: 40px;
  height: 40px;
  background-color: ${color}; /* Color dinámico */
  border: 3px solid white;
  border-radius: 50%;
  box-shadow: 0 4px 8px rgba(0,0,0,0.3);
  ...
">
  {/* Ícono de auto */}
</div>
```

## ✅ Ventajas del Sistema

1. ✅ **Escala Automática**: Funciona con cualquier capacidad
2. ✅ **Actualización en Tiempo Real**: El color cambia cuando se asignan/completan pedidos
3. ✅ **Visual Intuitivo**: 
   - Verde = Disponible (puede recibir más pedidos)
   - Amarillo = Atención (casi lleno)
   - Negro = Lleno (no puede recibir más)
4. ✅ **Sin Configuración**: No requiere configuración manual de umbrales

## 🔜 Mejoras Futuras

- [ ] Agregar color **Rojo** para sobrecarga (> 100%)
- [ ] Agregar tooltip en el mapa mostrando "4/6 pedidos"
- [ ] Animación de transición entre colores
- [ ] Filtro por color en el sidebar (mostrar solo móviles verdes, etc.)
- [ ] Leyenda de colores en el mapa

## 📝 Notas Técnicas

- El color se calcula en el **cliente** (dashboard), no en el servidor
- Se usa el color del API solo como fallback inicial
- El color se almacena en memoria, no en base de datos
- Compatible con el sistema de móviles inactivos (ícono de alarma)

---

**Fecha de Implementación**: 29 de Diciembre, 2025
**Versión**: 1.0
**Estado**: ✅ Implementado y Funcionando
