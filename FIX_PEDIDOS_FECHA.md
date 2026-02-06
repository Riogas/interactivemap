# 🔧 FIX: Error de Pedidos y Variable 'fecha'

## ✅ Problema 1: `fecha is not defined` - RESUELTO

### Error Original
```
ReferenceError: fecha is not defined
app/dashboard/page.tsx (621:96)
```

### Causa
La variable `fecha` estaba definida dentro del bloque `if (movilesIds.length === 0)` pero se intentaba usar fuera de ese scope en el caso `movilesIds.length > 0`.

### Solución
Movimos la declaración de `fecha` al inicio de la función `fetchPedidosPendientes` para que esté disponible en todo el scope:

```typescript
const fetchPedidosPendientes = useCallback(async (movilesIds: number[]) => {
  try {
    // ✅ MOVIDO AQUÍ: Disponible en todo el scope
    const fecha = selectedDate;
    
    // CASO 1: Sin móviles seleccionados
    if (movilesIds.length === 0) {
      // ...
    }
    
    // CASO 2: Con móviles seleccionados - ahora fecha está disponible
    const pedidosPromises = movilesIds.map(async (movilId) => {
      const response = await fetch(`/api/pedidos-pendientes/${movilId}?escenarioId=1&fecha=${fecha}`);
      // ...
    });
```

---

## 🔍 Problema 2: No se ven pedidos - EN INVESTIGACIÓN

### Debugging Agregado

Se agregó un `useEffect` de debug en `MapView.tsx` para verificar:

```typescript
useEffect(() => {
  if (pedidos && pedidos.length > 0) {
    console.log(`📦 MapView recibió ${pedidos.length} pedidos`);
    const conCoordenadas = pedidos.filter(p => p.latitud && p.longitud);
    console.log(`📍 ${conCoordenadas.length} pedidos tienen coordenadas`);
    if (conCoordenadas.length > 0) {
      console.log('📍 Primer pedido con coordenadas:', conCoordenadas[0]);
    }
  } else {
    console.log('⚠️ MapView: No hay pedidos o array vacío');
  }
}, [pedidos]);
```

### Cosas a Verificar

1. **Abre la consola del navegador** (F12) y busca estos logs:
   - `📦 Fetching pedidos from API...`
   - `✅ Loaded X pedidos`
   - `📦 MapView recibió X pedidos`
   - `📍 X pedidos tienen coordenadas`

2. **Si ves "0 pedidos tienen coordenadas"**:
   - Los pedidos existen pero no tienen `latitud` y `longitud`
   - Verifica la tabla `PEDIDOS` en la base de datos
   - Asegúrate que los campos GPS están poblados

3. **Si ves "MapView: No hay pedidos o array vacío"**:
   - Los pedidos no están llegando desde la API
   - Verifica `/api/pedidos` 
   - Revisa los parámetros de fecha

4. **Si no ves ningún log de pedidos**:
   - La función `fetchPedidos()` no se está ejecutando
   - Verifica el `useEffect` de carga inicial en dashboard

---

## 🧪 Pasos para Diagnosticar

### 1. Verificar Carga de Pedidos
```javascript
// En la consola del navegador:
// Verifica el estado
console.log('Pedidos en memoria:', window.__REACT_DEVTOOLS_GLOBAL_HOOK__);
```

### 2. Probar API Directamente
Abre en el navegador:
```
http://localhost:3000/api/pedidos?escenario=1000&fecha=2026-02-06
```

Deberías ver un JSON con:
```json
{
  "success": true,
  "count": 123,
  "data": [
    {
      "id": 1,
      "latitud": -34.901,
      "longitud": -56.164,
      "cliente_nombre": "..."
    }
  ]
}
```

### 3. Verificar en la Base de Datos
```sql
-- Cuenta pedidos con coordenadas
SELECT COUNT(*) 
FROM PEDIDOS 
WHERE LATITUD IS NOT NULL 
  AND LONGITUD IS NOT NULL
  AND LATITUD <> 0 
  AND LONGITUD <> 0;

-- Ver algunos pedidos con coordenadas
SELECT PEDIDO_ID, LATITUD, LONGITUD, CLIENTE_NOMBRE, ESTADO
FROM PEDIDOS 
WHERE LATITUD IS NOT NULL 
  AND LONGITUD IS NOT NULL
  AND LATITUD <> 0 
  AND LONGITUD <> 0
LIMIT 10;
```

---

## 🚀 Próximos Pasos

1. **Recargar la aplicación** (Ctrl+Shift+R para hard refresh)
2. **Abrir consola** (F12)
3. **Buscar los logs de debug** que agregamos
4. **Reportar qué logs aparecen** para diagnosticar mejor

---

## 📋 Checklist

- [x] Error `fecha is not defined` - CORREGIDO
- [ ] Verificar logs en consola del navegador
- [ ] Confirmar que `/api/pedidos` devuelve datos
- [ ] Verificar que pedidos tienen `latitud` y `longitud`
- [ ] Confirmar que marcadores se renderizan en el mapa

---

## 🔍 Posibles Causas (para investigar)

1. **Pedidos sin coordenadas GPS**: La tabla PEDIDOS no tiene lat/lng poblados
2. **Filtro de fecha muy restrictivo**: No hay pedidos para la fecha seleccionada
3. **Error en API**: `/api/pedidos` está fallando silenciosamente
4. **Props no pasados**: El componente MapView no recibe los pedidos correctamente
5. **Optimización excesiva**: React.memo está bloqueando el render (poco probable)

---

## 💡 Comandos Útiles para Debug

En la consola del navegador:

```javascript
// Ver estado de pedidos
window.pedidos = []  // Si no hay, revisar flujo de datos

// Forzar re-render del mapa
window.location.reload()

// Ver props del MapView en React DevTools
// 1. Instalar React DevTools extension
// 2. Components tab
// 3. Buscar MapView
// 4. Ver props.pedidos
```
