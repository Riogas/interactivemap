# 🎯 Lógica de Visualización de Pedidos - Implementada

## 📋 Comportamiento del sistema

### **Regla 1: Con móviles seleccionados**
```
Usuario selecciona Móvil 58 y Móvil 251
  ↓
Sistema carga pedidos de ambos móviles
  ↓
Mapa muestra SOLO pedidos de móviles 58 y 251
  ↓
Realtime escucha cambios SOLO de esos móviles
```

### **Regla 2: Sin móviles seleccionados**
```
Usuario no selecciona ningún móvil (o deselecciona todos)
  ↓
Sistema carga TODOS los pedidos del día actual
  ↓
Mapa muestra TODOS los pedidos pendientes
  ↓
Realtime escucha cambios de TODOS los pedidos
```

---

## 🔧 Implementación técnica

### **1. Nuevo endpoint: `/api/pedidos-pendientes`**

**Ubicación**: `app/api/pedidos-pendientes/route.ts`

**Funcionalidad**:
- Obtiene TODOS los pedidos pendientes del día
- Filtra por `escenario_id` y `fecha`
- Solo pedidos NO cumplidos (`fecha_hora_cumplido IS NULL`)
- Solo pedidos con coordenadas
- Ordena por prioridad y fecha

**Uso**:
```typescript
GET /api/pedidos-pendientes?escenarioId=1&fecha=2025-12-01
```

**Respuesta**:
```json
{
  "escenarioId": 1,
  "fecha": "2025-12-01",
  "pedidos": [...],
  "total": 15
}
```

---

### **2. Modificación en `fetchPedidosPendientes`**

**Ubicación**: `app/dashboard/page.tsx`

**Lógica actualizada**:

```typescript
const fetchPedidosPendientes = useCallback(async (movilesIds: number[]) => {
  // CASO 1: Sin móviles seleccionados (movilesIds = [])
  if (movilesIds.length === 0) {
    // Llama a /api/pedidos-pendientes (todos)
    // Agrupa pedidos por móvil
    // Actualiza estado de TODOS los móviles con sus pedidos
  }
  
  // CASO 2: Con móviles seleccionados
  else {
    // Llama a /api/pedidos-pendientes/[movilId] para cada uno
    // Actualiza solo los móviles seleccionados
  }
}, [selectedDate]);
```

---

### **3. Actualización del useEffect**

**Antes**:
```typescript
if (selectedMoviles.length > 0) {
  fetchPedidosPendientes(selectedMoviles);
  setShowPendientes(true);
} else {
  setShowPendientes(false); // ❌ Ocultaba pedidos
}
```

**Ahora**:
```typescript
if (selectedMoviles.length > 0) {
  fetchPedidosPendientes(selectedMoviles);
  setShowPendientes(true);
} else {
  fetchPedidosPendientes([]); // ✅ Carga TODOS
  setShowPendientes(true);     // ✅ Muestra TODOS
}
```

---

### **4. Hook de Realtime**

Ya estaba configurado correctamente:

```typescript
usePedidosRealtime(
  1, // escenarioId
  selectedMoviles.length > 0 ? selectedMoviles : undefined
  //                                            ↑
  //                              undefined = escucha TODOS
)
```

---

## 🎨 Flujo visual

### **Escenario A: Usuario abre dashboard**
```
1. Dashboard carga
2. selectedMoviles = []
3. fetchPedidosPendientes([]) se ejecuta
4. Carga TODOS los pedidos del día desde /api/pedidos-pendientes
5. Mapa muestra todos los pedidos con marcadores 📦
6. Realtime escucha cambios de TODOS los pedidos
```

### **Escenario B: Usuario selecciona Móvil 58**
```
1. Usuario hace click en Móvil 58
2. selectedMoviles = [58]
3. fetchPedidosPendientes([58]) se ejecuta
4. Carga solo pedidos del móvil 58
5. Mapa muestra SOLO pedidos del móvil 58
6. Realtime escucha cambios SOLO del móvil 58
```

### **Escenario C: Usuario selecciona Móvil 58 y 251**
```
1. Usuario hace click en Móvil 58 y 251
2. selectedMoviles = [58, 251]
3. fetchPedidosPendientes([58, 251]) se ejecuta
4. Carga pedidos de ambos móviles en paralelo
5. Mapa muestra pedidos de 58 y 251
6. Realtime escucha cambios de 58 y 251
```

### **Escenario D: Usuario deselecciona todos**
```
1. Usuario deselecciona todos los móviles
2. selectedMoviles = []
3. fetchPedidosPendientes([]) se ejecuta
4. Vuelve a cargar TODOS los pedidos del día
5. Mapa muestra todos los pedidos nuevamente
6. Realtime escucha TODOS los pedidos
```

---

## 📊 Datos que se muestran

### **Información de cada pedido**:
```typescript
{
  tipo: 'PEDIDO',
  id: 100234,
  clinom: 'Ferretería Los Andes',
  fecha: '2025-12-01',
  x: -34.9011120,  // latitud
  y: -56.1645320,  // longitud
  estado: 1,
  zona: 5,
  producto_nombre: 'Garrafa 13kg',
  prioridad: 3,
  movilId: 251  // Referencia al móvil asignado
}
```

---

## 🧪 Cómo probar

