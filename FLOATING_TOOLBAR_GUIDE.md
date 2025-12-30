# 🎨 Refactorización del Header - Toolbar Flotante

## 📋 Resumen

Se refactorizó completamente el header de la aplicación para **maximizar el espacio disponible** y mejorar la experiencia de usuario con un diseño moderno y minimalista.

---

## 🆕 Nuevos Componentes

### 1. **NavbarSimple** (`components/layout/NavbarSimple.tsx`)

Header simplificado que solo contiene:
- ✅ Logo TrackMovil
- ✅ Espacio flexible para indicadores personalizados (children)

**Props:**
```typescript
interface NavbarProps {
  children?: ReactNode; // Indicadores personalizados
}
```

**Uso:**
```tsx
<NavbarSimple>
  {/* Tus indicadores aquí */}
  <div className="flex items-center gap-4">
    <div className="bg-white/20 backdrop-blur-sm rounded-lg px-4 py-2">
      <span className="text-white font-semibold text-sm">
        🚗 25 activos
      </span>
    </div>
  </div>
</NavbarSimple>
```

---

### 2. **FloatingToolbar** (`components/layout/FloatingToolbar.tsx`)

Botón flotante en la esquina superior derecha que se expande en un panel lateral.

**Características:**
- 🔘 Botón flotante animado con icono de engranaje
- 📂 Panel expandible con todos los filtros
- 🎨 Animaciones suaves de apertura/cierre
- 🌑 Backdrop semi-transparente
- 📱 Auto-cierre al hacer clic fuera
- 🔔 Badge de notificación si faltan empresas por seleccionar
- 📜 Scroll automático si el contenido es muy largo

**Props:**
```typescript
interface FloatingToolbarProps {
  selectedDate: string;
  onDateChange: (date: string) => void;
  empresas: EmpresaFleteraSupabase[];
  selectedEmpresas: number[];
  onEmpresasChange: (empresas: number[]) => void;
  isLoadingEmpresas: boolean;
  onPreferencesChange?: (preferences: UserPreferences) => void;
}
```

**Contenido del Panel:**
1. 📅 **Selector de Fecha**
2. 🏢 **Selector de Empresas** (con contador)
3. ⚙️ **Botón de Preferencias**
4. 👤 **Info del Usuario**
5. 🚪 **Botón de Cerrar Sesión**

---

## 🎯 Cómo Usar en Dashboard

### Antes (Header Ocupado):
```tsx
<Navbar
  selectedDate={selectedDate}
  onDateChange={setSelectedDate}
  empresas={empresas}
  selectedEmpresas={selectedEmpresas}
  onEmpresasChange={setSelectedEmpresas}
  isLoadingEmpresas={isLoadingEmpresas}
  onPreferencesChange={updatePreferences}
/>
```

### Ahora (Header Libre):
```tsx
{/* Header Simple con Indicadores */}
<NavbarSimple>
  <div className="flex items-center gap-4">
    {/* Móviles activos */}
    <div className="bg-white/20 backdrop-blur-sm rounded-lg px-4 py-2 border border-white/30">
      <span className="text-white font-semibold text-sm">
        🚗 {moviles.filter(m => !m.isInactive).length} activos
      </span>
    </div>
    
    {/* Pedidos totales */}
    <div className="bg-white/20 backdrop-blur-sm rounded-lg px-4 py-2 border border-white/30">
      <span className="text-white font-semibold text-sm">
        📦 {pedidosCompletos.length} pedidos
      </span>
    </div>
    
    {/* Alertas (opcional) */}
    <div className="bg-red-500/90 backdrop-blur-sm rounded-lg px-4 py-2 border border-red-400">
      <span className="text-white font-semibold text-sm">
        🚨 3 alertas
      </span>
    </div>
  </div>
</NavbarSimple>

{/* Toolbar Flotante con Filtros */}
<FloatingToolbar
  selectedDate={selectedDate}
  onDateChange={setSelectedDate}
  empresas={empresas}
  selectedEmpresas={selectedEmpresas}
  onEmpresasChange={setSelectedEmpresas}
  isLoadingEmpresas={isLoadingEmpresas}
  onPreferencesChange={updatePreferences}
/>
```

---

## 🎨 Personalización de Indicadores

Puedes agregar cualquier indicador en el header:

### Ejemplo 1: Contador Simple
```tsx
<div className="bg-white/20 backdrop-blur-sm rounded-lg px-4 py-2 border border-white/30">
  <span className="text-white font-semibold text-sm">
    📊 {totalRegistros} registros
  </span>
</div>
```

### Ejemplo 2: Indicador con Estado
```tsx
<div className={`
  backdrop-blur-sm rounded-lg px-4 py-2 border transition-all
  ${isConnected 
    ? 'bg-green-500/90 border-green-400' 
    : 'bg-red-500/90 border-red-400'
  }
`}>
  <span className="text-white font-semibold text-sm flex items-center gap-2">
    <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-200' : 'bg-red-200'}`} />
    {isConnected ? 'Conectado' : 'Desconectado'}
  </span>
</div>
```

### Ejemplo 3: Indicador con Progreso
```tsx
<div className="bg-white/20 backdrop-blur-sm rounded-lg px-4 py-2 border border-white/30">
  <div className="flex items-center gap-3">
    <span className="text-white font-semibold text-sm">
      🎯 75% completado
    </span>
    <div className="w-24 h-2 bg-white/30 rounded-full overflow-hidden">
      <div className="h-full bg-green-400 rounded-full" style={{width: '75%'}}></div>
    </div>
  </div>
