# 🔧 Fix: Accordion Toggle Behavior

## 📋 Problema

El acordeón de "Capas del Mapa" (Móviles/Pedidos/Services/POIs) no permitía cerrar una solapa ya abierta. Al hacer click en una solapa abierta, no pasaba nada (no se cerraba).

### Comportamiento Anterior ❌
- Click en solapa cerrada → Abre la solapa
- Click en solapa abierta → **No hace nada** (quedaba siempre una abierta)
- Obligatoriamente debía haber siempre una solapa abierta

### Comportamiento Esperado ✅
- Click en solapa cerrada → Abre la solapa
- Click en solapa abierta → **Cierra la solapa** (toggle)
- Permitir que todas las solapas estén cerradas
- Solo una solapa puede estar abierta a la vez (exclusivo)

## 🔍 Análisis del Código

### Archivo Modificado
- **`components/ui/MovilSelector.tsx`**

### Código Original (Línea 138-140)

```typescript
const toggleCategory = (categoryKey: CategoryKey) => {
  setExpandedCategories(new Set([categoryKey])); // Solo una categoría abierta a la vez
};
```

**Problema:** Siempre establece la categoría clickeada como abierta, sin verificar si ya estaba abierta.

### Código Corregido ✅

```typescript
const toggleCategory = (categoryKey: CategoryKey) => {
  // Si la categoría ya está abierta, cerrarla (toggle)
  if (expandedCategories.has(categoryKey)) {
    setExpandedCategories(new Set()); // Cerrar todas
  } else {
    setExpandedCategories(new Set([categoryKey])); // Abrir solo esta categoría
  }
};
```

**Solución:** Verifica si la categoría clickeada ya está abierta. Si está abierta, la cierra (`new Set()`). Si está cerrada, la abre.

### Cambio Adicional (Línea 148)

```typescript
// Determinar qué categoría está activa (puede ser null si todas están cerradas)
const activeCategory = Array.from(expandedCategories)[0] || null;
```

**Antes:** `|| 'moviles'` (forzaba 'moviles' como valor por defecto)  
**Ahora:** `|| null` (permite que no haya ninguna categoría activa)

## ✅ Verificación

### Estado del Acordeón
- `expandedCategories = new Set()` → **Todas cerradas** ✅
- `expandedCategories = new Set(['moviles'])` → **Solo Móviles abierta** ✅
- `expandedCategories = new Set(['pedidos'])` → **Solo Pedidos abierta** ✅

### Lógica de Toggle
1. **Click en solapa cerrada:**
   - `expandedCategories.has(categoryKey)` → `false`
   - **Acción:** `setExpandedCategories(new Set([categoryKey]))` → Abre la solapa
   
2. **Click en solapa abierta:**
   - `expandedCategories.has(categoryKey)` → `true`
   - **Acción:** `setExpandedCategories(new Set())` → Cierra todas las solapas

### Componentes que se Ocultan/Muestran
- **FilterBar:** Se oculta cuando `expandedCategories.size === 0` (línea 288)
- **Contenido de la solapa:** Se oculta cuando `!expandedCategories.has(category.key)` (línea 342)

## 🚀 Despliegue

### Comandos
```bash
# En servidor de producción
cd /var/www/track
git pull origin main
pnpm build
pm2 restart track
```

### Verificación Post-Deploy
1. Abrir Dashboard
2. Click en solapa "Móviles" → Debe abrirse
3. Click nuevamente en "Móviles" → **Debe cerrarse** ✅
4. Click en "Pedidos" → Debe abrirse (y "Móviles" cerrarse)
5. Verificar que FilterBar desaparece cuando todas las solapas están cerradas

## 📝 Notas Técnicas

### Manejo del Estado `null`
- **`activeCategory = null`:** Cuando todas las solapas están cerradas
- **`getContextualFilters()`:** Tiene un caso `default` que maneja `activeCategory = null`
- **FilterBar:** Se oculta completamente con `{expandedCategories.size > 0 && ...}`

### Animación
```typescript
<AnimatePresence mode="wait">
  {expandedCategories.size > 0 && (
    <motion.div
      key={activeCategory}
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ duration: 0.2 }}
    >
      <FilterBar ... />
    </motion.div>
  )}
</AnimatePresence>
```

La animación funciona correctamente porque:
1. `key={activeCategory}` cambia cuando se abre otra categoría → Dispara animación
2. `expandedCategories.size > 0` controla si se muestra o no → Anima entrada/salida

## 🎯 Resultado

✅ **Toggle perfecto:** Click en solapa abierta → Cierra  
✅ **Exclusive accordion:** Solo una solapa abierta a la vez  
✅ **Todas cerradas:** Estado válido (sin solapas abiertas)  
✅ **FilterBar contextual:** Se oculta cuando todas las solapas están cerradas  
✅ **Animación suave:** Transición de 0.2s al abrir/cerrar  

---

**Fecha:** 2025-01-24  
**Archivo:** `components/ui/MovilSelector.tsx`  
**Líneas modificadas:** 138-148  
**Commit:** (pendiente)
