# 📡 Modo Tiempo Real vs Modo Estático

## 🎯 Nueva Funcionalidad

Se agregó un **switch de Modo Tiempo Real** que permite al usuario activar/desactivar las actualizaciones automáticas y la escucha de eventos en tiempo real desde Supabase.

---

## 🔄 Dos Modos de Operación

### 📡 Modo Tiempo Real (Activado)
```
✅ Escucha actualizaciones de GPS desde Supabase Realtime
✅ Auto-refresh cada 30 segundos
✅ Detecta móviles nuevos automáticamente
✅ Actualiza posiciones en vivo
✅ Indicador verde: "📡 Tiempo Real Activo"
```

**Uso:** Monitoreo en tiempo real de la flota

### ⏸️ Modo Estático (Desactivado)
```
❌ NO escucha actualizaciones de Supabase Realtime
❌ NO hace auto-refresh automático
❌ NO detecta móviles nuevos
❌ NO actualiza posiciones automáticamente
✅ Muestra snapshot de datos al momento de la carga
✅ Indicador gris: "⏸️ Modo Estático"
```

**Uso:** Análisis de datos históricos, revisión de recorridos pasados

---

## 📍 Ubicación del Control

### En Preferencias
```
⚙️ Preferencias → 📡 Modo Tiempo Real
```

**Posición:** En el modal de preferencias, después del filtro de retraso máximo de coordenadas.

---

## 🎨 Diseño del Switch

### Switch de Modo Tiempo Real
```
┌────────────────────────────────────────┐
│ 📡 Modo Tiempo Real          [ON/OFF] │
│ Actualizaciones automáticas activadas  │
└────────────────────────────────────────┘
```

**Estados:**
- **ON (verde):** Tiempo Real activado
- **OFF (gris):** Modo estático activado

**Descripción dinámica:**
- ON: "Actualizaciones automáticas activadas"
- OFF: "Modo estático (sin actualizaciones automáticas)"

---

## 🔧 Cómo Funciona

### Al Activar Modo Tiempo Real (ON)

1. **Escucha Realtime de Supabase**
   ```typescript
   // Se procesan actualizaciones de GPS
   useEffect(() => {
     if (!preferences.realtimeEnabled) return; // ✅ PASA
     // Escuchar latestPosition
   }, [latestPosition, preferences.realtimeEnabled]);
   ```

2. **Auto-Refresh Activado**
   ```typescript
   // Polling cada 30 segundos
   useEffect(() => {
     if (!preferences.realtimeEnabled) return; // ✅ PASA
     
     const interval = setInterval(() => {
       fetchPositions();
     }, 30000); // 30 segundos
   }, [preferences.realtimeEnabled]);
   ```

3. **Detección de Móviles Nuevos**
   ```typescript
   // Se agregan móviles nuevos a la lista
   useEffect(() => {
     if (!preferences.realtimeEnabled) return; // ✅ PASA
     // Escuchar latestMovil
   }, [latestMovil, preferences.realtimeEnabled]);
   ```

4. **Indicador Visual**
   ```
   🟢 📡 Tiempo Real Activo (verde pulsante)
   ```

---

### Al Desactivar Modo Tiempo Real (OFF)

1. **NO Escucha Realtime**
   ```typescript
   useEffect(() => {
     if (!preferences.realtimeEnabled) return; // ❌ SE DETIENE
     // NO escucha latestPosition
   }, [latestPosition, preferences.realtimeEnabled]);
   ```

2. **NO Auto-Refresh**
   ```typescript
   useEffect(() => {
     if (!preferences.realtimeEnabled) return; // ❌ SE DETIENE
     // NO hace polling
   }, [preferences.realtimeEnabled]);
   ```

3. **NO Detecta Móviles Nuevos**
   ```typescript
   useEffect(() => {
     if (!preferences.realtimeEnabled) return; // ❌ SE DETIENE
     // NO escucha latestMovil
   }, [latestMovil, preferences.realtimeEnabled]);
   ```

4. **Indicador Visual**
   ```
   ⚫ ⏸️ Modo Estático (gris sin pulso)
   ```

---

## 💡 Casos de Uso

