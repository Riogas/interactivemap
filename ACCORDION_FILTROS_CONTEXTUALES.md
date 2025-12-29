# Comportamiento Accordion con Filtros Contextuales

## ✅ Implementación Completada (2025-01-20)

### 1. **Comportamiento Accordion - Solo una Categoría Abierta**

Se modificó la función `toggleCategory` para que solo permita una categoría abierta a la vez:

```typescript
const toggleCategory = (categoryKey: CategoryKey) => {
  setExpandedCategories(new Set([categoryKey])); // Solo una categoría abierta
};
```

**Antes**: Múltiples categorías podían estar abiertas simultáneamente
**Ahora**: Al abrir una categoría, se cierra automáticamente la anterior

### 2. **Filtros Contextuales Dinámicos**

Los filtros ahora cambian automáticamente según la categoría activa:

```typescript
// Determinar categoría activa
const activeCategory = Array.from(expandedCategories)[0] || 'moviles';

// Obtener filtros según categoría
const contextualFilters = getContextualFilters();
```

### 3. **Configuración de Filtros por Categoría**

#### 🚗 **Móviles**
- **Búsqueda**: Por número de móvil
- **Filtro**: Capacidad (Todas | 1-3 | 4-6 | 7-10 | 10+ garrafas)
- **Ordenamiento**: Por número de móvil ascendente
- **Formato display**: `NroMovil – PedAsignados/Capacidad – NroCelular`
  - Ejemplo: `693 – 2/6 – 098753444`

#### 🔧 **Services**
- **Búsqueda**: Por número de service
- **Filtro**: Atraso (Todos | Sin atraso | 1-3 días | 4-7 días | 7+ días)
- **Ordenamiento**: Por cercanía a fecha de entrega
- **Formato display**: `Nro: 123 – Tel: 098753444 - Fecha Entrega: 30/12/2025`

#### 📦 **Pedidos**
- **Búsqueda**: Por número de pedido
- **Filtros**: 
  - Atraso (Todos | Sin atraso | 1-3 días | 4-7 días | 7+ días)
  - Tipo de Servicio (Todos | Urgente | Especial)
- **Ordenamiento**: Por atraso descendente
- **Formato display**: `Nro: 123 – Tel: 098753444 - Fecha Entrega: 30/12/2025`

#### 📍 **Puntos de Interés**
- **Búsqueda**: Alfabética
- **Filtros**: Ninguno
- **Ordenamiento**: Alfabético
- **Características especiales**:
  - Creables por usuarios (nombre, observaciones, icono)
  - POIs públicos definidos por administradores
  - Click muestra nombre y observaciones

## 🎨 Implementación Técnica

### FilterBar Contextual Único

Un solo componente FilterBar que se adapta según la categoría:

```tsx
<FilterBar
  searchValue={contextualFilters.searchValue}
  onSearchChange={contextualFilters.onSearchChange}
  searchPlaceholder={contextualFilters.searchPlaceholder}
  filters={contextualFilters.filters}
  onFilterChange={contextualFilters.onFilterChange}
/>
```

### Estados Separados por Categoría

```typescript
// Búsquedas
const [movilesSearch, setMovilesSearch] = useState('');
const [pedidosSearch, setPedidosSearch] = useState('');
const [servicesSearch, setServicesSearch] = useState('');
const [poisSearch, setPoisSearch] = useState('');

// Filtros
const [movilesFilters, setMovilesFilters] = useState<MovilFilters>({ 
  capacidad: 'all' 
});
const [servicesFilters, setServicesFilters] = useState<ServiceFilters>({ 
  atraso: 'all' 
});
const [pedidosFilters, setPedidosFilters] = useState<PedidoFilters>({ 
  atraso: 'all', 
  tipoServicio: 'all' 
});
```

### Función `getContextualFilters()`

Retorna la configuración completa según la categoría activa:

```typescript
const getContextualFilters = () => {
  switch (activeCategory) {
    case 'moviles':
      return {
        searchValue: movilesSearch,
        onSearchChange: setMovilesSearch,
        searchPlaceholder: 'Buscar móvil por número...',
        filters: [/* Filtro de capacidad */],
        onFilterChange: (filterId, value) => { /* Handler */ }
      };
    
    case 'services':
      return {
        searchValue: servicesSearch,
        onSearchChange: setServicesSearch,
        searchPlaceholder: 'Buscar service...',
        filters: [/* Filtro de atraso */],
        onFilterChange: (filterId, value) => { /* Handler */ }
      };
    
    case 'pedidos':
      return {
        searchValue: pedidosSearch,
        onSearchChange: setPedidosSearch,
        searchPlaceholder: 'Buscar pedido...',
        filters: [/* Filtros de atraso y tipo */],
        onFilterChange: (filterId, value) => { /* Handler */ }
      };
    
    case 'pois':
      return {
        searchValue: poisSearch,
        onSearchChange: setPoisSearch,
        searchPlaceholder: 'Buscar punto de interés...',
        filters: [], // Sin filtros
        onFilterChange: () => {}
      };
  }
};
```

