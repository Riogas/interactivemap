# 🗺️ Control de Capas del Mapa

## ✨ Nueva Funcionalidad

Se agregó un **control de capas** en la esquina inferior derecha del mapa que permite cambiar entre diferentes vistas.

---

## 📍 Ubicación

```
┌──────────────────────────────────┐
│                                  │
│                                  │
│         MAPA                     │
│                                  │
│                                  │
│                       📋 ← Aquí  │
└──────────────────────────────────┘
```

**Posición:** Esquina inferior derecha

---

## 🎨 Capas Disponibles

### 1. 🗺️ Calles (OpenStreetMap)
- **Tipo:** Calles con nombres
- **Uso:** Vista predeterminada, ideal para navegación urbana
- **Detalle:** Muestra calles, avenidas, nombres de lugares
- **Mejor para:** Ubicar direcciones, planificar rutas

### 2. 🛰️ Satélite (Esri World Imagery)
- **Tipo:** Imagen satelital real
- **Uso:** Ver terreno real, edificios, vegetación
- **Detalle:** Fotografías satelitales de alta resolución
- **Mejor para:** Identificar ubicaciones exactas, ver contexto geográfico

### 3. 🗻 Terreno (OpenTopoMap)
- **Tipo:** Mapa topográfico
- **Uso:** Mostrar elevaciones, curvas de nivel
- **Detalle:** Ideal para áreas rurales o montañosas
- **Mejor para:** Analizar terreno, ver elevaciones

### 4. 🌊 CartoDB Voyager
- **Tipo:** Estilo moderno y limpio
- **Uso:** Mapa elegante para presentaciones
- **Detalle:** Colores suaves, buen contraste
- **Mejor para:** Dashboards, reportes profesionales

### 5. 🌙 Dark Mode (CartoDB Dark)
- **Tipo:** Modo oscuro
- **Uso:** Reducir fatiga visual en uso nocturno
- **Detalle:** Fondo oscuro con marcadores brillantes
- **Mejor para:** Uso nocturno, reducir consumo de batería en pantallas OLED

### 6. 🌞 Light Mode (CartoDB Light)
- **Tipo:** Modo claro minimalista
- **Uso:** Énfasis en los marcadores
- **Detalle:** Fondo muy claro, marcadores destacados
- **Mejor para:** Imprimir, presentaciones claras

---

## 🎮 Cómo Usar

### Paso 1: Abrir el Control
1. Ve al mapa
2. Busca el ícono en la **esquina inferior derecha**
3. Haz clic en el ícono de capas (⊕)

### Paso 2: Seleccionar Capa
1. Se abrirá un menú con las opciones disponibles
2. Haz clic en la capa que desees
3. El mapa cambiará instantáneamente

### Paso 3: Cerrar el Control (Opcional)
- Haz clic fuera del control
- O vuelve a hacer clic en el ícono (⊕)

---

## 📊 Comparación Visual

### Para Rutas Urbanas
```
✅ Recomendado: 🗺️ Calles
🟡 Alternativa: 🌊 CartoDB Voyager
❌ No recomendado: 🛰️ Satélite (no muestra nombres de calles)
```

### Para Ubicación Exacta
```
✅ Recomendado: 🛰️ Satélite
🟡 Alternativa: 🗻 Terreno
❌ No recomendado: 🌞 Light Mode (muy minimalista)
```

### Para Presentaciones
```
✅ Recomendado: 🌊 CartoDB Voyager o 🌞 Light Mode
🟡 Alternativa: 🗺️ Calles
❌ No recomendado: 🌙 Dark Mode (difícil de imprimir)
```

### Para Uso Nocturno
```
✅ Recomendado: 🌙 Dark Mode
🟡 Alternativa: 🗺️ Calles
❌ No recomendado: 🌞 Light Mode (muy brillante)
```

---

## 🔧 Detalles Técnicos

### Componente Nuevo
```
components/map/LayersControl.tsx
```

### Capas Implementadas
- **OpenStreetMap:** https://tile.openstreetmap.org
- **Esri Satellite:** https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer
- **OpenTopoMap:** https://tile.opentopomap.org
- **CartoDB Voyager:** https://basemaps.cartocdn.com/rastertiles/voyager
- **CartoDB Dark:** https://basemaps.cartocdn.com/dark_all
- **CartoDB Light:** https://basemaps.cartocdn.com/light_all

### Estilos CSS Personalizados
```css
/* app/globals.css */

- Control con glassmorphism (fondo translúcido)
- Bordes redondeados
- Sombras suaves
- Animaciones de hover
- Transiciones suaves
```

---

## 🎨 Características de Diseño

### Visual Mejorado
- ✅ **Glassmorphism:** Fondo translúcido con blur
- ✅ **Bordes suaves:** Border-radius de 12px
- ✅ **Sombras:** Box-shadow para profundidad
- ✅ **Hover effects:** Los labels se desplazan al hacer hover
- ✅ **Iconos visuales:** Emojis para cada tipo de mapa

### UX Mejorada
- ✅ **Posición óptima:** Esquina inferior derecha (no interfiere con controles de zoom)
- ✅ **Collapsed por defecto:** No ocupa espacio hasta que se necesita
- ✅ **Animación de entrada:** Slide-in smooth
- ✅ **Radio buttons grandes:** Fácil de clickear
- ✅ **Labels clicables:** Todo el label es clickeable, no solo el radio

---

## 📱 Responsive

### Desktop
```
✅ Control normal (40x40px cuando collapsed)
✅ Lista expandida (220px width)
✅ Hover effects activos
```

### Tablet
```
✅ Control más grande (touch-friendly)
✅ Lista expandida (240px width)
✅ Márgenes ajustados
```

