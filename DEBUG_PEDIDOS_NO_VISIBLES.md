# 🐛 DEBUG: Pedidos no visibles en el mapa

## ❓ Problema
Los pedidos no se están mostrando en el mapa a pesar de que el código está compilado correctamente.

## 🔍 Logs de debugging agregados

He agregado logs exhaustivos en 3 puntos clave para identificar dónde se pierde la información:

### 1️⃣ Dashboard - Cálculo de pedidosCompletos
**Ubicación:** `app/dashboard/page.tsx` línea ~806

**Logs:**
```
🔷 DASHBOARD: pedidosCompletos calculado
📊 Total pedidos iniciales: X
📊 Total pedidos realtime: X
📊 Total pedidos completos: X
📍 Primer pedido completo: { id, latitud, longitud, cliente, estado }
📍 X pedidos tienen coordenadas válidas
```

**Qué verificar:**
- ¿Hay pedidos en `pedidosIniciales`?
- ¿Hay pedidos en `pedidosRealtime`?
- ¿Los pedidos tienen `latitud` y `longitud` válidas (no null)?

---

### 2️⃣ MapView - Recepción de pedidos
**Ubicación:** `components/map/MapView.tsx` línea ~447

**Logs:**
```
🔍 DEBUG PEDIDOS - useEffect disparado
📦 Pedidos recibidos: [...]
📊 Tipo de pedidos: object
📏 Es array?: true
📦 MapView recibió X pedidos
📍 Primer pedido completo: {...}
📍 Latitud del primer pedido: -34.xxxxx
📍 Longitud del primer pedido: -56.xxxxx
📍 X pedidos tienen coordenadas
📍 Primer pedido con coordenadas: { id, latitud, longitud, cliente, estado }
🎯 Pedidos que pasarán el filtro para renderizar: X
```

**Qué verificar:**
- ¿MapView está recibiendo los pedidos?
- ¿Los pedidos tienen coordenadas válidas?
- ¿Cuántos pedidos pasan el filtro?

---

### 3️⃣ MapView - Renderizado de markers
**Ubicación:** `components/map/MapView.tsx` línea ~1841

**Logs:**
```
🎨 RENDER: Pedidos a renderizar: X
🎨 RENDER: Primer pedido a renderizar: { id, lat, lng, estado }
```

**Qué verificar:**
- ¿Se están intentando renderizar los markers?
- ¿Hay algún error en la consola durante el render?

---

## 📋 Checklist de debugging

### Paso 1: Abrir consola del navegador
1. Presiona `F12`
2. Ve a la pestaña **Console**
3. Busca los logs con emojis (🔷, 📦, 🔍, 🎨)

### Paso 2: Verificar carga de pedidos
Busca estos logs en orden:

```
✅ Debe aparecer: "🔷 DASHBOARD: pedidosCompletos calculado"
✅ Debe aparecer: "📊 Total pedidos completos: X" (donde X > 0)
✅ Debe aparecer: "📍 X pedidos tienen coordenadas válidas" (donde X > 0)
```

**Si NO aparecen:**
- Los pedidos no se están cargando desde la API
- Revisa la pestaña **Network** y busca llamadas a `/api/pedidos`
- Verifica la respuesta de la API

### Paso 3: Verificar recepción en MapView
Busca este log:

```
✅ Debe aparecer: "🔍 DEBUG PEDIDOS - useEffect disparado"
✅ Debe aparecer: "📦 MapView recibió X pedidos" (donde X > 0)
✅ Debe aparecer: "🎯 Pedidos que pasarán el filtro para renderizar: X" (donde X > 0)
```

**Si NO aparecen:**
- Los pedidos no están llegando a MapView
- Verifica que `pedidosCompletos` se esté pasando correctamente al componente `<MapView>`

### Paso 4: Verificar renderizado
Busca este log:

```
✅ Debe aparecer: "🎨 RENDER: Pedidos a renderizar: X" (donde X > 0)
```

**Si NO aparece:**
- Hay un problema en el render del componente
- Verifica si hay errores de React en la consola

### Paso 5: Verificar coordenadas
Los pedidos deben tener coordenadas válidas en formato:
- `latitud`: número entre -90 y 90
- `longitud`: número entre -180 y 180

**Ejemplo válido:**
```json
{
  "id": 12345,
  "latitud": -34.9011,
  "longitud": -56.1645,
  "cliente_nombre": "Cliente Test"
}
```

---

## 🔧 Posibles causas y soluciones

