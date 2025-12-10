# ⚙️ Sistema de Preferencias de Usuario

## ✨ Nueva Funcionalidad

Se agregó un **sistema completo de preferencias** que permite a cada usuario personalizar la aplicación según sus necesidades. Las preferencias se guardan en `localStorage` y persisten entre sesiones.

---

## 📍 Ubicación

```
┌─────────────────────────────────────┐
│  TrackMovil  📅 Fecha  🏢 Empresas  │
│                            ⚙️ ← Aquí│
└─────────────────────────────────────┘
```

**Posición:** Esquina superior derecha del Navbar, junto a los filtros

---

## 🎨 Diseño del Botón

### Botón de Preferencias
- **Ícono:** Rueda dentada (⚙️) animada
- **Color:** Blanco con fondo translúcido
- **Hover:** Rotación de 90° + brillo
- **Responsive:** En móvil solo muestra el ícono

---

## 🔧 Preferencias Disponibles

### 1. Vista del Mapa por Defecto 🗺️
```
Opciones:
- 🗺️ Calles (OpenStreetMap)
- 🛰️ Satélite (Esri World Imagery)
- 🗻 Terreno (OpenTopoMap)
- 🌊 CartoDB Voyager
- 🌙 Modo Oscuro (CartoDB Dark)
- 🌞 Modo Claro (CartoDB Light)

Por defecto: Calles
```
**Qué hace:** Define qué vista del mapa se carga automáticamente al abrir la aplicación.

---

### 2. Mostrar Solo Móviles Activos 🚗
```
Toggle: ON / OFF
Por defecto: OFF (mostrar todos)
```
**Qué hace:** 
- **ON:** Muestra solo móviles con actualizaciones recientes
- **OFF:** Muestra todos los móviles, incluso sin señal

---

### 3. Retraso Máximo de Coordenadas ⏱️
```
Rango: 5 - 120 minutos
Control: Slider con vista previa
Por defecto: 30 minutos
```
**Qué hace:** Filtra coordenadas mostrando solo las de los últimos X minutos.

**Ejemplo:**
- Si configuras 15 min → Solo verás posiciones de los últimos 15 minutos
- Si configuras 60 min → Verás el historial de la última hora

---

### 4. Intervalo de Auto-Actualización 🔄
```
Rango: 10 - 300 segundos (10s a 5min)
Control: Slider con vista previa
Por defecto: 30 segundos
```
**Qué hace:** Define cada cuánto tiempo se actualiza automáticamente la información.

**Valores recomendados:**
- **10-20s:** Alta frecuencia (más carga del servidor)
- **30s:** Balanceado ✅ (recomendado)
- **60-120s:** Bajo consumo (menos actualizaciones)

---

### 5. Habilitar Animación de Rutas 🎬
```
Toggle: ON / OFF
Por defecto: ON
```
**Qué hace:**
- **ON:** Muestra el control de animación al seleccionar un móvil
- **OFF:** Oculta la funcionalidad de animación (UI más limpia)

---

### 6. Mostrar Pedidos/Servicios Completados ✅
```
Toggle: ON / OFF
Por defecto: ON
```
**Qué hace:**
- **ON:** Muestra marcadores verdes de pedidos/servicios completados
- **OFF:** Solo muestra pedidos pendientes (mapa más limpio)

---

## 🎮 Cómo Usar

### Paso 1: Abrir Preferencias
1. Busca el ícono ⚙️ en el Navbar (arriba a la derecha)
2. Haz clic en el botón de preferencias
3. Se abrirá un modal animado con todas las opciones

### Paso 2: Configurar Preferencias
1. **Vista del Mapa:** Selecciona tu vista favorita del dropdown
2. **Toggles:** Activa/desactiva las opciones con los switches
3. **Sliders:** Arrastra para ajustar tiempos y retrasos

### Paso 3: Guardar
1. Haz clic en **💾 Guardar Preferencias**
2. Las preferencias se aplicarán inmediatamente
3. Se guardarán en `localStorage` para futuras sesiones

### Restablecer
- Haz clic en **🔄 Restablecer** para volver a valores por defecto

---

## 💾 Persistencia de Datos

### localStorage
```javascript
{
  "defaultMapLayer": "satellite",
  "showActiveMovilesOnly": true,
  "maxCoordinateDelayMinutes": 15,
  "autoRefreshInterval": 20,
  "showRouteAnimation": true,
  "showCompletedMarkers": false
}
```

### Ubicación
```
Key: "userPreferences"
Storage: localStorage del navegador
Scope: Por navegador y dominio
```

### Persistencia
- ✅ Sobrevive a refresh (F5)
- ✅ Sobrevive a cerrar pestaña
- ✅ Sobrevive a cerrar navegador
- ❌ No se sincroniza entre dispositivos
- ❌ Se borra al limpiar datos del navegador

---

## 🎨 Diseño del Modal

### Estructura Visual

