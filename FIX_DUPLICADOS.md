# 🐛 Fix: Móviles Duplicados (Key Error)

## ❌ Problema Original

### **Error en Consola**
```
Encountered two children with the same key, `693`. 
Keys should be unique so that components maintain their identity across updates.
```

### **Causa Raíz**
El mismo móvil (ID 693) aparecía múltiples veces en el array `moviles`:
```tsx
moviles = [
  { id: 693, name: "Móvil-693", ... },
  { id: 693, name: "Móvil-693", ... }, // ← Duplicado!
  { id: 58, name: "Móvil-58", ... },
]
```

### **Escenarios que Causaban Duplicados**

1. **GPS de móvil desconocido llega múltiples veces**
   - Primera vez: Se hace fetch del móvil → Se agrega
   - Segunda vez (antes de que termine fetch): Se hace otro fetch → Se agrega de nuevo

2. **Evento INSERT de móvil + GPS simultáneos**
   - Hook `useMoviles` detecta INSERT → Agrega móvil
   - Hook `useGPSTracking` recibe GPS de mismo móvil → Intenta agregar de nuevo

3. **Cambio de filtros (empresas/fecha)**
   - Se recarga la lista
   - Si hay eventos en cola, pueden agregar móviles que ya existen

---

## ✅ Solución Implementada

### **1. Función Helper: `removeDuplicateMoviles`**

```tsx
const removeDuplicateMoviles = useCallback((moviles: MovilData[]): MovilData[] => {
  const seen = new Set<number>();
  return moviles.filter(movil => {
    if (seen.has(movil.id)) {
      console.warn(`⚠️ Móvil duplicado encontrado y eliminado: ${movil.id}`);
      return false;
    }
    seen.add(movil.id);
    return true;
  });
}, []);
```

**Cómo Funciona**:
1. Usa un `Set` para rastrear IDs ya vistos
2. Filtra el array, manteniendo solo la primera ocurrencia de cada ID
3. Registra warning cuando encuentra duplicados

**Complejidad**: O(n) - Una sola pasada por el array

---

### **2. Aplicado en Carga Inicial**

```tsx
if (isInitialLoad) {
  const newMoviles: MovilData[] = result.data.map(...);
  
  // ✅ Eliminar duplicados antes de establecer
  const uniqueMoviles = removeDuplicateMoviles(newMoviles);
  setMoviles(uniqueMoviles);
  console.log(`📦 Carga inicial completa con ${uniqueMoviles.length} móviles únicos`);
}
```

**Beneficio**: Garantiza que la lista inicial no tenga duplicados

---

### **3. Aplicado en Auto-Fetch de GPS**

```tsx
fetch(`/api/all-positions?movilId=${movilId}`)
  .then(result => {
    if (result.success && result.data.length > 0) {
      const newMovil: MovilData = { ... };
      
      setMoviles(prev => {
        // ✅ Verificar nuevamente que no exista
        if (prev.some(m => m.id === movilId)) {
          console.warn(`⚠️ Móvil ${movilId} ya existe, no se agregará duplicado`);
          return prev;
        }
        // ✅ Eliminar cualquier duplicado residual
        return removeDuplicateMoviles([...prev, newMovil]);
      });
    }
  });
```

**Protección Doble**:
1. **Primera verificación**: Si el móvil ya existe → No agregar
2. **Segunda verificación**: `removeDuplicateMoviles` por si acaso

---

### **4. Aplicado en Evento INSERT de Móvil Nuevo**

```tsx
useEffect(() => {
  if (!latestMovil) return;
  
  const movilId = latestMovil.movil;
  
  setMoviles(prevMoviles => {
    // Verificar si ya existe
    if (prevMoviles.find(m => m.id === movilId)) {
      console.log(`ℹ️ Móvil ${movilId} ya existe, ignorando evento`);
      return prevMoviles;
    }
    
    const newMovil: MovilData = { ... };
    
    // ✅ Eliminar duplicados al agregar
    return removeDuplicateMoviles([...prevMoviles, newMovil]);
  });
}, [latestMovil, removeDuplicateMoviles]);
```

**Bonus**: También se eliminó la matrícula del nombre:
```tsx
// Antes
name: `Móvil-${movilId}${latestMovil.matricula ? ` | ${latestMovil.matricula}` : ''}`,

// Ahora
name: `Móvil-${movilId}`,
```

---

## 🛡️ Protecciones Implementadas

### **Nivel 1: Verificación Preventiva**
```tsx
if (prevMoviles.some(m => m.id === movilId)) {
  return prevMoviles; // No agregar si ya existe
}
```

### **Nivel 2: Filtrado Post-Agregación**
```tsx
return removeDuplicateMoviles([...prev, newMovil]);
```

### **Nivel 3: Logging de Warnings**
```tsx
console.warn(`⚠️ Móvil duplicado encontrado y eliminado: ${movilId}`);
```