### Mobile
```
✅ Control grande (48x48px)
✅ Lista full-width al expandir
✅ Touch-optimized (sin hover)
```

---

## 🧪 Casos de Uso

### Caso 1: Conductor Perdido
**Problema:** No sé dónde está el móvil exactamente

**Solución:**
1. Cambiar a **🛰️ Satélite**
2. Ver el entorno real (edificios, calles)
3. Ubicar al conductor visualmente

### Caso 2: Zona Rural
**Problema:** No hay calles marcadas, solo coordenadas

**Solución:**
1. Cambiar a **🛰️ Satélite** o **🗻 Terreno**
2. Ver el paisaje real
3. Identificar caminos de tierra, puentes, etc.

### Caso 3: Presentación a Cliente
**Problema:** Necesito mostrar un reporte profesional

**Solución:**
1. Cambiar a **🌊 CartoDB Voyager**
2. Captura de pantalla limpia
3. Usar en PowerPoint/PDF

### Caso 4: Monitoreo Nocturno
**Problema:** El mapa es muy brillante de noche

**Solución:**
1. Cambiar a **🌙 Dark Mode**
2. Reducir fatiga visual
3. Mantener contraste de marcadores

### Caso 5: Imprimir Reporte
**Problema:** Necesito imprimir el mapa

**Solución:**
1. Cambiar a **🌞 Light Mode**
2. Fondo claro ahorra tinta
3. Marcadores bien visibles

---

## ⚙️ Configuración Avanzada

### Agregar Más Capas

Edita `components/map/LayersControl.tsx`:

```typescript
const baseLayers: { [key: string]: L.TileLayer } = {
  '🗺️ Calles': L.tileLayer('...'),
  
  // Agregar nueva capa aquí:
  '🎨 Tu Nueva Capa': L.tileLayer('https://tu-tile-server/{z}/{x}/{y}.png', {
    attribution: 'Tu Atribución',
    maxZoom: 18,
  }),
};
```

### Cambiar Posición del Control

```typescript
const layersControl = L.control.layers(baseLayers, undefined, {
  position: 'topleft',    // topleft, topright, bottomleft, bottomright
  collapsed: false,       // true = collapsed por defecto
});
```

### Cambiar Capa por Defecto

```typescript
// En LayersControl.tsx, cambiar esta línea:
baseLayers['🛰️ Satélite'].addTo(map);  // En lugar de '🗺️ Calles'
```

---

## 🐛 Troubleshooting

### El control no aparece
**Causa:** Leaflet CSS no cargado

**Solución:**
```typescript
// Verificar que esto esté en MapView.tsx:
import 'leaflet/dist/leaflet.css';
```

### Los tiles no cargan
**Causa:** Problema de red o servidor de tiles

**Solución:**
1. Verificar conexión a internet
2. Abrir consola (F12) y buscar errores 404
3. Probar otra capa

### El control está en posición incorrecta
**Causa:** CSS personalizado está interfiriendo

**Solución:**
```css
/* En globals.css, ajustar: */
.leaflet-bottom.leaflet-right {
  margin-bottom: 20px !important;
  margin-right: 20px !important;
}
```

### Las capas se superponen
**Causa:** Múltiples TileLayers activos

**Solución:**
- Asegúrate de que solo hay un `<LayersControl />` en MapView.tsx
- No debe haber ningún `<TileLayer>` adicional

---

## 📈 Mejoras Futuras

### Posibles Adiciones

1. **🌐 Google Maps Tiles** (requiere API key)
2. **🗺️ Mapbox Tiles** (requiere API key)
3. **🛣️ Waze-style roads**
4. **🚦 Traffic overlay** (capa adicional)
5. **🌤️ Weather overlay** (temperatura, lluvia)
6. **🏙️ 3D Buildings** (en zonas urbanas)

### Configuración Guardada

Implementar localStorage para recordar preferencia:

```typescript
// Guardar preferencia
localStorage.setItem('preferredMapLayer', '🛰️ Satélite');

// Cargar al inicio
const preferred = localStorage.getItem('preferredMapLayer');
if (preferred && baseLayers[preferred]) {
  baseLayers[preferred].addTo(map);
}
```

---

## ✅ Checklist de Verificación

Asegúrate de que funciona correctamente:

- [ ] El ícono del control aparece en esquina inferior derecha
- [ ] Al hacer clic, se abre el menú de capas
- [ ] Todas las 6 capas están disponibles
- [ ] Al seleccionar una capa, el mapa cambia
- [ ] Los marcadores siguen visibles en todas las capas
- [ ] El control se puede cerrar
- [ ] Funciona en móvil y desktop
- [ ] Los estilos CSS se aplicaron correctamente
- [ ] No hay errores en la consola (F12)

---

## 📚 Referencias

- [Leaflet Layers Control](https://leafletjs.com/reference.html#control-layers)
- [OpenStreetMap Tiles](https://wiki.openstreetmap.org/wiki/Tiles)
- [Esri ArcGIS](https://services.arcgisonline.com/)
- [CartoDB Basemaps](https://carto.com/basemaps/)
- [OpenTopoMap](https://opentopomap.org/)

---

## 🎉 ¡Disfruta las Múltiples Vistas!

Ahora puedes cambiar entre diferentes estilos de mapa según tus necesidades:

- 🗺️ **Calles** para navegación urbana
- 🛰️ **Satélite** para ubicación precisa
- 🗻 **Terreno** para áreas rurales
- 🌊 **CartoDB** para presentaciones
- 🌙 **Dark Mode** para uso nocturno
- 🌞 **Light Mode** para imprimir

**¡Explora y elige tu favorito! 🚀**