### Caso 1: Monitoreo en Tiempo Real 📡
**Situación:** Necesitas ver la ubicación actual de la flota

**Configuración:**
```
📡 Modo Tiempo Real: ON ✅
⏱️ Retraso Máximo: 5-30 minutos
```

**Resultado:**
- Posiciones actualizadas cada 30 segundos
- Aparecen móviles nuevos automáticamente
- Escucha eventos de GPS en tiempo real
- Indicador verde pulsante

---

### Caso 2: Revisión de Recorridos Históricos 📊
**Situación:** Quieres analizar recorridos del día sin distracciones

**Configuración:**
```
⏸️ Modo Tiempo Real: OFF ❌
⏱️ Retraso Máximo: 120 minutos (ver historial completo)
📅 Fecha: Seleccionar día a revisar
```

**Resultado:**
- Datos congelados al momento de cargar
- Sin actualizaciones automáticas que interfieran
- Mapa estático para análisis detallado
- Indicador gris

---

### Caso 3: Análisis de Ayer 📅
**Situación:** Revisar lo que pasó ayer

**Configuración:**
```
⏸️ Modo Tiempo Real: OFF ❌
📅 Fecha: 27/11/2025
⏱️ Retraso Máximo: 120 minutos
```

**Resultado:**
- Muestra datos históricos de ayer
- Sin confusión con datos de hoy
- Análisis sin interrupciones

---

### Caso 4: Ahorro de Ancho de Banda 🌐
**Situación:** Internet lento o limitado

**Configuración:**
```
⏸️ Modo Tiempo Real: OFF ❌
```

**Resultado:**
- Sin polling cada 30 segundos
- Sin WebSocket de Supabase
- Menos consumo de datos
- Carga inicial únicamente

---

## 🎨 Indicador Visual en el Mapa

### Posición
```
┌─────────────────────────────────┐
│  TrackMovil  📅  🏢  ⚙️         │
│                    🟢 📡 Activo │ ← Esquina superior derecha
└─────────────────────────────────┘
```

### Estados del Indicador

#### Modo Tiempo Real ON + Conectado
```
🟢 [●] 📡 Tiempo Real Activo
    ↑
 Pulso animado
```
- **Color:** Verde
- **Animación:** Punto pulsante
- **Texto:** "📡 Tiempo Real Activo"

#### Modo Tiempo Real ON + Conectando
```
🟡 [●] 📡 Conectando...
```
- **Color:** Amarillo
- **Animación:** Punto fijo
- **Texto:** "📡 Conectando..."

#### Modo Tiempo Real OFF
```
⚫ [●] ⏸️ Modo Estático
```
- **Color:** Gris
- **Animación:** Sin animación
- **Texto:** "⏸️ Modo Estático"

---

## 🔄 Flujo de Activación/Desactivación

### Activar Tiempo Real

```
1. Usuario hace click en ⚙️ Preferencias
2. Switch "📡 Modo Tiempo Real" → ON
3. Click en "💾 Guardar"
4. Modal se cierra
5. Preferencia se guarda en localStorage
6. useEffect detecta cambio en preferences.realtimeEnabled
7. Se activa auto-refresh cada 30s
8. Se activa escucha de Realtime
9. Indicador cambia a 🟢 "📡 Tiempo Real Activo"
10. Comienzan a llegar actualizaciones
```

### Desactivar Tiempo Real

```
1. Usuario hace click en ⚙️ Preferencias
2. Switch "📡 Modo Tiempo Real" → OFF
3. Click en "💾 Guardar"
4. Modal se cierra
5. Preferencia se guarda en localStorage
6. useEffect detecta cambio en preferences.realtimeEnabled
7. setInterval se cancela (return cleanup)
8. useEffect de Realtime hace return early
9. Indicador cambia a ⚫ "⏸️ Modo Estático"
10. Ya no llegan actualizaciones
```

---

## 📊 Comparación de Modos