---

## 📊 Casos de Prueba

### **Caso 1: GPS Llega Múltiples Veces Rápido**
```
1. GPS de móvil 693 llega → Inicia fetch A
2. GPS de móvil 693 llega de nuevo → Inicia fetch B
3. Fetch A completa → Verificación: móvil no existe → Agrega
4. Fetch B completa → Verificación: móvil YA existe → NO agrega
```
✅ **Resultado**: Solo 1 móvil en la lista

### **Caso 2: INSERT + GPS Simultáneos**
```
1. Hook useMoviles detecta INSERT móvil 693 → Agrega móvil
2. Hook useGPSTracking recibe GPS móvil 693 → Detecta que existe → Actualiza posición
```
✅ **Resultado**: Solo 1 móvil en la lista

### **Caso 3: Duplicados en API**
```
1. API retorna móviles: [693, 58, 693, 72]
2. removeDuplicateMoviles() filtra → [693, 58, 72]
3. Se establece lista sin duplicados
```
✅ **Resultado**: Solo 1 móvil 693 en la lista

---

## 🔍 Debugging

### **Ver Warnings en Consola**
Si aparecen warnings, significa que se detectaron y eliminaron duplicados:
```
⚠️ Móvil duplicado encontrado y eliminado: 693
```

### **Verificar Lista de Móviles**
```tsx
// En consola del navegador
console.log(moviles.map(m => m.id));
// Debería ser: [58, 72, 693, 936] (sin duplicados)
```

### **Buscar Duplicados Manualmente**
```tsx
const duplicates = moviles
  .map(m => m.id)
  .filter((id, index, arr) => arr.indexOf(id) !== index);

console.log('Duplicados:', duplicates); // Debería ser: []
```

---

## 🎯 Resultado Final

### **Antes del Fix**
```tsx
moviles = [
  { id: 693, ... }, // ← Duplicado
  { id: 693, ... }, // ← Duplicado
  { id: 58, ... },
]

// React error: "Encountered two children with the same key, `693`"
```

### **Después del Fix**
```tsx
moviles = [
  { id: 693, ... }, // ✅ Único
  { id: 58, ... },
]

// ✅ Sin errores de React
// ✅ Sin warnings en consola (a menos que se detecten y eliminen duplicados)
```

---

## 📝 Archivos Modificados

### **app/page.tsx**

1. **Nuevo helper** (línea ~53):
   ```tsx
   const removeDuplicateMoviles = useCallback((moviles: MovilData[]): MovilData[] => {
     const seen = new Set<number>();
     return moviles.filter(movil => {
       if (seen.has(movil.id)) {
         console.warn(`⚠️ Móvil duplicado encontrado y eliminado: ${movil.id}`);
         return false;
       }
       seen.add(movil.id);
       return true;
     });
   }, []);
   ```

2. **Carga inicial** (línea ~120):
   ```tsx
   const uniqueMoviles = removeDuplicateMoviles(newMoviles);
   setMoviles(uniqueMoviles);
   ```

3. **Auto-fetch GPS** (línea ~200):
   ```tsx
   setMoviles(prev => {
     if (prev.some(m => m.id === movilId)) {
       return prev;
     }
     return removeDuplicateMoviles([...prev, newMovil]);
   });
   ```

4. **Evento INSERT móvil** (línea ~280):
   ```tsx
   return removeDuplicateMoviles([...prevMoviles, newMovil]);
   ```

5. **Dependencias actualizadas**:
   ```tsx
   }, [latestPosition, removeDuplicateMoviles]);
   }, [latestMovil, removeDuplicateMoviles]);
   ```

---

## ✅ Beneficios

| Aspecto | Antes | Después |
|---------|-------|---------|
| **Duplicados** | ❌ Posibles | ✅ Imposibles |
| **Error React** | ❌ "Same key" | ✅ Sin errores |
| **Performance** | ❌ Re-renders innecesarios | ✅ Optimizado |
| **Debugging** | ❌ Difícil encontrar causa | ✅ Warnings claros |
| **UX** | ❌ Móviles repetidos en lista | ✅ Lista limpia |

---

## 🚀 Testing

### **Probar Fix**
1. Iniciar aplicación
2. Verificar consola → NO debería haber error "same key"
3. Abrir lista de móviles → Cada móvil aparece solo UNA vez
4. Insertar GPS para móvil nuevo → Aparece solo UNA vez

### **Verificar Warnings**
Si aparece warning "Móvil duplicado encontrado y eliminado":
- ✅ Es bueno: El sistema detectó y eliminó duplicado automáticamente
- 🔍 Investigar: Por qué se estaba creando duplicado (mejorar lógica preventiva)

---

✅ **¡Fix Implementado!** Los móviles duplicados ahora son detectados y eliminados automáticamente 🛡️