### Causa 1: API no devuelve pedidos
**Síntoma:** No aparece log "📊 Total pedidos completos: X"

**Solución:**
1. Abre la pestaña **Network** en DevTools
2. Busca la llamada a `/api/pedidos?escenario=1000&fecha=YYYY-MM-DD`
3. Verifica que devuelva `data: [...]` con pedidos
4. Si no devuelve pedidos, revisa:
   - ¿La fecha es correcta?
   - ¿El escenario es 1000?
   - ¿Hay pedidos en la base de datos para esa fecha?

### Causa 2: Pedidos sin coordenadas
**Síntoma:** "📊 Total pedidos completos: 50" pero "📍 0 pedidos tienen coordenadas válidas"

**Solución:**
1. Los pedidos en la base de datos no tienen `latitud` y `longitud`
2. Ejecuta este query en Supabase:
```sql
SELECT id, cliente_nombre, latitud, longitud 
FROM pedidos 
WHERE escenario = 1000 
  AND fch_para = '2026-02-06'
LIMIT 10;
```
3. Si `latitud` o `longitud` son `NULL`, necesitas geocodificar las direcciones

### Causa 3: Coordenadas fuera de rango
**Síntoma:** Hay coordenadas pero no se ven en el mapa

**Solución:**
1. Verifica que las coordenadas estén en el rango correcto:
   - Uruguay: latitud entre -30 y -35, longitud entre -53 y -58
2. Verifica el nivel de zoom del mapa
3. Intenta hacer zoom out para ver si los markers están lejos

### Causa 4: OptimizedMarker no renderiza
**Síntoma:** Logs muestran "🎨 RENDER: Pedidos a renderizar: X" pero no se ven

**Solución:**
1. Verifica que `createPedidoIconByEstado()` esté funcionando
2. Agrega este log en la consola del navegador:
```javascript
// En la consola del navegador
console.log('Markers en el mapa:', document.querySelectorAll('.leaflet-marker-icon').length);
```
3. Si devuelve 0, hay un problema con Leaflet

---

## 📊 Ejemplo de salida esperada (TODO OK)

```
🔷 DASHBOARD: pedidosCompletos calculado
📊 Total pedidos iniciales: 45
📊 Total pedidos realtime: 3
📊 Total pedidos completos: 48
📍 Primer pedido completo: { id: 12345, latitud: -34.9011, longitud: -56.1645, cliente: "Cliente Test", estado: 1 }
📍 48 pedidos tienen coordenadas válidas

🔍 DEBUG PEDIDOS - useEffect disparado
📦 Pedidos recibidos: [Object, Object, ...]
📊 Tipo de pedidos: object
📏 Es array?: true
📦 MapView recibió 48 pedidos
📍 Primer pedido completo: { id: 12345, ... }
📍 Latitud del primer pedido: -34.9011
📍 Longitud del primer pedido: -56.1645
📍 48 pedidos tienen coordenadas
📍 Primer pedido con coordenadas: { id: 12345, latitud: -34.9011, longitud: -56.1645, cliente: "Cliente Test", estado: 1 }
🎯 Pedidos que pasarán el filtro para renderizar: 48

🎨 RENDER: Pedidos a renderizar: 48
🎨 RENDER: Primer pedido a renderizar: { id: 12345, lat: -34.9011, lng: -56.1645, estado: 1 }
```

---

## 🎯 Próximos pasos

1. **Ejecuta la aplicación** con `npm run dev`
2. **Abre la consola** del navegador (F12)
3. **Copia y pega TODOS los logs** que veas (con los emojis)
4. **Envíame los logs** para que pueda identificar exactamente dónde está el problema

---

## 📝 Notas técnicas

### Estructura de PedidoSupabase
```typescript
interface PedidoSupabase {
  id: number;
  escenario: number;
  cliente_nombre: string | null;
  latitud: number | null;  // ⚠️ Puede ser null
  longitud: number | null; // ⚠️ Puede ser null
  estado_nro: number | null;
  producto_nom: string | null;
  // ... otros campos
}
```

### Flujo de datos
```
API (/api/pedidos) 
  → pedidosIniciales (useState)
  → pedidosCompletos (useMemo) 
  → MapView (prop pedidos)
  → Filter (p.latitud && p.longitud)
  → OptimizedMarker (render)
```

---

**Fecha:** 2026-02-06  
**Archivo:** DEBUG_PEDIDOS_NO_VISIBLES.md