| Característica | Tiempo Real ON | Modo Estático OFF |
|----------------|----------------|-------------------|
| **Auto-refresh** | ✅ Cada 30s | ❌ No |
| **Realtime Supabase** | ✅ Activo | ❌ Desactivado |
| **Móviles nuevos** | ✅ Se agregan | ❌ No se detectan |
| **Consumo de datos** | 🔴 Alto | 🟢 Bajo (solo carga inicial) |
| **Uso de CPU** | 🔴 Medio | 🟢 Bajo |
| **Uso de batería** | 🔴 Mayor | 🟢 Menor |
| **Latencia** | 🟢 Baja (~30s) | ⚫ N/A |
| **Análisis histórico** | ⚠️ Datos cambian | ✅ Datos estáticos |
| **Indicador** | 🟢 Verde pulsante | ⚫ Gris |

---

## 🧪 Testing

### Verificar Modo Tiempo Real ON

1. **Abrir Preferencias**
   ```
   ⚙️ Click en preferencias
   ```

2. **Activar Tiempo Real**
   ```
   📡 Modo Tiempo Real → ON
   💾 Guardar
   ```

3. **Verificar Indicador**
   ```
   ✅ Debe mostrar: 🟢 📡 Tiempo Real Activo
   ✅ Punto debe estar pulsando
   ```

4. **Verificar en Consola (F12)**
   ```javascript
   // Cada 30 segundos debe aparecer:
   🔄 Auto-refresh triggered (Realtime Mode). Selected móvil: none
   
   // Al llegar GPS:
   🔔 Actualización Realtime para móvil 52: {...}
   ```

5. **Verificar localStorage**
   ```javascript
   const prefs = JSON.parse(localStorage.getItem('userPreferences'));
   console.log(prefs.realtimeEnabled); // true
   ```

---

### Verificar Modo Estático OFF

1. **Abrir Preferencias**
   ```
   ⚙️ Click en preferencias
   ```

2. **Desactivar Tiempo Real**
   ```
   📡 Modo Tiempo Real → OFF
   💾 Guardar
   ```

3. **Verificar Indicador**
   ```
   ✅ Debe mostrar: ⚫ ⏸️ Modo Estático
   ✅ Sin animación de pulso
   ```

4. **Verificar en Consola (F12)**
   ```javascript
   // NO debe aparecer auto-refresh
   // Debe aparecer:
   ⏸️ Modo Tiempo Real desactivado - no hay auto-refresh
   ⏸️ Modo Tiempo Real desactivado - ignorando actualizaciones de Supabase
   ⏸️ Modo Tiempo Real desactivado - ignorando nuevos móviles
   ```

5. **Verificar localStorage**
   ```javascript
   const prefs = JSON.parse(localStorage.getItem('userPreferences'));
   console.log(prefs.realtimeEnabled); // false
   ```

6. **Esperar 30 segundos**
   ```
   ✅ NO debe haber auto-refresh
   ✅ Datos deben permanecer estáticos
   ```

---

## 🔧 Implementación Técnica

### Interfaz de Preferencias

```typescript
export interface UserPreferences {
  defaultMapLayer: 'streets' | 'satellite' | ...;
  showActiveMovilesOnly: boolean;
  maxCoordinateDelayMinutes: number;
  realtimeEnabled: boolean; // ← NUEVO
  showRouteAnimation: boolean;
  showCompletedMarkers: boolean;
}
```

### Valores por Defecto

```typescript
const DEFAULT_PREFERENCES: UserPreferences = {
  defaultMapLayer: 'streets',
  showActiveMovilesOnly: false,
  maxCoordinateDelayMinutes: 30,
  realtimeEnabled: true, // ← Por defecto activado
  showRouteAnimation: true,
  showCompletedMarkers: true,
};
```

### Guards en useEffect

```typescript
// Auto-refresh con guard
useEffect(() => {
  if (!preferences.realtimeEnabled) {
    console.log('⏸️ Modo Tiempo Real desactivado - no hay auto-refresh');
    return; // ← Detiene el efecto
  }
  
  const interval = setInterval(() => {
    fetchPositions();
  }, 30000);
  
  return () => clearInterval(interval);
}, [fetchPositions, preferences.realtimeEnabled]);

// Realtime de GPS con guard
useEffect(() => {
  if (!preferences.realtimeEnabled) {
    console.log('⏸️ Modo Tiempo Real desactivado - ignorando actualizaciones');
    return; // ← Detiene el efecto
  }
  
  if (!latestPosition) return;
  
  // Procesar actualización...
}, [latestPosition, preferences.realtimeEnabled]);
```

