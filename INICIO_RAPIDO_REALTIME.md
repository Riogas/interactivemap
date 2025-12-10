# 🚀 Inicio Rápido - Sistema de Tiempo Real

## ⚡ Setup en 5 Minutos

### Paso 1: Instalar Dependencias

```bash
pnpm install
```

### Paso 2: Configurar Variables de Entorno

Verifica que `.env.local` existe y contiene:

```env
NEXT_PUBLIC_SUPABASE_URL=https://lgniuhelyyizoursmsmi.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

### Paso 3: Habilitar Realtime en Supabase

1. Abre Supabase SQL Editor:
   ```
   https://app.supabase.com/project/lgniuhelyyizoursmsmi/sql
   ```

2. Copia y pega TODO el contenido de `supabase-quick-start.sql`

3. Haz clic en **"Run"**

4. Verifica que veas:
   ```
   ✅ Empresas: 2
   ✅ Móviles: 4
   ✅ Posiciones GPS: 12
   ```

### Paso 4: Iniciar Servidor de Desarrollo

```bash
pnpm dev
```

### Paso 5: Abrir Aplicación

```
http://localhost:3000
```

**Deberías ver**:
- ✅ Badge verde "Tiempo Real Activo" (esquina superior derecha)
- ✅ Mapa con 4 marcadores de móviles
- ✅ Lista de empresas en panel lateral
- ✅ Selector de móviles funcional

---

## 🧪 Probar Tiempo Real

### Opción 1: Script de Testing Automático

1. Abre **dos pestañas** en tu navegador:
   - Pestaña 1: Aplicación (`http://localhost:3000`)
   - Pestaña 2: Supabase SQL Editor

2. En Supabase SQL Editor, abre el archivo `test-realtime.sql`

3. Ejecuta **línea por línea** (NO todas juntas):

```sql
-- Línea 1: Mover móvil 1003
INSERT INTO gps_tracking_extended (movil, latitud, longitud, fecha_hora, escenario_id)
VALUES ('1003', -34.9115, -56.1645, NOW(), 1000);
```

4. **Observa en la aplicación**:
   - ✅ El marcador del móvil se mueve AUTOMÁTICAMENTE
   - ✅ En consola (F12): "🔔 Actualización Realtime para móvil 1003"

5. **Espera 5 segundos** y ejecuta la siguiente línea:

```sql
-- Línea 2: Mover móvil 1003 otra vez
INSERT INTO gps_tracking_extended (movil, latitud, longitud, fecha_hora, escenario_id)
VALUES ('1003', -34.9120, -56.1650, NOW(), 1000);
```

6. **Observa de nuevo** - el marcador debe moverse

### Opción 2: Testing Manual Rápido

En Supabase SQL Editor, ejecuta:

```sql
-- Mover todos los móviles al mismo tiempo
INSERT INTO gps_tracking_extended (movil, latitud, longitud, fecha_hora, escenario_id) VALUES
('1001', -34.9000, -56.1600, NOW(), 1000),
('1002', -34.9010, -56.1610, NOW(), 1000),
('1003', -34.9020, -56.1620, NOW(), 1000),
('1004', -34.9030, -56.1630, NOW(), 1000);
```

**Resultado esperado**: LOS 4 marcadores se mueven simultáneamente.

---

## 🎬 Probar Animación del Recorrido

1. En la aplicación, **selecciona un móvil** de la lista lateral

2. Haz clic en **"Ver Animación"**

3. El diálogo de animación se abre con:
   - ▶️ Botón Play/Pause
   - 🔄 Botón Reiniciar
   - ⚡ Controles de velocidad (0.1x - 10x)
   - 🕐 Selector de rango horario
   - 🎯 Switch "Ruta Simplificada"

4. **Haz clic en Play** ▶️

5. **Observa**:
   - ✅ El marcador sigue la trayectoria histórica
   - ✅ Aparece una línea (polyline) mostrando el recorrido
   - ✅ La barra de progreso avanza
   - ✅ Puedes pausar/reanudar la animación

---