## 📋 Tipos TypeScript

### Filtros Definidos

```typescript
export interface MovilFilters {
  capacidad: 'all' | '1-3' | '4-6' | '7-10' | '10+';
}

export interface ServiceFilters {
  atraso: 'all' | 'sin_atraso' | '1-3_dias' | '4-7_dias' | '7+_dias';
}

export interface PedidoFilters {
  atraso: 'all' | 'sin_atraso' | '1-3_dias' | '4-7_dias' | '7+_dias';
  tipoServicio: 'all' | 'urgente' | 'especial' | 'normal';
}
```

## 🎯 Comportamiento UX

### Flujo de Usuario

1. **Usuario abre categoría "Móviles"**
   - Se muestra FilterBar con filtro de capacidad
   - Puede buscar y filtrar móviles
   
2. **Usuario hace click en "Services"**
   - Se cierra automáticamente "Móviles"
   - Se abre "Services"
   - FilterBar cambia a mostrar filtro de atraso
   - Búsqueda y filtros de móviles se mantienen en estado pero no visibles

3. **Usuario vuelve a "Móviles"**
   - Se cierra "Services"
   - Se abre "Móviles"
   - FilterBar vuelve a filtro de capacidad
   - Mantiene la búsqueda y filtros anteriores de móviles

### Animaciones

```tsx
<AnimatePresence mode="wait">
  <motion.div
    key={activeCategory}
    initial={{ height: 0, opacity: 0 }}
    animate={{ height: 'auto', opacity: 1 }}
    exit={{ height: 0, opacity: 0 }}
    transition={{ duration: 0.2 }}
  >
```

- **Transición suave** entre categorías
- **mode="wait"**: Espera a que termine la animación de salida antes de iniciar la de entrada
- **key={activeCategory}**: Fuerza remontaje al cambiar de categoría

## ✅ Estado Actual

### Completado
- ✅ Comportamiento accordion (solo una categoría abierta)
- ✅ Filtros contextuales dinámicos por categoría
- ✅ Estados separados por categoría (búsquedas y filtros)
- ✅ Animaciones suaves entre categorías
- ✅ Configuración completa de filtros para todas las categorías
- ✅ Tipos TypeScript correctos

### En Progreso
- 🔄 Categoría Móviles funcional con datos reales
- ⏳ Implementar datos para Services
- ⏳ Implementar datos para Pedidos
- ⏳ Implementar funcionalidad de creación de POIs

### Pendiente
- ⏳ Actualizar formato de display de móviles (necesita campos adicionales)
- ⏳ Implementar filtro de capacidad funcional
- ⏳ Implementar ordenamiento por fecha de entrega (Services)
- ⏳ Implementar ordenamiento por atraso (Pedidos)
- ⏳ Crear UI de creación de POIs
- ⏳ Implementar distinción POIs públicos/privados

## 🔧 Próximos Pasos Técnicos

### 1. Actualizar Tipo `Movil` 
```typescript
interface MovilExtended extends Movil {
  pedidosAsignados: number;
  capacidadMovil: number;
  numeroCelular: string;
}
```

### 2. Crear Tipos para Otras Categorías
```typescript
interface ServiceData {
  id: number;
  nroService: string;
  nroTelCliente: string;
  fechaEntregaComprometida: Date;
  diasAtraso: number;
}

interface PedidoData {
  id: number;
  nroPedido: string;
  nroTelCliente: string;
  fechaEntregaComprometida: Date;
  diasAtraso: number;
  tipoServicio: 'urgente' | 'especial' | 'normal';
  movilAsignado?: number;
}

interface PuntoInteresData {
  id: number;
  nombre: string;
  observaciones: string;
  icono: string;
  lat: number;
  lng: number;
  tipo: 'publico' | 'privado';
  creadoPor?: string; // Usuario que lo creó
}
```

### 3. Implementar Lógica de Filtrado por Categoría

Cada categoría necesitará su propio `useMemo` para filtrar y ordenar:

```typescript
const filteredServices = useMemo(() => {
  let result = [...services];
  
  // Filtrar por búsqueda
  if (servicesSearch.trim()) {
    result = result.filter(s => s.nroService.includes(servicesSearch));
  }
  
  // Filtrar por atraso
  if (servicesFilters.atraso !== 'all') {
    result = result.filter(s => {
      const dias = s.diasAtraso;
      switch (servicesFilters.atraso) {
        case 'sin_atraso': return dias <= 0;
        case '1-3_dias': return dias >= 1 && dias <= 3;
        case '4-7_dias': return dias >= 4 && dias <= 7;
        case '7+_dias': return dias > 7;
        default: return true;
      }
    });
  }
  
  // Ordenar por cercanía a fecha de entrega
  return result.sort((a, b) => 
    new Date(a.fechaEntregaComprometida).getTime() - 
    new Date(b.fechaEntregaComprometida).getTime()
  );
}, [services, servicesSearch, servicesFilters]);
```

---

**Última actualización**: 2025-01-20  
**Estado**: ✅ Accordion y filtros contextuales completados
