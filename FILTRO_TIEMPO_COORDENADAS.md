# ⏱️ Filtro de Tiempo de Coordenadas

## 🐛 Problema Detectado

Los móviles con coordenadas muy antiguas seguían apareciendo en el mapa, aunque el usuario había configurado un **Retraso Máximo de 5 minutos** en las preferencias.

### Ejemplo del Problema:
```
⚙️ Configuración: Retraso Máximo = 5 minutos
🕐 Hora actual: 4:00 PM

❌ Móviles visibles con coordenadas antiguas:
- Móvil-52: 03:29 PM (31 minutos de retraso)
- Móvil-54: 02:17 PM (103 minutos de retraso)
- Móvil-105: 03:56 PM (4 minutos de retraso) ✅
- Móvil-555: 04:00 PM (0 minutos de retraso) ✅
```

**Resultado:** Solo los móviles 105 y 555 deberían estar visibles.

---

## ✅ Solución Implementada

### 1. Función de Filtro por Preferencias

Se creó la función `filterMovilesByPreferences()` que aplica dos filtros:

```typescript
const filterMovilesByPreferences = useCallback((moviles: MovilData[]): MovilData[] => {
  return moviles.filter(movil => {
    // Filtro 1: Si no hay posición actual
    if (!movil.currentPosition) {
      return !preferences.showActiveMovilesOnly;
    }

    // Filtro 2: Verificar retraso máximo de coordenadas
    const coordDate = new Date(movil.currentPosition.fechaInsLog);
    const now = new Date();
    const minutesDiff = (now.getTime() - coordDate.getTime()) / (1000 * 60);
    
    // Si excede el retraso máximo configurado, no mostrar
    if (minutesDiff > preferences.maxCoordinateDelayMinutes) {
      console.log(`⏱️ Móvil ${movil.id} filtrado: coordenada de hace ${Math.round(minutesDiff)} minutos (máximo: ${preferences.maxCoordinateDelayMinutes})`);
      return false;
    }

    return true;
  });
}, [preferences.showActiveMovilesOnly, preferences.maxCoordinateDelayMinutes]);
```

---

## 🎯 Cómo Funciona

### Paso 1: Obtener Tiempo de la Coordenada
```typescript
const coordDate = new Date(movil.currentPosition.fechaInsLog);
```
**Ejemplo:** `2025-11-28 15:29:00` → Fecha/hora de la última coordenada

### Paso 2: Calcular Diferencia en Minutos
```typescript
const now = new Date(); // 2025-11-28 16:00:00
const minutesDiff = (now.getTime() - coordDate.getTime()) / (1000 * 60);
```
**Cálculo:**
- `now.getTime()` = 1732813200000 ms
- `coordDate.getTime()` = 1732811340000 ms
- `diferencia` = 1860000 ms
- `minutesDiff` = 1860000 / 60000 = **31 minutos**

### Paso 3: Comparar con Límite Configurado
```typescript
if (minutesDiff > preferences.maxCoordinateDelayMinutes) {
  // 31 minutos > 5 minutos → FILTRAR
  return false;
}
```

### Paso 4: Log para Debug
```typescript
console.log(`⏱️ Móvil 52 filtrado: coordenada de hace 31 minutos (máximo: 5)`);
```

---

## 📍 Dónde se Aplica el Filtro

### 1. En el Mapa (MapView)
```tsx
<MapView 
  moviles={filterMovilesByPreferences(moviles).filter(m => selectedMoviles.length === 0 || selectedMoviles.includes(m.id))}
  ...
/>
```

**Resultado:** Solo se muestran marcadores de móviles con coordenadas recientes.

### 2. En la Lista del Sidebar (MovilSelector)
```tsx
<MovilSelector
  moviles={filterMovilesByPreferences(moviles)}
  ...
/>
```

**Resultado:** La lista de móviles en el sidebar también se filtra.

---

## 🎨 Ejemplo Visual

