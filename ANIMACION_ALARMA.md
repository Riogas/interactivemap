# 🎬 Animaciones del Icono de Alarma

## Descripción General

El icono de alarma para móviles inactivos utiliza **tres animaciones simultáneas** para maximizar la visibilidad y llamar la atención sobre vehículos que no están reportando coordenadas GPS.

## Animaciones Implementadas

### 1. **Alarm Pulse** (Pulso con Ondas Expansivas)
```css
@keyframes alarm-pulse {
  0%, 100% { 
    transform: scale(1); 
    box-shadow: 0 4px 8px rgba(0,0,0,0.3), 0 0 0 0 rgba(239, 68, 68, 0.7);
  }
  50% { 
    transform: scale(1.1); 
    box-shadow: 0 4px 12px rgba(0,0,0,0.4), 0 0 0 10px rgba(239, 68, 68, 0);
  }
}
```

**Características:**
- ⏱️ **Duración**: 1.5 segundos
- 🔄 **Repetición**: Infinita
- 📏 **Escala**: 1.0 → 1.1 → 1.0
- 💫 **Efecto**: Ondas rojas expansivas (ripple effect)
- 🎯 **Propósito**: Simular una alerta pulsante que se propaga

**Comportamiento:**
- El icono crece un 10% en el punto medio
- La sombra se expande desde 0px hasta 10px
- La opacidad de la onda va de 0.7 a 0 (desvanecimiento)

---

### 2. **Alarm Ring** (Balanceo de Campana)
```css
@keyframes alarm-ring {
  0%, 100% { transform: rotate(-3deg); }
  50% { transform: rotate(3deg); }
}
```

**Características:**
- ⏱️ **Duración**: 0.3 segundos (muy rápido)
- 🔄 **Repetición**: Infinita
- 🔔 **Rotación**: -3° ↔️ +3°
- 🎯 **Propósito**: Simular el movimiento de una campana sonando

**Comportamiento:**
- Balanceo rápido de izquierda a derecha
- Movimiento sutil pero perceptible
- Crea sensación de urgencia y movimiento

---

### 3. **Badge Pulse** (Pulso del Badge)
```css
@keyframes badge-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.7; }
}
```

**Características:**
- ⏱️ **Duración**: 1.5 segundos (sincronizado con alarm-pulse)
- 🔄 **Repetición**: Infinita
- 👁️ **Opacidad**: 1.0 → 0.7 → 1.0
- 🎯 **Propósito**: Hacer que el número del móvil también llame la atención

**Comportamiento:**
- El badge con el número del móvil parpadea suavemente
- Refuerza la alerta sin ser demasiado agresivo
- Mantiene legibilidad del número

---

## Animación en el Selector de Móviles

### **Ping Animation** (Punto Pulsante)
```html
<span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
<span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
```

**Características:**
- 🔴 **Punto rojo fijo** (2x2px, bg-red-500)
- 📡 **Onda ping** (expansión desde el centro, bg-red-400)
- ⏱️ **Duración**: 1 segundo por ciclo
- 💫 **Efecto**: Similar a un radar o notificación

**Comportamiento:**
- El punto rojo permanece fijo en la esquina superior derecha del icono
- Una onda circular se expande continuamente desde el centro
- La onda se desvanece mientras crece (opacity 0.75 → 0)
- Efecto "sonar" o "radar" muy reconocible

---

## Combinación de Efectos

### En el Mapa
```
🔔 Icono de Alarma
├── Pulso de escala (1.5s) ─────────┐
├── Balanceo rápido (0.3s) ─────────┤─→ Efecto visual muy distintivo
├── Ondas expansivas (ripple) ──────┤
└── Badge parpadeante (1.5s) ───────┘
```

### En el Selector
```
🔔 Icono de Alarma
├── Pulso Tailwind (animate-pulse) ─┐
├── Punto rojo con ping ─────────────┤─→ Alerta clara en la lista
└── Fondo rojo claro (bg-red-50) ────┘
```

---

## Paleta de Colores

### Rojo de Alerta
- **Principal**: `#EF4444` (red-500)
- **Oscuro**: `#DC2626` (red-600)
- **Claro**: `#FCA5A5` (red-400)
- **Fondo**: `#FEF2F2` (red-50)

### Gradiente del Icono
```css
background: linear-gradient(135deg, #EF4444 0%, #DC2626 100%);
```
- Dirección: 135° (diagonal superior izquierda a inferior derecha)
- Transición suave de rojo claro a rojo oscuro
- Profundidad visual y aspecto profesional

---

## Consideraciones de UX

### ✅ Ventajas
1. **Máxima visibilidad**: Imposible no notar los móviles inactivos
2. **Jerarquía visual clara**: Rojo = Problema, otros colores = Normal
3. **Urgencia transmitida**: Las animaciones comunican necesidad de acción
4. **No intrusivo**: A pesar de ser llamativo, no bloquea la interacción

### ⚙️ Performance
- **CSS puro**: Todas las animaciones usan CSS3
- **Hardware acceleration**: `transform` y `opacity` son GPU-aceleradas
- **Sin JavaScript**: No consume recursos de CPU para las animaciones
- **Smooth**: 60fps garantizados en dispositivos modernos

### 🎯 Accesibilidad
- **Colores contrastantes**: Rojo sobre blanco (WCAG AAA)
- **Tamaño adecuado**: 40px × 40px (mínimo touch target)
- **Información redundante**: Color + forma + animación + badge
- **Desactivable**: Las animaciones respetan `prefers-reduced-motion`

---

## Timing Diagram

```
Tiempo →
0s    0.15s   0.3s   0.45s   0.75s   1.5s
│─────│───────│──────│───────│───────│
│                                    │
├─ Pulse ────────────────────────────┤ (1.5s ciclo completo)
│     ↗10px  ↘0px                    │
│                                    │
├─ Ring ──┤ Ring ──┤ Ring ──┤ Ring ─┤ (0.3s × 5 repeticiones)
│  -3°→3°   -3°→3°   -3°→3°   -3°→3° │
│                                    │
├─ Badge ────────────────────────────┤ (1.5s, sincronizado)
│     ↘0.7  ↗1.0                     │
```

---

## Testing

### Para verificar las animaciones:
1. Configurar límite de tiempo en 5 minutos (Preferencias)
2. Esperar a que un móvil supere este límite
3. Observar:
   - ✅ Icono rojo en el mapa
   - ✅ Icono pulsando y balanceándose
   - ✅ Ondas expansivas rojas
   - ✅ Badge parpadeante
   - ✅ En la lista: icono con punto ping
   - ✅ Fondo rojo claro en el botón

### Navegadores soportados:
- ✅ Chrome/Edge (Chromium 90+)
- ✅ Firefox 88+
- ✅ Safari 14+
- ✅ Opera 76+
- ⚠️ IE11: Animaciones degradadas pero funcionales

---

## Customización Futura

Si se necesita ajustar la intensidad de las animaciones:

```css
/* Menos agresivo */
animation: alarm-pulse 2.5s infinite, alarm-ring 0.5s infinite;

/* Más agresivo */
animation: alarm-pulse 1s infinite, alarm-ring 0.2s infinite;

/* Sin balanceo (solo pulso) */
animation: alarm-pulse 1.5s infinite;
```
