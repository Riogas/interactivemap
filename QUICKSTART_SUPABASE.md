# 🚀 Guía Rápida - Supabase Realtime

## ⚡ Inicio Rápido

### 1. Habilitar Realtime en Supabase (OBLIGATORIO)

Ve a tu proyecto de Supabase: https://supabase.com/dashboard/project/lgniuhelyyizoursmsmi

**Opción A: Desde la UI**
1. Database → Replication
2. Habilita Realtime para:
   - `gps_tracking_extended` ✅
   - `moviles` ✅
   - `pedidos` ✅
   - `empresas_fleteras` ✅

**Opción B: Desde SQL Editor**
```sql
ALTER PUBLICATION supabase_realtime ADD TABLE gps_tracking_extended;
ALTER PUBLICATION supabase_realtime ADD TABLE moviles;
ALTER PUBLICATION supabase_realtime ADD TABLE pedidos;
ALTER PUBLICATION supabase_realtime ADD TABLE empresas_fleteras;
```

### 2. Configurar RLS (Row Level Security)

Ejecuta en SQL Editor:

```sql
-- Habilitar RLS en las tablas
ALTER TABLE gps_tracking_extended ENABLE ROW LEVEL SECURITY;
ALTER TABLE moviles ENABLE ROW LEVEL SECURITY;
ALTER TABLE pedidos ENABLE ROW LEVEL SECURITY;
ALTER TABLE empresas_fleteras ENABLE ROW LEVEL SECURITY;

-- Políticas de lectura pública (ajusta según tus necesidades de seguridad)
CREATE POLICY "Allow public read" ON gps_tracking_extended FOR SELECT USING (true);
CREATE POLICY "Allow public read" ON moviles FOR SELECT USING (true);
CREATE POLICY "Allow public read" ON pedidos FOR SELECT USING (true);
CREATE POLICY "Allow public read" ON empresas_fleteras FOR SELECT USING (true);
```

### 3. Iniciar la Aplicación

```bash
pnpm install
pnpm dev
```

Abre http://localhost:3000

## 🧪 Probar Realtime

### Test 1: Insertar nueva posición GPS

Ejecuta en SQL Editor de Supabase:

```sql
INSERT INTO gps_tracking_extended (
  movil, escenario_id, latitud, longitud, fecha_hora
) VALUES (
  '101', 1, -34.9011, -56.1645, NOW()
);
```

**Resultado esperado**: En la consola del navegador verás:
```
📍 Nueva posición GPS recibida: {...}
```
Y el mapa se actualizará automáticamente.

### Test 2: Actualizar móvil

```sql
UPDATE moviles 
SET matricula = 'TEST-123', updated_at = NOW()
WHERE movil = 101 AND escenario_id = 1;
```

### Test 3: Nuevo pedido

```sql
INSERT INTO pedidos (
  pedido_id, escenario_id, movil, estado, latitud, longitud, 
  cliente_nombre, fecha_para
) VALUES (
  99999, 1, 101, 1, -34.9050, -56.1680, 
  'Cliente Test', CURRENT_DATE
);
```

## 📊 Verificar Estado de Realtime

### En la Consola del Navegador

Busca estos mensajes:
```
✅ Conectado a Realtime GPS Tracking
🔄 Iniciando suscripción GPS Tracking...
📡 Estado de suscripción GPS: SUBSCRIBED
```

### Indicador Visual en la App

En la interfaz verás:
- 🟢 **Verde**: Conectado a Realtime
- 🔴 **Rojo**: Desconectado

## 🔧 Configuración Avanzada

### Filtrar por Empresa

Modifica en tu componente:

```tsx
<RealtimeProvider 
  escenarioId={1} 
  empresaIds={[1, 2, 3]} // Solo estas empresas
>
  {children}
</RealtimeProvider>
```

### Cambiar Frecuencia de Actualización

En `lib/supabase.ts`:

```typescript
realtime: {
  params: {
    eventsPerSecond: 20, // Aumentar a 20 eventos/seg
  },
}
```

## 🐛 Solución de Problemas

### No se reciben actualizaciones

1. **Verifica Realtime habilitado**:
```sql
SELECT * FROM pg_publication_tables 
WHERE pubname = 'supabase_realtime';
```

2. **Verifica RLS**:
```sql
SELECT tablename, policyname FROM pg_policies 
WHERE tablename IN ('gps_tracking_extended', 'moviles', 'pedidos');
```

3. **Revisa consola del navegador** para errores

### Error de WebSocket

- Verifica firewall/antivirus
- Prueba desde otra red
- Verifica que las URLs sean correctas

## 📱 Insertar Datos desde App Móvil

Ejemplo de INSERT desde tu app Android/iOS:

```javascript
// Usando Supabase JS Client
const { data, error } = await supabase
  .from('gps_tracking_extended')
  .insert({
    movil: '101',
    escenario_id: 1,
    latitud: -34.9011,
    longitud: -56.1645,
    fecha_hora: new Date().toISOString(),
    velocidad: 45.5,
    accuracy: 10.0,
    battery_level: 85
  });
```

## 🎯 Próximos Pasos

1. ✅ Verificar que Realtime funciona con los tests anteriores
2. 📱 Conectar tu app móvil para enviar posiciones GPS
3. 🗺️ Monitorear el mapa en tiempo real
4. 📊 Configurar alertas para eventos específicos

## 🆘 Ayuda

Si tienes problemas:
1. Revisa `SUPABASE_REALTIME.md` para documentación completa
2. Verifica logs en Supabase Dashboard → Logs → Realtime
3. Busca errores en la consola del navegador (F12)

## 📚 Recursos

- [Documentación Supabase Realtime](https://supabase.com/docs/guides/realtime)
- [API Reference](https://supabase.com/docs/reference/javascript/subscribe)
- [Ejemplos](https://github.com/supabase/supabase/tree/master/examples)