### **Test 1: Visualización inicial**
1. Abre http://localhost:3001/dashboard
2. NO selecciones ningún móvil
3. **Resultado esperado**: 
   - Ves TODOS los pedidos del día en el mapa 📦
   - Consola: "📦 Cargando TODOS los pedidos del día actual"

### **Test 2: Selección de un móvil**
1. Click en "Móvil 58"
2. **Resultado esperado**:
   - Solo ves pedidos del móvil 58
   - Los demás pedidos desaparecen
   - Consola: "📦 Cargando pedidos para móviles seleccionados: [58]"

### **Test 3: Selección múltiple**
1. Mantén Ctrl + Click en "Móvil 251"
2. **Resultado esperado**:
   - Ves pedidos de móvil 58 Y 251
   - Consola: "📦 Cargando pedidos para móviles seleccionados: [58, 251]"

### **Test 4: Deselección**
1. Click fuera o deselecciona todos
2. **Resultado esperado**:
   - Vuelves a ver TODOS los pedidos del día
   - Consola: "📦 Cargando TODOS los pedidos del día actual"

### **Test 5: Realtime con inserción**
1. Con dashboard abierto (sin móviles seleccionados)
2. Ejecuta en Supabase:
```sql
INSERT INTO pedidos (
    pedido_id, escenario_id, movil, estado,
    latitud, longitud, zona, tipo,
    producto_nombre, prioridad,
    fecha_para, fecha_hora_para,
    cliente_nombre, cliente_direccion
) VALUES (
    888888, 1, 100, 1,
    '-34.9011120', '-56.1645320', 5, 'Pedidos',
    'Producto Test RT', 5,
    CURRENT_DATE, NOW() + INTERVAL '2 hours',
    'Cliente Test RT', 'Dirección Test'
);
```
3. **Resultado esperado**:
   - Aparece nuevo marcador 📦 sin recargar
   - Consola: "📦 Nuevo pedido recibido: {pedido_id: 888888, ...}"

### **Test 6: Realtime con cumplimiento**
```sql
UPDATE pedidos 
SET fecha_hora_cumplido = NOW()
WHERE pedido_id = 888888;
```
**Resultado esperado**:
- El marcador desaparece automáticamente
- Consola: "✅ Pedido 888888 cumplido - Eliminado de pendientes"

---

## 📈 Ventajas del nuevo sistema

### ✅ **Vista completa por defecto**
- Al abrir el dashboard ves todos los pedidos del día
- Útil para dispatchers que necesitan visión general

### ✅ **Filtrado flexible**
- Puedes enfocarte en uno o varios móviles
- Fácil volver a la vista completa

### ✅ **Realtime inteligente**
- Escucha solo lo que necesitas según el contexto
- Reduce carga cuando filtras por móvil específico

### ✅ **Agrupación automática**
- Los pedidos se agrupan por móvil en el estado
- Cada móvil "sabe" cuántos pedidos tiene pendientes

---

## 🎯 Casos de uso

### **Dispatcher general**
```
Abre dashboard → Ve TODOS los pedidos
Identifica zonas con alta carga
Decide reasignaciones
```

### **Supervisor de móvil específico**
```
Selecciona Móvil 58
Ve solo pedidos de ese móvil
Monitorea progreso en tiempo real
```

### **Coordinador de zona**
```
Filtra por empresa fletera
Ve pedidos de todos los móviles de esa empresa
Optimiza rutas
```

---

## 🔍 Logs de debugging

### **Consola del navegador muestra**:

```javascript
// Al cargar dashboard sin selección
📦 Cargando TODOS los pedidos del día actual
✅ Encontrados 15 pedidos pendientes en total
📦 Actualizando móviles con pedidos agrupados

// Al seleccionar móvil 58
📦 Cargando pedidos para móviles seleccionados: [58]
✅ Móvil 58: 2 pedidos pendientes

// Al seleccionar móvil 58 y 251
📦 Cargando pedidos para móviles seleccionados: [58, 251]
✅ Móvil 58: 2 pedidos pendientes
✅ Móvil 251: 1 pedidos pendientes

// Realtime - Nuevo pedido
📦 Nuevo pedido recibido: {pedido_id: 999999, movil: 58, ...}

// Realtime - Pedido cumplido
📦 Pedido actualizado: {pedido_id: 100234, ...}
✅ Pedido 100234 cumplido - Eliminado de pendientes
```

---

## ✅ Resumen ejecutivo

| Característica | Estado | Descripción |
|----------------|--------|-------------|
| Vista completa por defecto | ✅ | Muestra todos los pedidos del día |
| Filtrado por móvil | ✅ | Selecciona uno o varios móviles |
| Selección múltiple | ✅ | Ctrl+Click para múltiples |
| Deselección | ✅ | Vuelve a vista completa |
| Realtime todos | ✅ | Escucha cambios de todos los pedidos |
| Realtime filtrado | ✅ | Escucha solo móviles seleccionados |
| Agrupación por móvil | ✅ | Pedidos agrupados automáticamente |
| Indicador de cantidad | ✅ | Cada móvil muestra su contador |

---

## 🎉 ¡Todo listo!

El sistema ahora funciona con la siguiente lógica:

1. **Por defecto**: Muestra TODOS los pedidos del día
2. **Con selección**: Muestra solo pedidos de móviles seleccionados
3. **Realtime**: Actualiza automáticamente según el contexto
4. **Flexible**: Fácil cambiar entre vistas

¡Pruébalo! 🚀