</div>
```

### Ejemplo 4: Indicador con Tooltip
```tsx
<div 
  className="bg-white/20 backdrop-blur-sm rounded-lg px-4 py-2 border border-white/30 cursor-help"
  title="Tiempo promedio de entrega: 45 minutos"
>
  <span className="text-white font-semibold text-sm">
    ⏱️ 45 min
  </span>
</div>
```

---

## 🎬 Animaciones del Toolbar

### Estados del Botón:
1. **Cerrado**: Icono de engranaje, fondo azul-índigo
2. **Abierto**: Icono X, fondo azul más oscuro, rotación 90°
3. **Hover**: Escala 110%, transición suave

### Panel:
- **Apertura**: Fade-in + Scale-up desde esquina
- **Cierre**: Fade-out + Scale-down hacia esquina
- **Duración**: 300ms con easing suave

---

## 📱 Responsive Design

### Desktop (> 1024px):
- Toolbar flotante visible en esquina superior derecha
- Panel expandido: 320px de ancho
- Todos los indicadores visibles en header

### Tablet (768px - 1024px):
- Toolbar flotante funcional
- Panel ajustado automáticamente
- Algunos indicadores ocultos con `hidden md:flex`

### Mobile (< 768px):
- Toolbar flotante más pequeño
- Panel ocupa más porcentaje de pantalla
- Indicadores stack verticalmente

---

## 🔧 Características Avanzadas

### Auto-cierre al Hacer Clic Fuera
```typescript
useEffect(() => {
  const handleClickOutside = (event: MouseEvent) => {
    if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
      setIsOpen(false);
    }
  };

  if (isOpen) {
    document.addEventListener('mousedown', handleClickOutside);
  }

  return () => {
    document.removeEventListener('mousedown', handleClickOutside);
  };
}, [isOpen]);
```

### Badge de Notificación
Se muestra automáticamente si no todas las empresas están seleccionadas:
```tsx
{selectedEmpresas.length < empresas.length && (
  <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full">
    !
  </span>
)}
```

### Scroll en Panel Largo
```tsx
<div className="max-h-[calc(100vh-180px)] overflow-y-auto">
  {/* Contenido del panel */}
</div>
```

---

## 🎨 Estilos y Clases Útiles

### Indicador Base:
```css
bg-white/20 backdrop-blur-sm rounded-lg px-4 py-2 border border-white/30
```

### Indicador con Hover:
```css
bg-white/20 hover:bg-white/30 backdrop-blur-sm rounded-lg px-4 py-2 
border border-white/30 hover:border-white/50 transition-all cursor-pointer
```

### Badge/Alerta:
```css
bg-red-500/90 backdrop-blur-sm rounded-lg px-4 py-2 border border-red-400
```

### Éxito/Completado:
```css
bg-green-500/90 backdrop-blur-sm rounded-lg px-4 py-2 border border-green-400
```

### Advertencia:
```css
bg-yellow-500/90 backdrop-blur-sm rounded-lg px-4 py-2 border border-yellow-400
```

---

## 💡 Ventajas del Nuevo Sistema

### ✅ Antes (Header Ocupado):
- ❌ Filtros ocupaban todo el espacio horizontal
- ❌ Difícil agregar más indicadores
- ❌ Diseño rígido y poco flexible
- ❌ Mobile: scroll horizontal necesario

### ✅ Ahora (Header Libre):
- ✅ Espacio libre para indicadores importantes
- ✅ Filtros organizados en panel expandible
- ✅ Diseño moderno y minimalista
- ✅ Mejor UX: acceso rápido con un clic
- ✅ Mobile: panel full-screen adaptado
- ✅ Fácil agregar nuevos indicadores

---

## 📊 Ejemplos de Indicadores Recomendados

Basado en tu aplicación de tracking, estos son algunos indicadores útiles:

1. **🚗 Móviles Activos** - `{moviles.filter(m => !m.isInactive).length} activos`
2. **📦 Pedidos Totales** - `{pedidosCompletos.length} pedidos`
3. **🎯 Pedidos Pendientes** - `{pedidosPendientes.length} pendientes`
4. **✅ Pedidos Completados** - `{pedidosCompletados.length} completados`
5. **🚨 Alertas Críticas** - `{alertasCriticas} alertas`
6. **⏱️ Tiempo Promedio** - `{tiempoPromedio} min`
7. **📍 Última Actualización** - `Hace {timeAgo(lastUpdate)}`
8. **🌐 Estado Conexión** - `Conectado / Desconectado`
9. **👥 Usuarios Online** - `{usuariosOnline} online`
10. **📈 Eficiencia** - `{eficiencia}%`

---

## 🚀 Próximos Pasos

1. **Agregar más indicadores** según tus necesidades
2. **Crear componentes reutilizables** para indicadores comunes
3. **Implementar tooltips** con detalles adicionales
4. **Agregar gráficos pequeños** (sparklines) en indicadores
5. **Notificaciones en tiempo real** con badges animados

---

¡Ahora tienes todo el espacio del header para mostrar la información más importante de tu sistema de tracking! 🎉
