# 🎬 Animación del Recorrido - Documentación

## 📋 Descripción

Sistema de animación visual que reproduce el recorrido histórico de un vehículo sobre el mapa, mostrando punto por punto cómo se desplazó durante el día.

## ✨ Características Implementadas

### 1. **Control de Animación** 🎮

Panel flotante en la parte inferior del mapa con:
- ▶️ **Play/Pause**: Iniciar o pausar la animación
- 🔄 **Reset**: Reiniciar desde el principio
- ⚡ **Control de Velocidad**: 0.5x, 1x, 2x, 5x, 10x
- 📊 **Barra de Progreso**: Indicador visual del porcentaje completado

### 2. **Visualización Dinámica** 🗺️

Durante la animación:
- **Línea progresiva**: La ruta se dibuja gradualmente desde el inicio
- **Punto animado**: Marcador especial con anillo pulsante que sigue el recorrido
- **Etiqueta "🚗 EN RUTA"**: Identifica el punto actual en movimiento
- **Ocultación de puntos futuros**: Solo se muestran los puntos ya "recorridos"

### 3. **Efectos Visuales** ✨

#### Marcador Animado Actual:
```css
- Tamaño: 14px (más grande que puntos intermedios)
- Borde: Rojo (#ff6b6b) para destacar
- Animación de pulso: scale(1) → scale(1.3)
- Anillo expansivo (ripple): opacity 1 → 0, scale 0.8 → 1.5
```

#### Línea de Ruta:
- **Sombra base**: Gris oscuro, peso 6, opacidad 0.2
- **Línea principal**: Color del vehículo, discontinua (10, 8), peso 4
- **Segmentos individuales**: Gradiente de opacidad (más reciente = más opaco)

### 4. **Lógica de Animación** ⚙️

```typescript
// Cálculo de puntos visibles
const totalPoints = fullPathCoordinates.length;
const visiblePointsCount = Math.ceil((animationProgress / 100) * totalPoints);

// El array de coordenadas se recorre desde el final (más antiguo) hacia el inicio (más reciente)
const pathCoordinates = fullPathCoordinates.slice(
  Math.max(0, totalPoints - visiblePointsCount)
);

// Índice del punto animado actual
const animatedPointIndex = totalPoints - visiblePointsCount;
```

### 5. **Duración y Velocidad** ⏱️

- **Duración base**: 10 segundos (1x)
- **Velocidades disponibles**:
  - 0.5x = 20 segundos (más lento)
  - 1x = 10 segundos (normal)
  - 2x = 5 segundos
  - 5x = 2 segundos
  - 10x = 1 segundo (muy rápido)

### 6. **Estados de Animación** 🔄

| Estado | Descripción | Acción |
|--------|-------------|--------|
| **Detenida** | `progress = 0`, `isAnimating = false` | Usuario puede presionar Play |
| **Reproduciendo** | `progress = 0-100`, `isAnimating = true` | Animación en curso |
| **Pausada** | `progress = X`, `isAnimating = false` | Usuario pausó, puede reanudar |
| **Completada** | `progress = 100`, `isAnimating = false` | Animación finalizada |

## 🎯 Flujo de Usuario

1. **Seleccionar vehículo** en el panel lateral
2. El mapa centra y carga el historial del vehículo
3. Aparece el **panel de control de animación** en la parte inferior
4. Usuario presiona **▶️ Play**
5. La animación comienza:
   - Línea se dibuja progresivamente
   - Marcador "🚗 EN RUTA" avanza punto por punto
   - Barra de progreso se actualiza
6. Usuario puede:
   - **⏸️ Pausar** en cualquier momento
   - **🔄 Reiniciar** para volver al inicio
   - **⚡ Cambiar velocidad** durante la reproducción
7. Al finalizar, puede repetir la animación

## 🔧 Componentes Técnicos

### `MapView.tsx`
- Estado de animación: `isAnimating`, `animationProgress`, `animationSpeed`
- Hook de animación con `requestAnimationFrame`
- Renderización condicional de puntos visibles
- Cálculo dinámico de coordenadas visibles

### `RouteAnimationControl.tsx`
- Panel flotante con Framer Motion
- Controles de reproducción
- Selector de velocidad
- Barra de progreso animada

## 🎨 Mejoras Visuales Específicas

### Marcadores según Estado:
- **🏁 INICIO** (último punto histórico): 14px, borde dorado
- **🚗 EN RUTA** (punto animado): 14px, borde rojo, anillo pulsante
- **Intermedios**: 8px, borde blanco, opacidad graduada
- **🎯 ACTUAL** (más reciente): 16px, borde blanco, pulso continuo

### Animaciones CSS:
```css
@keyframes pulse-marker {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.3); }
}

@keyframes ripple {
  0% { transform: scale(0.8); opacity: 1; }
  100% { transform: scale(1.5); opacity: 0; }
}
```

## 📊 Datos y Frecuencia

- **Frecuencia de GPS**: ~3 minutos por coordenada
- **Puntos por día**: Variable (ej: 20-300 puntos según actividad)
- **Precisión**: Aproximada, no sigue calles exactamente
- **Línea discontinua**: Indica trayectoria estimada entre puntos

## 🚀 Características Futuras (Sugerencias)

- [ ] Interpolación suave entre puntos (Bezier curves)
- [ ] Timeline con marcadores de tiempo
- [ ] Información contextual durante animación (hora, velocidad, etc.)
- [ ] Exportar animación como video/GIF
- [ ] Sincronización con eventos (paradas, cambios de estado)
- [ ] Vista de múltiples vehículos animados simultáneamente

## 💡 Notas de Uso

- La animación solo está disponible cuando se selecciona **UN** vehículo específico
- Si el vehículo no tiene historial, el control no se muestra
- Al cambiar de vehículo, la animación se resetea automáticamente
- El componente usa `requestAnimationFrame` para animación fluida
- La barra de progreso es puramente visual (no interactiva)

---

**Creado**: Octubre 2025  
**Tecnologías**: React, TypeScript, Leaflet, Framer Motion  
**Integración**: AS400 DB2 + Python FastAPI + Next.js