```
╔═══════════════════════════════════════╗
║ ⚙️ Preferencias              [X]      ║ ← Header (azul)
╠═══════════════════════════════════════╣
║                                       ║
║ 🗺️ Vista del Mapa                    ║
║ [Dropdown: Satélite ▼]               ║
║                                       ║
║ ──────────────────────────────────   ║
║                                       ║
║ 🚗 Mostrar Solo Móviles Activos      ║
║                            [Toggle]   ║
║                                       ║
║ ──────────────────────────────────   ║
║                                       ║
║ ⏱️ Retraso Máximo: [30 min]          ║
║ ────●─────────────────────────       ║
║                                       ║
║ ... (más opciones)                    ║
║                                       ║
╠═══════════════════════════════════════╣
║ 🔄 Restablecer   [Cancelar] [Guardar]║ ← Footer
╚═══════════════════════════════════════╝
```

### Características de Diseño
- ✅ **Backdrop blur:** Fondo difuminado
- ✅ **Animación de entrada:** Scale + fade
- ✅ **Scroll interno:** Si el contenido es largo
- ✅ **Sticky header/footer:** Siempre visibles
- ✅ **Separadores visuales:** Entre cada opción
- ✅ **Iconos:** Cada opción tiene su emoji distintivo

---

## 🔄 Flujo de Aplicación de Preferencias

### Al Cargar la Aplicación
```
1. App se inicia
2. Hook useUserPreferences() lee localStorage
3. Si existen preferencias → las carga
4. Si no existen → usa valores por defecto
5. Aplica preferencias al mapa y componentes
```

### Al Guardar Preferencias
```
1. Usuario modifica preferencias en el modal
2. Hace clic en "Guardar"
3. Preferencias se guardan en localStorage
4. Callback onPreferencesChange() se ejecuta
5. App actualiza estados (updateInterval, etc.)
6. Componentes reaccionan a los cambios
7. Modal se cierra
```

### Al Cambiar de Navegador/Dispositivo
```
1. Abrir app en otro dispositivo
2. localStorage está vacío
3. Se usan valores por defecto
4. Usuario debe configurar nuevamente
```

---

## 📊 Casos de Uso

### Caso 1: Usuario con Internet Lento
**Problema:** Las actualizaciones frecuentes consumen mucho ancho de banda

**Solución:**
```
1. Abrir preferencias
2. Intervalo de Auto-Actualización → 120s (2 minutos)
3. Mostrar Solo Móviles Activos → ON
4. Guardar
```
**Resultado:** Menos requests, interfaz más rápida

---

### Caso 2: Monitoreo Nocturno
**Problema:** El mapa claro cansa la vista de noche

**Solución:**
```
1. Abrir preferencias
2. Vista del Mapa → 🌙 Modo Oscuro
3. Guardar
```
**Resultado:** Mapa oscuro al cargar, mejor para los ojos

---

### Caso 3: Enfoque en Pedidos Activos
**Problema:** Muchos marcadores de completados distraen

**Solución:**
```
1. Abrir preferencias
2. Mostrar Pedidos/Servicios Completados → OFF
3. Guardar
```
**Resultado:** Solo se ven pedidos pendientes

---

### Caso 4: Vista Satelital Siempre
**Problema:** Trabajo en zona rural, necesito vista satelital

**Solución:**
```
1. Abrir preferencias
2. Vista del Mapa → 🛰️ Satélite
3. Guardar
```
**Resultado:** Siempre abre con vista satelital

---

### Caso 5: Historial Extendido
**Problema:** Necesito ver el recorrido completo del día

**Solución:**
```
1. Abrir preferencias
2. Retraso Máximo de Coordenadas → 120 min (2 horas)
3. Guardar
```
**Resultado:** Ve hasta 2 horas de historial

---

## 🧪 Testing

### Verificar Funcionamiento

1. **Abrir Preferencias**
   ```
   ✅ Click en ⚙️
   ✅ Modal se abre con animación
   ✅ Todas las opciones visibles
   ```

2. **Cambiar Preferencias**
   ```
   ✅ Dropdown funciona
   ✅ Toggles cambian de estado
   ✅ Sliders se mueven suavemente
   ✅ Valores se muestran en tiempo real
   ```

3. **Guardar y Aplicar**
   ```
   ✅ Click en "Guardar"
   ✅ Modal se cierra
   ✅ Cambios se aplican inmediatamente
   ✅ localStorage se actualiza
   ```

4. **Persistencia**
   ```
   ✅ Recargar página (F5)
   ✅ Preferencias se mantienen
   ✅ Cerrar y abrir navegador
   ✅ Preferencias siguen ahí
   ```

5. **Restablecer**
   ```
   ✅ Click en "Restablecer"
   ✅ Valores vuelven a defaults
   ✅ localStorage se limpia
   ```

---

## 🔧 Implementación Técnica

### Componentes Creados

