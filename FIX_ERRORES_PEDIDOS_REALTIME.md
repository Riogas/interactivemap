# 🐛 Correcciones de Errores - Pedidos Realtime

## Errores corregidos

### ❌ Error 1: `selectedDate.toISOString is not a function`

**Causa**: `selectedDate` es un `string`, no un objeto `Date`

**Solución**: 
```typescript
// ❌ Antes (incorrecto)
const fecha = selectedDate.toISOString().split('T')[0];

// ✅ Ahora (correcto)
const fecha = selectedDate; // Ya es un string 'YYYY-MM-DD'
```

**Ubicación**: `app/dashboard/page.tsx` línea 407

---

### ❌ Error 2: `CHANNEL_ERROR` en suscripción Realtime

**Causa posible**: 
1. Realtime no está habilitado en la tabla `pedidos`
2. Falta configuración del canal
3. Problemas de permisos en Supabase

**Soluciones aplicadas**:

#### 1. Configuración mejorada del canal
```typescript
channel = supabase
  .channel(channelName, {
    config: {
      broadcast: { self: false },
      presence: { key: '' },
    },
  })
```

#### 2. Logs mejorados para debugging
```typescript
console.log('🔄 Iniciando suscripción a pedidos pendientes...', {
  escenarioId,
  movilIds,
  hasMovilFilter: movilIds && movilIds.length > 0
});
```

#### 3. Mensajes de error más informativos
```typescript
console.error('💡 Verifica que Realtime esté habilitado en Supabase para la tabla pedidos');
console.error('💡 Ejecuta: ALTER PUBLICATION supabase_realtime ADD TABLE pedidos;');
```

---

## ✅ Verificación paso a paso

### **1. Verifica que Realtime está habilitado**

En Supabase SQL Editor, ejecuta:

```sql
-- Verificar que la tabla pedidos está en la publicación
SELECT schemaname, tablename 
FROM pg_publication_tables 
WHERE tablename = 'pedidos' AND pubname = 'supabase_realtime';
```

**Resultado esperado:**
```
schemaname | tablename
-----------+----------
public     | pedidos
```

**Si NO aparece**, ejecuta:
```sql
ALTER PUBLICATION supabase_realtime ADD TABLE pedidos;
```

---

### **2. Verifica permisos de la tabla**

```sql
-- Verificar permisos
SELECT grantee, privilege_type 
FROM information_schema.table_privileges 
WHERE table_name = 'pedidos' 
  AND grantee IN ('anon', 'authenticated', 'service_role');
```

**Debe incluir al menos**: `SELECT` para `anon` o `authenticated`

**Si faltan permisos**, ejecuta:
```sql
-- Otorgar permisos de lectura
GRANT SELECT ON pedidos TO anon;
GRANT SELECT ON pedidos TO authenticated;
```

---

### **3. Verifica Row Level Security (RLS)**

```sql
-- Verificar si RLS está habilitado
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE tablename = 'pedidos';
```

**Si `rowsecurity = true`**, asegúrate de tener políticas que permitan SELECT:

```sql
-- Ver políticas existentes
SELECT * FROM pg_policies WHERE tablename = 'pedidos';
```

**Si no hay políticas o son muy restrictivas**, puedes desactivar RLS temporalmente:
```sql
-- ⚠️ SOLO PARA DESARROLLO - Desactiva RLS
ALTER TABLE pedidos DISABLE ROW LEVEL SECURITY;
```

O crear una política permisiva:
```sql
-- Política para permitir lectura a todos
CREATE POLICY "Permitir lectura a todos" ON pedidos
  FOR SELECT
  USING (true);
```

---

### **4. Reinicia el dashboard**

1. **Detén el servidor** (Ctrl+C en la terminal)
2. **Inicia de nuevo**: `pnpm dev`
3. **Abre el dashboard**: http://localhost:3001/dashboard
4. **Abre DevTools (F12)** → Console
5. **Busca estos mensajes**:

**✅ Éxito:**
```
🔄 Iniciando suscripción a pedidos pendientes... {escenarioId: 1, ...}
📡 Creando canal de Realtime: pedidos-realtime-1-...
📡 Estado de suscripción pedidos: SUBSCRIBED
✅ Conectado a Realtime Pedidos
📦 Cargando TODOS los pedidos pendientes del día
✅ Encontrados X pedidos pendientes en total
```