---

## 💾 Persistencia

### localStorage
```json
{
  "realtimeEnabled": true,
  "defaultMapLayer": "streets",
  "maxCoordinateDelayMinutes": 30,
  ...
}
```

### Persistencia entre Sesiones
- ✅ Sobrevive a refresh (F5)
- ✅ Sobrevive a cerrar pestaña
- ✅ Sobrevive a cerrar navegador
- ❌ No se sincroniza entre dispositivos
- ❌ Se borra al limpiar datos del navegador

---

## 🎯 Beneficios

### Para el Usuario

**Modo Tiempo Real ON:**
- ✅ Monitoreo en vivo
- ✅ Datos siempre actualizados
- ✅ Detecta cambios automáticamente

**Modo Estático OFF:**
- ✅ Análisis sin interrupciones
- ✅ Datos históricos estables
- ✅ Menor consumo de recursos
- ✅ Mejor para revisiones

### Para el Sistema

**Modo Tiempo Real ON:**
- ⚠️ Mayor consumo de recursos
- ⚠️ Más requests al servidor
- ⚠️ WebSocket activo

**Modo Estático OFF:**
- ✅ Menor carga del servidor
- ✅ Menos ancho de banda
- ✅ Solo carga inicial
- ✅ Sin WebSocket

---

## 🐛 Troubleshooting

### El auto-refresh sigue funcionando con Modo OFF

**Causa:** Preferencias no guardadas correctamente

**Solución:**
1. Abrir preferencias
2. Verificar que el switch está OFF
3. Click en "Guardar"
4. Verificar localStorage:
   ```javascript
   localStorage.getItem('userPreferences')
   ```

### El indicador no cambia

**Causa:** Estado no se actualiza

**Solución:**
1. Recargar la página (F5)
2. Verificar consola por errores
3. Limpiar localStorage y volver a configurar

### Las actualizaciones siguen llegando

**Causa:** Supabase Realtime sigue conectado

**Solución:**
- El Realtime Provider sigue conectado, pero los useEffect ignoran las actualizaciones
- Es comportamiento esperado
- Para desconectar completamente, cerrar la pestaña

---

## 📚 Archivos Modificados

| Archivo | Cambios |
|---------|---------|
| `components/ui/PreferencesModal.tsx` | ✅ Agregado switch de Modo Tiempo Real |
| `app/page.tsx` | ✅ Guards en useEffect para Realtime |
| `app/page.tsx` | ✅ Guards en auto-refresh |
| `app/page.tsx` | ✅ Indicador visual dinámico |
| `app/page.tsx` | ✅ Removido estado updateInterval |

---

## ✅ Checklist de Verificación

- [ ] Switch "Modo Tiempo Real" visible en preferencias
- [ ] Switch cambia de ON a OFF correctamente
- [ ] Descripción del switch cambia según estado
- [ ] Guardar preferencias actualiza localStorage
- [ ] Indicador visual muestra estado correcto
- [ ] Con ON: auto-refresh funciona cada 30s
- [ ] Con ON: actualizaciones de GPS llegan
- [ ] Con OFF: auto-refresh se detiene
- [ ] Con OFF: actualizaciones de GPS se ignoran
- [ ] Con OFF: logs muestran "Modo Tiempo Real desactivado"
- [ ] Preferencia persiste después de F5
- [ ] Colores del indicador son correctos (verde/gris)
- [ ] Animación de pulso funciona en modo ON
- [ ] No hay errores en consola

---

## 🎉 Resultado Final

**Antes:**
- ❌ Siempre en modo Tiempo Real
- ❌ No se podía desactivar auto-refresh
- ❌ Difícil analizar datos históricos sin interrupciones

**Después:**
- ✅ Control total sobre Tiempo Real
- ✅ Switch simple ON/OFF
- ✅ Indicador visual claro del estado
- ✅ Análisis histórico sin distracciones
- ✅ Ahorro de recursos cuando no se necesita

**¡Ahora tienes el control! 📡⏸️**