### Antes (sin filtro):
```
Sidebar:              Mapa:
┌─────────────┐      ┌──────────────────┐
│ ● Móvil-52  │      │   🚗52 (antigua) │
│ ● Móvil-54  │      │   🚗54 (antigua) │
│ ● Móvil-105 │      │   🚗105 (OK)     │
│ ● Móvil-555 │      │   🚗555 (OK)     │
└─────────────┘      └──────────────────┘
Total: 4 móviles     Total: 4 marcadores
```

### Después (con filtro de 5 min):
```
Sidebar:              Mapa:
┌─────────────┐      ┌──────────────────┐
│ ● Móvil-105 │      │   🚗105 (OK)     │
│ ● Móvil-555 │      │   🚗555 (OK)     │
└─────────────┘      └──────────────────┘
Total: 2 móviles     Total: 2 marcadores
```

---

## ⚙️ Configuración del Filtro

### Abrir Preferencias
1. Click en ⚙️ en el Navbar
2. Buscar "⏱️ Retraso Máximo de Coordenadas"
3. Ajustar el slider

### Valores Disponibles
```
Mínimo: 5 minutos   → Muy estricto (solo recientes)
Por defecto: 30 min → Balanceado
Máximo: 120 min     → Permisivo (ver historial)
```

### Casos de Uso

#### Caso 1: Monitoreo en Tiempo Real
```
⏱️ Retraso Máximo: 5 minutos
🎯 Objetivo: Solo ver móviles activos ahora mismo
✅ Resultado: Lista muy corta, solo móviles con GPS reciente
```

#### Caso 2: Vista Reciente
```
⏱️ Retraso Máximo: 30 minutos
🎯 Objetivo: Ver actividad de la última media hora
✅ Resultado: Balanceado entre precisión y cobertura
```

#### Caso 3: Historial Extendido
```
⏱️ Retraso Máximo: 120 minutos
🎯 Objetivo: Ver recorridos de las últimas 2 horas
✅ Resultado: Muchos móviles, útil para análisis
```

---

## 🔄 Interacción con Otras Preferencias

### Mostrar Solo Móviles Activos + Retraso Máximo
```typescript
// Filtro 1: Si no hay posición actual
if (!movil.currentPosition) {
  return !preferences.showActiveMovilesOnly; // true = ocultar, false = mostrar
}

// Filtro 2: Verificar retraso
if (minutesDiff > preferences.maxCoordinateDelayMinutes) {
  return false; // Ocultar si excede el tiempo
}
```

**Ejemplo:**
```
Preferencias:
- Mostrar Solo Móviles Activos: ON
- Retraso Máximo: 10 minutos

Móviles:
- Móvil-100: SIN COORDENADAS → ❌ Filtrado (por "solo activos")
- Móvil-200: Coordenada de hace 5 min → ✅ Mostrado
- Móvil-300: Coordenada de hace 15 min → ❌ Filtrado (por retraso)
```

---

## 🧪 Testing

### Verificar que Funciona

1. **Abrir Preferencias**
   ```
   ⚙️ Click en el ícono de preferencias
   ```

2. **Configurar Retraso Mínimo**
   ```
   ⏱️ Retraso Máximo: 5 minutos
   💾 Guardar
   ```

3. **Verificar en Consola**
   ```
   F12 → Consola
   Buscar mensajes: "⏱️ Móvil X filtrado: coordenada de hace Y minutos"
   ```

4. **Verificar Visualmente**
   ```
   ✅ Solo móviles con hora reciente están visibles
   ✅ Lista del sidebar tiene menos móviles
   ✅ Mapa solo muestra marcadores recientes
   ```

5. **Aumentar Retraso**
   ```
   ⏱️ Retraso Máximo: 120 minutos
   💾 Guardar
   ✅ Aparecen más móviles (con coordenadas más antiguas)
   ```

---

## 📊 Logs en Consola

### Ejemplo de Salida
```
⏱️ Móvil 52 filtrado: coordenada de hace 31 minutos (máximo: 5)
⏱️ Móvil 54 filtrado: coordenada de hace 103 minutos (máximo: 5)
⏱️ Móvil 873 filtrado: coordenada de hace 67 minutos (máximo: 5)
```

**Interpretación:**
- Cada log muestra un móvil que fue ocultado
- Muestra cuántos minutos de antigüedad tiene la coordenada
- Muestra el límite configurado

