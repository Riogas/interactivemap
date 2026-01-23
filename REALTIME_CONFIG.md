# 🔄 Configuración de Realtime en Supabase

## ⚠️ Error: CHANNEL_ERROR en pedidos

Si ves este error en la consola:
```
❌ Error en suscripción de pedidos: "CHANNEL_ERROR"
```

Significa que la tabla `pedidos` no está habilitada para Realtime en Supabase.

---

## ✅ Solución: Habilitar Realtime

### Opción 1: Desde Supabase Dashboard (UI)

1. Ve a tu proyecto en [https://supabase.com](https://supabase.com)
2. **Database** → **Replication** (en el menú lateral)
3. Busca la tabla `pedidos`
4. Haz click en el toggle para habilitarla
5. Guarda los cambios

### Opción 2: Ejecutar SQL

1. Ve a **SQL Editor** en Supabase
2. Ejecuta este comando:

```sql
-- Habilitar Realtime para pedidos
ALTER PUBLICATION supabase_realtime ADD TABLE pedidos;

-- Verificar que se agregó
SELECT schemaname, tablename 
FROM pg_publication_tables 
WHERE pubname = 'supabase_realtime'
ORDER BY tablename;
```

---

## 📋 Tablas que DEBEN tener Realtime habilitado

Para que la aplicación funcione completamente, habilita Realtime en estas tablas:

```sql
-- Habilitar Realtime en todas las tablas necesarias
ALTER PUBLICATION supabase_realtime ADD TABLE pedidos;
ALTER PUBLICATION supabase_realtime ADD TABLE moviles;
ALTER PUBLICATION supabase_realtime ADD TABLE gps_tracking_extended;
ALTER PUBLICATION supabase_realtime ADD TABLE empresas_fleteras;
```

---

## 🔍 Verificar qué tablas tienen Realtime activo

```sql
SELECT schemaname, tablename 
FROM pg_publication_tables 
WHERE pubname = 'supabase_realtime'
ORDER BY tablename;
```

---

## ⚙️ Desactivar temporalmente Realtime (si hay problemas)

Si quieres desactivar el Realtime para pedidos temporalmente:

### En `app/dashboard/page.tsx`, línea ~67:

**Comentar estas líneas:**
```typescript
// const {
//   pedidos: pedidosRealtime,
//   isConnected: isPedidosConnected,
//   error: pedidosError,
// } = usePedidosRealtime(
//   1, // escenario
//   selectedMoviles.length > 0 ? selectedMoviles : undefined,
//   handlePedidoRealtimeUpdate
// );
```

**Y reemplazar con:**
```typescript
const pedidosRealtime: PedidoSupabase[] = [];
const isPedidosConnected = false;
const pedidosError = null;
```

---

## 📊 Impacto de NO tener Realtime

Si NO habilitas Realtime para `pedidos`:
- ❌ No verás actualizaciones de pedidos en tiempo real
- ✅ La aplicación seguirá funcionando normalmente
- ✅ Los pedidos se actualizarán al recargar la página
- ✅ Todas las demás funcionalidades funcionan

---

## 🚀 Beneficios de tener Realtime activo

- ✅ Ver nuevos pedidos instantáneamente sin recargar
- ✅ Ver cambios de estado en tiempo real
- ✅ Sincronización entre múltiples usuarios
- ✅ Notificaciones en vivo de cambios

---

## 🔧 Troubleshooting

### Error persiste después de habilitar Realtime

1. **Refresca la aplicación** (Ctrl + R o Cmd + R)
2. **Limpia caché del navegador** (Ctrl + Shift + R)
3. **Verifica la consola de Supabase** para ver si hay errores
4. **Revisa los permisos de Row Level Security (RLS)** en la tabla

### Verificar permisos RLS

```sql
-- Ver políticas de pedidos
SELECT * FROM pg_policies WHERE tablename = 'pedidos';

-- Asegurar que haya política de SELECT público
CREATE POLICY "Allow public read access to pedidos"
ON pedidos FOR SELECT
USING (true);
```

---

## 📝 Notas Importantes

- El Realtime consume recursos en Supabase (tiene límites en el plan gratuito)
- Solo habilita Realtime en tablas que realmente necesites
- Puedes deshabilitarlo en cualquier momento con:
  ```sql
  ALTER PUBLICATION supabase_realtime DROP TABLE pedidos;
  ```

---

## ✅ Checklist de Configuración

- [ ] Habilitar Realtime para `pedidos`
- [ ] Habilitar Realtime para `moviles`
- [ ] Habilitar Realtime para `gps_tracking_extended`
- [ ] Verificar políticas RLS
- [ ] Refrescar aplicación
- [ ] Verificar que no hay errores en consola