**❌ Si sigue fallando:**
```
❌ Error en suscripción de pedidos: CHANNEL_ERROR
💡 Verifica que Realtime esté habilitado en Supabase para la tabla pedidos
💡 Ejecuta: ALTER PUBLICATION supabase_realtime ADD TABLE pedidos;
```

---

## 🧪 Prueba final

### **Test 1: Ver pedidos sin selección**
1. Abre dashboard
2. NO selecciones ningún móvil
3. Deberías ver marcadores 📦 naranja en el mapa
4. Console: `📦 Cargando TODOS los pedidos pendientes del día`

### **Test 2: Insertar pedido en tiempo real**

En Supabase SQL Editor:

```sql
INSERT INTO pedidos (
    pedido_id, escenario_id, movil, estado,
    latitud, longitud, zona, tipo,
    producto_nombre, prioridad,
    fecha_para, fecha_hora_para,
    cliente_nombre, cliente_direccion
) VALUES (
    777777, 1, 58, 1,
    '-34.9011120', '-56.1645320', 5, 'Pedidos',
    'Test Realtime', 5,
    CURRENT_DATE, NOW() + INTERVAL '2 hours',
    'Cliente Test', 'Dirección Test'
);
```

**Resultado esperado**:
- En la consola: `📦 Nuevo pedido recibido: {pedido_id: 777777, ...}`
- En el mapa: Aparece nuevo marcador 📦 sin recargar

### **Test 3: Marcar como cumplido**

```sql
UPDATE pedidos 
SET fecha_hora_cumplido = NOW()
WHERE pedido_id = 777777;
```

**Resultado esperado**:
- En la consola: `📦 Pedido actualizado: {...}`
- En la consola: `✅ Pedido 777777 cumplido - Eliminado de pendientes`
- En el mapa: El marcador desaparece

### **Test 4: Limpiar**

```sql
DELETE FROM pedidos WHERE pedido_id = 777777;
```

---

## 🔍 Debugging adicional

### **Si los pedidos no aparecen en el mapa:**

1. **Verifica la respuesta del API**:
```javascript
// En la consola del navegador
fetch('/api/pedidos-pendientes?escenarioId=1')
  .then(r => r.json())
  .then(console.log);
```

2. **Verifica el estado de móviles**:
```javascript
// En React DevTools
// Busca el componente DashboardContent
// Inspecciona el state: moviles
// Verifica que tengan la propiedad `pendientes`
```

3. **Verifica que showPendientes está activo**:
```javascript
// En la consola del navegador
// Busca: showPendientes: true
```

---

## 📝 Checklist de verificación

```
□ Ejecutar: ALTER PUBLICATION supabase_realtime ADD TABLE pedidos;
□ Verificar permisos: GRANT SELECT ON pedidos TO anon;
□ Verificar/desactivar RLS si es necesario
□ Reiniciar servidor de desarrollo
□ Abrir dashboard y verificar consola
□ Buscar: "✅ Conectado a Realtime Pedidos"
□ Buscar: "✅ Encontrados X pedidos pendientes"
□ Verificar marcadores 📦 en el mapa
□ Probar INSERT en Supabase
□ Verificar que aparece sin recargar
□ Probar UPDATE (cumplir pedido)
□ Verificar que desaparece automáticamente
```

---

## 🎯 Estado actual

| Componente | Estado | Notas |
|------------|--------|-------|
| API /pedidos-pendientes | ✅ | Sin filtro estricto de fecha |
| fetchPedidosPendientes | ✅ | Corregido error de Date |
| MapView | ✅ | Muestra pedidos de todos los móviles |
| Hook usePedidosRealtime | ✅ | Configuración mejorada |
| Logs de debugging | ✅ | Mensajes informativos agregados |
| Realtime en Supabase | ⚠️ | Requiere verificación manual |

---

## 🚀 Siguiente paso

**Ejecuta en Supabase SQL Editor:**

```sql
-- 1. Habilitar Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE pedidos;

-- 2. Otorgar permisos
GRANT SELECT ON pedidos TO anon;
GRANT SELECT ON pedidos TO authenticated;

-- 3. Desactivar RLS (solo para desarrollo)
ALTER TABLE pedidos DISABLE ROW LEVEL SECURITY;

-- 4. Verificar
SELECT schemaname, tablename 
FROM pg_publication_tables 
WHERE tablename = 'pedidos';
```

Luego reinicia el dashboard y prueba! 🎉