## 🐛 Solución de Problemas

### Error: "Cannot find module '@/components/providers/RealtimeProvider'"

**Solución**: Reinicia el servidor TypeScript

```bash
# En VS Code:
1. Abre Command Palette (Ctrl+Shift+P)
2. Escribe "TypeScript: Restart TS Server"
3. Presiona Enter

# O simplemente reinicia el servidor dev:
Ctrl+C
pnpm dev
```

### Error: "No hay empresas disponibles"

**Causas posibles**:
1. No ejecutaste `supabase-quick-start.sql`
2. Tu escenario_id es diferente a 1000

**Solución**:

```sql
-- 1. Verifica tu escenario_id
SELECT DISTINCT escenario_id FROM empresas_fleteras;

-- Si no es 1000, actualiza:
-- app/layout.tsx línea 21:
<RealtimeProvider escenarioId={TU_ESCENARIO_ID}>
```

### Badge verde no aparece

**Causas posibles**:
1. Realtime no está habilitado en Supabase
2. Variables de entorno incorrectas

**Solución**:

```sql
-- Verifica que Realtime está habilitado
SELECT * FROM pg_publication_tables 
WHERE pubname = 'supabase_realtime';

-- Debe mostrar:
-- gps_tracking_extended
-- moviles
-- pedidos
-- empresas_fleteras
```

Si no aparecen, ejecuta `supabase-quick-start.sql` de nuevo.

### Marcadores no se mueven

**Causa**: Filtro de escenario_id incorrecto

**Solución**:

1. Abre consola del navegador (F12)
2. Busca mensaje de error
3. Si dice "No se reciben eventos", verifica:
   - Que ejecutaste `supabase-quick-start.sql`
   - Que el escenario_id en los INSERT coincide con el de RealtimeProvider

```sql
-- Prueba directa:
INSERT INTO gps_tracking_extended (movil, latitud, longitud, fecha_hora, escenario_id)
VALUES ('1003', -34.9115, -56.1645, NOW(), 1000);  -- ← Verifica este número
```

---

## 📚 Documentación Adicional

| Archivo | Descripción |
|---------|-------------|
| `PRUEBAS_REALTIME.md` | Guía detallada de testing con casos de uso |
| `ARQUITECTURA_REALTIME.md` | Diagrama técnico y flujo de datos completo |
| `RESUMEN_EJECUTIVO.md` | Resumen de la migración y beneficios |
| `supabase-quick-start.sql` | Script de setup (ejecutar primero) |
| `test-realtime.sql` | Script de testing paso a paso |

---

## ✅ Checklist de Verificación

Antes de continuar, verifica que:

- [ ] `pnpm install` completado sin errores
- [ ] Variables de entorno en `.env.local` configuradas
- [ ] `supabase-quick-start.sql` ejecutado en Supabase
- [ ] Query de verificación muestra "✅ Empresas: 2, ✅ Móviles: 4"
- [ ] Servidor dev corriendo (`pnpm dev`)
- [ ] Aplicación abierta en `http://localhost:3000`
- [ ] Badge verde "Tiempo Real Activo" visible
- [ ] Al menos 4 marcadores en el mapa
- [ ] Al ejecutar INSERT en Supabase, marcador se mueve automáticamente

Si todos los checks están ✅, **¡el sistema está funcionando correctamente!** 🎉

---

## 🚀 Próximos Pasos

1. **Testing Completo**: Ejecuta `test-realtime.sql` línea por línea
2. **Datos Reales**: Configura sincronización desde AS400/DB2
3. **Optimización**: Agregar índices, caché, y monitoreo
4. **Producción**: Deploy en Vercel/Netlify

---

## 💡 Tips

- **Consola del navegador (F12)**: Muestra logs útiles de actualización
- **Supabase Dashboard**: Monitorea conexiones WebSocket en tiempo real
- **Network Tab**: Verifica que WebSocket está conectado (wss://)

---

**¿Listo para empezar?** → Ejecuta `pnpm dev` y abre `http://localhost:3000` 🚀