---

## 🎯 Beneficios

### Para el Usuario
- ✅ **Control preciso** sobre qué tan recientes deben ser las coordenadas
- ✅ **Interfaz más limpia** - solo móviles relevantes
- ✅ **Flexibilidad** - ajustar según necesidad del momento

### Para el Rendimiento
- ✅ **Menos marcadores** en el mapa → más rápido
- ✅ **Menos items** en el sidebar → scroll más fluido
- ✅ **Menos datos** procesados en cada render

### Para el Negocio
- ✅ **Información más precisa** - solo datos actuales
- ✅ **Mejor toma de decisiones** - ver lo que está pasando AHORA
- ✅ **Menos confusión** - no mezclar datos antiguos con recientes

---

## 🔧 Implementación Técnica

### Archivos Modificados

| Archivo | Cambio |
|---------|--------|
| `app/page.tsx` | Agregada función `filterMovilesByPreferences()` |
| `app/page.tsx` | Aplicado filtro en `<MapView moviles={...}>` |
| `app/page.tsx` | Aplicado filtro en `<MovilSelector moviles={...}>` |

### Dependencias
```typescript
// Hook de preferencias
const { preferences } = useUserPreferences();

// Valores usados:
preferences.maxCoordinateDelayMinutes  // 5-120 minutos
preferences.showActiveMovilesOnly      // true/false
```

### Performance
- **Complejidad:** O(n) - un solo loop sobre los móviles
- **Memoización:** `useCallback` para evitar recrear la función
- **Dependencias:** Solo se recalcula si cambian las preferencias

---

## 🐛 Troubleshooting

### Los móviles antiguos siguen apareciendo

**Causa:** Preferencias no guardadas o no cargadas

**Solución:**
1. Abrir preferencias (⚙️)
2. Verificar que el slider está en el valor correcto
3. Click en "Guardar"
4. Recargar la página (F5)
5. Revisar localStorage:
   ```javascript
   console.log(localStorage.getItem('userPreferences'));
   ```

### El filtro es demasiado estricto

**Causa:** Valor de retraso muy bajo

**Solución:**
- Aumentar "Retraso Máximo" a 30 o 60 minutos
- Si trabajas en zona rural con poca señal, usa 120 minutos

### No aparece ningún móvil

**Causa:** Retraso muy bajo + móviles sin GPS reciente

**Solución:**
- Aumentar el retraso a 60-120 minutos
- Desactivar "Mostrar Solo Móviles Activos"
- Verificar que los móviles estén enviando GPS

---

## ✅ Checklist de Verificación

- [ ] Abrir preferencias muestra slider de retraso
- [ ] Cambiar slider actualiza el valor mostrado
- [ ] Guardar preferencias aplica el filtro inmediatamente
- [ ] Móviles con coordenadas antiguas desaparecen del mapa
- [ ] Móviles con coordenadas antiguas desaparecen del sidebar
- [ ] Logs en consola muestran móviles filtrados
- [ ] Aumentar el retraso hace aparecer más móviles
- [ ] Disminuir el retraso oculta más móviles
- [ ] Preferencias persisten después de F5
- [ ] No hay errores en consola

---

## 📚 Archivos Relacionados

```
app/
└── page.tsx                    ← Función filterMovilesByPreferences()

components/
├── ui/
│   ├── PreferencesModal.tsx   ← Slider de configuración
│   └── MovilSelector.tsx      ← Recibe móviles filtrados
└── map/
    └── MapView.tsx            ← Recibe móviles filtrados
```

---

## 🎉 Resultado Final

**Antes:**
- ❌ Móviles con coordenadas de hace horas visibles
- ❌ Confusión entre datos actuales y antiguos
- ❌ No hay control del usuario

**Después:**
- ✅ Solo móviles con coordenadas recientes visibles
- ✅ Control total sobre el umbral de tiempo
- ✅ Logs claros de qué se filtra y por qué
- ✅ Interfaz más limpia y precisa

**¡Ahora el filtro de tiempo funciona correctamente! ⏱️✨**
