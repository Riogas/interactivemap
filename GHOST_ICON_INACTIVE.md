# � Icono de Alarma para Móviles Inactivos

## Descripción

Los móviles con coordenadas GPS antiguas (fuera del límite de tiempo configurado) ahora se muestran con un **icono de alarma rojo parpadeante** en lugar de ocultarse completamente. Esto permite mantener visibilidad de todos los vehículos mientras se destaca claramente aquellos que requieren atención por no reportar coordenadas recientes.

## Características

### Visualización en el Mapa

**Móviles Activos** (con coordenadas recientes):
- Ícono de auto normal con el color asignado al móvil
- Badge blanco con el número del móvil
- Animación de pulso suave

**Móviles Inactivos** (coordenadas antiguas):
- 🔔 Icono de campana/alarma en círculo rojo (#EF4444 → #DC2626)
- Borde blanco con sombra
- Badge blanco con borde rojo y el número del móvil
- **Animaciones distintivas**:
  - Pulso de escala con ondas expansivas (efecto ripple)
  - Movimiento de balanceo (ring) que simula una campana sonando
  - Badge con pulso de opacidad
- ⚠️ **Muy visible** para llamar la atención

### Visualización en el Selector

**Móviles Inactivos** en la lista:
- 🔔 Icono de alarma rojo (#DC2626) parpadeante
- Punto rojo pulsante en la esquina superior derecha (efecto ping)
- Fondo rojo claro (bg-red-50) cuando no está seleccionado
- Fondo rojo intenso (#DC2626) cuando está seleccionado
- Timestamp en rojo (#DC2626) para destacar la hora de última actualización
- Animación de pulso continua para llamar la atención

## Criterios de Inactividad

Un móvil se considera **inactivo** cuando:

1. **No tiene posición GPS**: `!movil.currentPosition`
2. **Coordenadas antiguas**: La diferencia entre la hora actual y `fechaInsLog` supera el límite configurado en preferencias (`maxCoordinateDelayMinutes`)

```typescript
const minutesDiff = (now - coordDate) / (1000 * 60);
if (minutesDiff > preferences.maxCoordinateDelayMinutes) {
  return { ...movil, isInactive: true };
}
```

## Configuración

El límite de tiempo se configura en:
- **Preferencias del Usuario** → Filtros → "Retraso máximo en coordenadas (minutos)"
- Valor por defecto: **30 minutos**
- Rango recomendado: 5-120 minutos

## Implementación Técnica

### 1. Tipo de Datos

```typescript
// types/index.ts
export interface MovilData {
  // ... otros campos
  isInactive?: boolean; // Indica si el móvil tiene coordenadas antiguas
}
```

### 2. Marcado de Inactivos

```typescript
// app/page.tsx
const markInactiveMoviles = useCallback((moviles: MovilData[]): MovilData[] => {
  const now = Date.now();
  
  return moviles.map(movil => {
    if (!movil.currentPosition) {
      return { ...movil, isInactive: preferences.showActiveMovilesOnly };
    }
    
    const coordDate = new Date(movil.currentPosition.fechaInsLog).getTime();
    const minutesDiff = (now - coordDate) / (1000 * 60);
    
    if (minutesDiff > preferences.maxCoordinateDelayMinutes) {
      return { ...movil, isInactive: true };
    }
    
    return { ...movil, isInactive: false };
  });
}, [preferences]);
```

### 3. Renderizado del Icono

```typescript
// components/map/MapView.tsx
const createCustomIcon = (color: string, movilId?: number, isInactive?: boolean) => {
  if (isInactive) {
    return L.divIcon({
      html: `
        <div style="...">
          <div style="
            background: linear-gradient(135deg, #EF4444 0%, #DC2626 100%);
            border: 3px solid white;
            animation: alarm-pulse 1.5s infinite, alarm-ring 0.3s infinite;
          ">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
              <path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.89 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z"/>
            </svg>
          </div>
          <style>
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
            @keyframes alarm-ring {
              0%, 100% { transform: rotate(-3deg); }
              50% { transform: rotate(3deg); }
            }
          </style>
        </div>
      `,
      iconSize: [46, 46],
      iconAnchor: [23, 23],
    });
  }
  
  // Icono normal para móviles activos...
};
```

### 4. Icono en el Selector

```typescript
// components/ui/MovilSelector.tsx
{isInactive ? (
  <span className="relative inline-block">
    <svg className="w-5 h-5 text-red-600 animate-pulse" fill="currentColor" viewBox="0 0 24 24">
      <path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.89 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z"/>
    </svg>
    <span className="absolute -top-1 -right-1 flex h-2 w-2">
      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
      <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
    </span>
  </span>
) : (
  <div className="w-4 h-4 rounded-full" style={{ backgroundColor: movil.color }} />
)}
```

## Ventajas de Este Enfoque

✅ **Alta visibilidad**: El color rojo y las animaciones llaman inmediatamente la atención
✅ **Alerta clara**: Indica que hay un problema que requiere revisión
✅ **Priorización**: Los supervisores pueden identificar rápidamente vehículos problemáticos
✅ **Información contextual**: Se puede ver la última ubicación conocida
✅ **Consistencia**: El mismo indicador visual aparece en mapa y lista
✅ **Accionable**: Motiva a tomar acción correctiva inmediata

## Casos de Uso

### Escenario 1: Vehículo sin Señal GPS
Un móvil pierde señal GPS en un túnel o zona sin cobertura.
- **Antes**: El móvil desaparecía del mapa
- **Ahora**: Se muestra con � ALARMA ROJA parpadeante en su última posición conocida
- **Beneficio**: Alerta inmediata al supervisor

### Escenario 2: Móviles Apagados
Vehículos al final del día de trabajo con GPS apagado.
- **Antes**: Se ocultaban completamente
- **Ahora**: Permanecen visibles con alarma activa
- **Beneficio**: Identificar vehículos que no reportaron su posición de estacionamiento

### Escenario 3: Monitoreo de Flotas
Supervisor revisa posiciones de la flota completa.
- **Ventaja**: Los iconos rojos parpadeantes destacan INMEDIATAMENTE sobre el mapa
- **Beneficio**: Priorización automática - ver primero los problemas críticos
- **Acción**: Contactar conductor, revisar equipo GPS, verificar conectividad

### Escenario 4: Problemas de Hardware GPS
Equipo GPS con falla o batería baja.
- **Detección rápida**: El icono de alarma persiste mientras no haya actualización
- **Prevención**: Identificar problemas antes de que se vuelvan críticos
- **Mantenimiento**: Programar revisión técnica del equipo

## Relacionado

- `FILTRO_TIEMPO_COORDENADAS.md` - Configuración del filtro de tiempo
- `SELECCION_MULTIPLE.md` - Selección de móviles en el mapa
- `UI_MAXIMIZADA.md` - Interfaz de usuario optimizada