#### 1. PreferencesModal.tsx
```typescript
interface UserPreferences {
  defaultMapLayer: 'streets' | 'satellite' | ...;
  showActiveMovilesOnly: boolean;
  maxCoordinateDelayMinutes: number;
  autoRefreshInterval: number;
  showRouteAnimation: boolean;
  showCompletedMarkers: boolean;
}
```

#### 2. Hook useUserPreferences()
```typescript
const { preferences, updatePreferences } = useUserPreferences();
```

### Archivos Modificados

| Archivo | Cambios |
|---------|---------|
| `components/ui/PreferencesModal.tsx` | ✅ NUEVO - Modal completo con todas las opciones |
| `components/layout/Navbar.tsx` | 🔄 Botón de preferencias + callback |
| `components/map/LayersControl.tsx` | 🔄 Acepta `defaultLayer` prop |
| `components/map/MapView.tsx` | 🔄 Acepta `defaultMapLayer` prop |
| `app/page.tsx` | 🔄 Usa hook de preferencias + pasa props |

---

## 💡 Valores por Defecto

```typescript
{
  defaultMapLayer: 'streets',              // Calles
  showActiveMovilesOnly: false,            // Mostrar todos
  maxCoordinateDelayMinutes: 30,           // 30 minutos
  autoRefreshInterval: 30,                 // 30 segundos
  showRouteAnimation: true,                // Animación habilitada
  showCompletedMarkers: true,              // Mostrar completados
}
```

---

## 🎯 Próximas Mejoras

### Funcionalidades Futuras

1. **Sincronización en la Nube** ☁️
   - Guardar preferencias en base de datos
   - Sincronizar entre dispositivos
   - Login de usuario

2. **Más Preferencias**
   - Colores personalizados por móvil
   - Tamaño de marcadores
   - Velocidad de animación por defecto
   - Notificaciones push

3. **Perfiles de Preferencias** 👤
   - Crear perfiles (Día, Noche, Oficina, Campo)
   - Cambiar rápido entre perfiles
   - Importar/Exportar configuraciones

4. **Preferencias Avanzadas**
   - Filtros personalizados
   - Alertas configurables
   - Temas de color custom

---

## 🐛 Troubleshooting

### Las preferencias no se guardan
**Causa:** localStorage bloqueado o modo incógnito

**Solución:**
- Verificar que no estés en modo incógnito
- Revisar permisos de localStorage
- Abrir consola (F12) y ejecutar:
  ```javascript
  localStorage.setItem('test', 'test');
  console.log(localStorage.getItem('test'));
  ```

### Las preferencias no se aplican
**Causa:** Callback no configurado correctamente

**Solución:**
- Verificar que `onPreferencesChange` esté en Navbar
- Revisar consola por errores
- Probar restablecer preferencias

### El modal no se abre
**Causa:** Error en imports o estado

**Solución:**
- Verificar que framer-motion esté instalado
- Revisar consola por errores
- Verificar que el botón tenga onClick

---

## ✅ Checklist de Verificación

- [ ] Botón de preferencias visible en Navbar
- [ ] Click en botón abre modal
- [ ] Modal tiene todas las 6 opciones
- [ ] Dropdown de vista del mapa funciona
- [ ] Toggles cambian de estado
- [ ] Sliders se mueven suavemente
- [ ] Botón "Guardar" guarda y cierra
- [ ] Botón "Cancelar" cierra sin guardar
- [ ] Botón "Restablecer" vuelve a defaults
- [ ] Preferencias persisten después de F5
- [ ] Vista del mapa cambia según preferencia
- [ ] Intervalo de actualización se respeta
- [ ] No hay errores en consola

---

## 📚 Archivos Relacionados

```
components/
├── ui/
│   └── PreferencesModal.tsx     ← Modal de preferencias
├── layout/
│   └── Navbar.tsx               ← Botón de preferencias
└── map/
    ├── LayersControl.tsx        ← Respeta defaultLayer
    └── MapView.tsx              ← Respeta defaultMapLayer

app/
└── page.tsx                     ← Usa hook y pasa props
```

---

## 🎉 Beneficios

### Para el Usuario
- ✅ **Personalización completa** según sus necesidades
- ✅ **Persistencia** - no reconfigurar cada vez
- ✅ **Rapidez** - todo en un solo lugar
- ✅ **Intuitivo** - UI clara y simple

### Para el Negocio
- ✅ **Mejor UX** - usuarios más satisfechos
- ✅ **Flexibilidad** - se adapta a diferentes casos de uso
- ✅ **Profesionalismo** - app más completa
- ✅ **Escalabilidad** - fácil agregar más preferencias

### Para el Desarrollo
- ✅ **Código limpio** - componentes reutilizables
- ✅ **Hook personalizado** - fácil de usar
- ✅ **TypeScript** - tipos seguros
- ✅ **Documentado** - fácil de mantener

---

**¡Ahora cada usuario puede personalizar TrackMovil a su medida! ⚙️✨**
