'use client';

import { useEffect, useRef } from 'react';
import { driver, type DriveStep, type Config } from 'driver.js';
import 'driver.js/dist/driver.css';

// ============= ESTILOS PERSONALIZADOS PARA EL TOUR =============
const CUSTOM_CSS = `
  .driver-popover {
    background: linear-gradient(135deg, #1e1b4b 0%, #312e81 50%, #1e1b4b 100%) !important;
    border: 1px solid rgba(129, 140, 248, 0.3) !important;
    border-radius: 16px !important;
    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5), 0 0 40px rgba(99, 102, 241, 0.15) !important;
    max-width: 400px !important;
    padding: 0 !important;
    overflow: hidden;
  }

  .driver-popover * {
    font-family: 'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif !important;
  }

  .driver-popover-title {
    font-size: 16px !important;
    font-weight: 700 !important;
    color: #e0e7ff !important;
    padding: 20px 20px 4px !important;
    margin: 0 !important;
    line-height: 1.3 !important;
    letter-spacing: -0.01em;
  }

  .driver-popover-description {
    font-size: 13px !important;
    color: #c7d2fe !important;
    padding: 8px 20px 16px !important;
    margin: 0 !important;
    line-height: 1.7 !important;
  }

  .driver-popover-description strong {
    color: #a5b4fc !important;
  }

  .driver-popover-progress-text {
    color: #a5b4fc !important;
    font-size: 11px !important;
    font-weight: 600 !important;
  }

  .driver-popover-navigation-btns {
    padding: 0 20px 16px !important;
    gap: 8px !important;
    justify-content: flex-end !important;
  }

  .driver-popover-prev-btn {
    background: rgba(255, 255, 255, 0.1) !important;
    color: #c7d2fe !important;
    border: 1px solid rgba(255, 255, 255, 0.15) !important;
    border-radius: 10px !important;
    padding: 8px 16px !important;
    font-size: 12px !important;
    font-weight: 600 !important;
    transition: all 0.2s ease !important;
    text-shadow: none !important;
  }

  .driver-popover-prev-btn:hover {
    background: rgba(255, 255, 255, 0.2) !important;
    transform: translateY(-1px);
  }

  .driver-popover-next-btn,
  .driver-popover-close-btn-inside {
    background: linear-gradient(135deg, #6366f1, #818cf8) !important;
    color: white !important;
    border: none !important;
    border-radius: 10px !important;
    padding: 8px 18px !important;
    font-size: 12px !important;
    font-weight: 700 !important;
    box-shadow: 0 4px 12px rgba(99, 102, 241, 0.4) !important;
    transition: all 0.2s ease !important;
    text-shadow: none !important;
  }

  .driver-popover-next-btn:hover {
    background: linear-gradient(135deg, #4f46e5, #6366f1) !important;
    box-shadow: 0 6px 16px rgba(99, 102, 241, 0.5) !important;
    transform: translateY(-1px);
  }

  .driver-popover-close-btn {
    color: #94a3b8 !important;
    font-size: 18px !important;
    width: 28px !important;
    height: 28px !important;
    top: 12px !important;
    right: 12px !important;
    background: rgba(255, 255, 255, 0.1) !important;
    border-radius: 8px !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    transition: all 0.2s ease !important;
  }

  .driver-popover-close-btn:hover {
    color: white !important;
    background: rgba(255, 255, 255, 0.2) !important;
  }

  .driver-popover-footer {
    padding: 12px 20px 16px !important;
    border-top: 1px solid rgba(129, 140, 248, 0.15) !important;
    margin-top: 4px;
  }

  .driver-popover-dot {
    width: 8px !important;
    height: 8px !important;
    border-radius: 50% !important;
    margin: 0 3px !important;
    background: rgba(255, 255, 255, 0.2) !important;
    border: none !important;
  }

  .driver-popover-dot-active {
    background: #818cf8 !important;
    box-shadow: 0 0 8px rgba(129, 140, 248, 0.6) !important;
  }

  .driver-overlay {
    background: rgba(0, 0, 0, 0.65) !important;
  }

  /* Separador de secciones en el tour */
  .tour-section-badge {
    display: inline-block;
    background: rgba(99, 102, 241, 0.3);
    color: #c7d2fe;
    font-size: 10px;
    font-weight: 700;
    padding: 2px 8px;
    border-radius: 6px;
    margin-bottom: 8px;
    letter-spacing: 0.5px;
    text-transform: uppercase;
  }
`;

// ============= HELPER: click programático seguro =============
function clickElement(id: string, delay = 0) {
  setTimeout(() => {
    const el = document.getElementById(id);
    if (el) el.click();
  }, delay);
}

// ============= DEFINICIÓN DE PASOS DEL TOUR =============
interface TourActions {
  expandFab: () => void;
  collapseFab: () => void;
}

function getTourSteps(actions: TourActions): DriveStep[] {
  return [
    // ======================================================
    // PARTE 1: BIENVENIDA + NAVBAR + INDICADORES
    // ======================================================

    // 0 — Bienvenida general
    {
      popover: {
        title: '🚀 ¡Bienvenido a TrackMovil!',
        description: '<div class="tour-section-badge">INTRODUCCIÓN</div><br>Esta guía te va a mostrar <strong>todas las funcionalidades</strong> de la aplicación de rastreo en tiempo real, paso a paso.<br><br>Navegá con los botones <strong>Siguiente / Anterior</strong> o las teclas <strong>← →</strong> del teclado.',
        side: 'over',
        align: 'center',
      },
    },

    // 1 — Logo e identidad
    {
      element: '#tour-logo',
      popover: {
        title: '🚗 TrackMovil — Riogas',
        description: '<div class="tour-section-badge">NAVBAR</div><br>Esta es la barra de navegación principal. Desde acá vas a poder ver toda la información resumida de la operación del día.',
        side: 'bottom',
        align: 'start',
      },
    },

    // 2 — Selector de empresas
    {
      element: '#tour-empresa-selector',
      popover: {
        title: '🏢 Selector de Empresa Fletera',
        description: 'Si tenés acceso a <strong>múltiples empresas fleteras</strong>, desde este combo podés filtrar cuáles querés visualizar. Los datos del dashboard se actualizan automáticamente al cambiar la selección.',
        side: 'bottom',
        align: 'start',
      },
    },

    // 3 — Indicadores en la navbar
    {
      element: '#tour-indicators',
      popover: {
        title: '📊 Indicadores Operativos',
        description: 'Panel de <strong>KPIs en tiempo real</strong> que resume toda la operación:<br><br>• <span style="color:#f87171"><strong>⏰ Atrasados</strong></span> — Pedidos/Services con demora<br>• <span style="color:#60a5fa"><strong>📦 Pendientes</strong></span> — En ruta, sin entregar<br>• <span style="color:#4ade80"><strong>🚗 Móviles</strong></span> — Cantidad de activos<br>• <span style="color:#fb923c"><strong>📡 Sin Coord.</strong></span> — Móviles sin GPS<br>• <span style="color:#4ade80"><strong>✅ Entregados/OK</strong></span> — Completados hoy<br><br>Si no entran todos, usá las <strong>flechas ◄ ►</strong> de los costados.',
        side: 'bottom',
        align: 'center',
      },
    },

    // 4 — Indicador de conexión Realtime
    {
      element: '#tour-realtime-indicator',
      popover: {
        title: '📡 Estado de Conexión',
        description: 'Muestra si los datos se actualizan en <strong>tiempo real</strong>:<br><br>• <span style="color:#4ade80"><strong>🟢 Verde</strong></span> — Conectado, datos en vivo<br>• <span style="color:#facc15"><strong>🟡 Amarillo</strong></span> — Reconectando...<br>• <span style="color:#9ca3af"><strong>⚫ Gris</strong></span> — Modo estático (sin actualizaciones)',
        side: 'bottom',
        align: 'end',
      },
    },

    // ======================================================
    // PARTE 2: BOTONES DE ACCIÓN (FAB) — Uno a uno
    // ======================================================

    // 5 — Introducción a los botones FAB
    {
      element: '#tour-fab-toggle',
      popover: {
        title: '⚡ Botón de Acciones Rápidas',
        description: '<div class="tour-section-badge">ACCIONES RÁPIDAS</div><br>Este botón <strong>expande 4 acciones rápidas</strong>. Al presionarlo se despliegan los botones de acción a su izquierda. Veamos cada uno...',
        side: 'bottom',
        align: 'end',
      },
      onHighlightStarted: () => {
        actions.expandFab();
      },
    },

    // 6 — Botón Zonas
    {
      element: '#tour-fab-zonas',
      popover: {
        title: '🗺️ Asignación de Zonas',
        description: 'Abre un modal de <strong>drag & drop</strong> para asignar móviles a zonas.<br><br>Tiene <strong>3 paneles</strong>:<br>• <strong>Zonas</strong> — Listado de zonas disponibles<br>• <strong>Prioridad / Tránsito</strong> — Arrastrá un móvil acá<br>• <strong>Disponibles</strong> — Móviles sin asignar',
        side: 'bottom',
        align: 'end',
      },
    },

    // 7 — Botón Ranking
    {
      element: '#tour-fab-ranking',
      popover: {
        title: '🏆 Ranking de Móviles',
        description: 'Abre el <strong>Leaderboard</strong> con el ranking de rendimiento de la flota. Muestra métricas de cada móvil: pedidos completados, servicios realizados.',
        side: 'bottom',
        align: 'end',
      },
    },

    // 8 — Botón Tracking
    {
      element: '#tour-fab-tracking',
      popover: {
        title: '🛤️ Recorrido Histórico',
        description: 'Abre el modal de <strong>tracking</strong>. Seleccioná un móvil y una fecha para ver su <strong>recorrido animado</strong> dibujado sobre el mapa, punto a punto.',
        side: 'bottom',
        align: 'end',
      },
    },

    // 9 — Botón POI
    {
      element: '#tour-fab-poi',
      popover: {
        title: '📍 Puntos de Interés (POI)',
        description: 'Activa el <strong>modo marcador</strong>. Después, hacé clic en cualquier lugar del mapa para crear un punto de interés con nombre, color e ícono personalizado.',
        side: 'bottom',
        align: 'end',
      },
    },

    // ======================================================
    // PARTE 3: CONFIGURACIÓN (⚙️ Gear)
    // ======================================================

    // 10 — Botón de engranaje (intro)
    {
      element: '#tour-gear-btn',
      popover: {
        title: '⚙️ Filtros y Configuración',
        description: '<div class="tour-section-badge">CONFIGURACIÓN</div><br>Este botón abre el <strong>panel de configuración</strong>. Desde ahí podés cambiar la fecha, acceder a preferencias avanzadas y ver tu usuario.',
        side: 'left',
        align: 'start',
      },
      onDeselected: () => {
        // Abrir el panel para que los siguientes steps lo muestren
        clickElement('tour-gear-btn', 100);
      },
    },

    // 11 — Selector de fecha
    {
      element: '#tour-date-selector',
      popover: {
        title: '📅 Selector de Fecha',
        description: 'Cambiá la fecha para ver <strong>datos históricos</strong>. Al modificarla se recargan todos los pedidos, services y posiciones de esa jornada.',
        side: 'left',
        align: 'start',
      },
    },

    // 12 — Botón de preferencias
    {
      element: '#tour-preferences-btn',
      popover: {
        title: '🔧 Preferencias Avanzadas',
        description: 'Abre el <strong>modal de preferencias</strong> donde se configura:<br><br>• <strong>Capa del mapa</strong> — Satélite, calles, terreno, oscuro<br>• <strong>Tiempo de inactividad</strong> — Minutos sin GPS para marcar móvil como inactivo<br>• <strong>Modo tiempo real</strong> — Activar/desactivar actualizaciones automáticas',
        side: 'left',
        align: 'start',
      },
    },

    // 13 — Info de usuario
    {
      element: '#tour-user-info',
      popover: {
        title: '👤 Tu Usuario',
        description: 'Información de tu <strong>sesión activa</strong>. Debajo encontrás el botón para <strong>cerrar sesión</strong>.',
        side: 'left',
        align: 'end',
      },
      onDeselected: () => {
        // Cerrar el panel de config para limpiar
        clickElement('tour-gear-btn', 100);
      },
    },

    // ======================================================
    // PARTE 4: EL MAPA
    // ======================================================

    // 14 — Mapa principal
    {
      element: '#tour-map-area',
      popover: {
        title: '🗺️ Mapa Interactivo',
        description: '<div class="tour-section-badge">MAPA</div><br>El <strong>corazón de TrackMovil</strong>. Acá se visualiza en tiempo real:<br><br>🚗 <strong>Móviles</strong> — Ícono con número y color según ocupación. Los activos tienen efecto "pulso".<br>📦 <strong>Pedidos</strong> — Marcadores coloreados por atraso: <span style="color:#4ade80">verde</span> → <span style="color:#facc15">amarillo</span> → <span style="color:#f472b6">rosa</span> → <span style="color:#f87171">rojo</span><br>🔧 <strong>Services</strong> — Marcadores de servicios técnicos<br>📍 <strong>POIs</strong> — Marcadores personalizados<br><br>Hacé <strong>clic en un móvil</strong> para ver su popup con detalle completo.',
        side: 'left',
        align: 'center',
      },
      onHighlightStarted: () => {
        actions.collapseFab();
      },
    },

    // ======================================================
    // PARTE 5: SIDEBAR
    // ======================================================

    // 15 — Panel lateral general
    {
      element: '#tour-sidebar',
      popover: {
        title: '📋 Panel Lateral',
        description: '<div class="tour-section-badge">SIDEBAR</div><br>El <strong>panel de control</strong> con todas las listas organizadas en secciones colapsables. Cada sección tiene su propio buscador y filtros.<br><br>Secciones: <strong>Móviles</strong>, <strong>Pedidos</strong>, <strong>Pedidos Finalizados</strong>, <strong>Services</strong>, <strong>Services Finalizados</strong> y <strong>Puntos de Interés</strong>.',
        side: 'right',
        align: 'center',
      },
    },

    // 16 — Botón colapsar sidebar
    {
      element: '#tour-sidebar-toggle',
      popover: {
        title: '◀ Colapsar / Expandir',
        description: 'Con este botón podés <strong>ocultar o mostrar</strong> todo el panel lateral para ver el mapa en pantalla completa cuando necesitás más espacio.',
        side: 'right',
        align: 'center',
      },
    },

    // 17 — Filtros del sidebar
    {
      element: '#tour-sidebar-filters',
      popover: {
        title: '🔍 Buscador y Filtros',
        description: 'Los filtros cambian <strong>automáticamente</strong> según la sección abierta:<br><br>• <strong>Móviles:</strong> Buscar por nro, filtro de capacidad, actividad<br>• <strong>Pedidos/Services:</strong> Buscar por cliente, filtro zona, móvil, atraso<br><br>Los filtros activos aparecen como <strong>badges</strong> removibles.',
        side: 'right',
        align: 'start',
      },
    },

    // 18 — Sección Móviles
    {
      element: '#tour-category-moviles',
      popover: {
        title: '🚗 Sección Móviles',
        description: 'Lista todos los <strong>móviles de la flota</strong>. Hacé clic en uno para seleccionarlo y centrarlo en el mapa.<br><br>Cada móvil muestra: número, último GPS, zona actual, y <strong>color según pedidos asignados</strong>.<br><br>Usá <strong>"Seleccionar todos"</strong> o <strong>"Limpiar"</strong> para gestión masiva.',
        side: 'right',
        align: 'start',
      },
    },

    // 19 — Eye toggle (ocultar móviles)
    {
      element: '#tour-eye-toggle',
      popover: {
        title: '👁️ Ocultar / Mostrar Móviles',
        description: 'Este ícono <strong>oculta o muestra</strong> los marcadores de móviles en el mapa, sin perder la selección.<br><br>Útil cuando querés ver <strong>solo pedidos o POIs</strong> sin que los móviles tapen la vista.',
        side: 'left',
        align: 'center',
      },
    },

    // 20 — Sección Pedidos
    {
      element: '#tour-category-pedidos',
      popover: {
        title: '📦 Pedidos Pendientes',
        description: 'Muestra los <strong>pedidos pendientes</strong> del día. Cada pedido tiene indicador visual de atraso:<br><br>• <span style="color:#4ade80">🟢 En tiempo</span><br>• <span style="color:#facc15">🟡 Próximo al vencimiento</span><br>• <span style="color:#f472b6">🩷 Atrasado</span><br>• <span style="color:#f87171">🔴 Muy atrasado</span><br><br>Clic en un pedido → se centra en el mapa.',
        side: 'right',
        align: 'start',
      },
    },

    // 21 — Botón tabla extendida de pedidos
    {
      element: '#tour-pedidos-table-btn',
      popover: {
        title: '📊 Vista Tabla de Pedidos',
        description: 'Abre una <strong>tabla completa</strong> con todos los pedidos. Incluye:<br><br>• <strong>12 columnas</strong> con toda la info<br>• <strong>Ordenamiento</strong> por cualquier columna<br>• <strong>Filtros:</strong> zona, móvil, producto, atraso<br>• <strong>Solo sin coordenadas</strong> — detectar pedidos sin GPS<br>• <strong>Paginación</strong> de 50 por página',
        side: 'left',
        align: 'center',
      },
    },

    // 22 — Pedidos Finalizados
    {
      element: '#tour-category-pedidosFinalizados',
      popover: {
        title: '✅ Pedidos Finalizados',
        description: '<strong>Pedidos ya entregados</strong> del día. Incluye hora de entrega y datos del cliente. Útil para auditoría y seguimiento de completitud.',
        side: 'right',
        align: 'start',
      },
    },

    // 23 — Services pendientes
    {
      element: '#tour-category-services',
      popover: {
        title: '🔧 Services Pendientes',
        description: '<strong>Servicios técnicos pendientes</strong> (instalaciones, reparaciones, mantenimiento). Mismo sistema de colores por atraso que los pedidos. Se visualizan en el mapa con marcadores propios.',
        side: 'right',
        align: 'start',
      },
    },

    // 24 — Services finalizados
    {
      element: '#tour-category-servicesFinalizados',
      popover: {
        title: '✅ Services Finalizados',
        description: '<strong>Servicios completados</strong> del día. Registra hora de finalización y estado de cada trabajo técnico.',
        side: 'right',
        align: 'start',
      },
    },

    // 25 — Puntos de interés
    {
      element: '#tour-category-pois',
      popover: {
        title: '📍 Puntos de Interés',
        description: 'Acá aparecen tus <strong>marcadores personalizados</strong>. Se crean desde el botón 📍 del FAB y los podés gestionar desde esta lista.',
        side: 'right',
        align: 'start',
      },
    },

    // ======================================================
    // FINAL
    // ======================================================

    // 26 — Cierre
    {
      popover: {
        title: '🎉 ¡Tour Completado!',
        description: '¡Ya conocés <strong>todas las funcionalidades</strong> de TrackMovil!<br><br>Podés iniciar este tour en cualquier momento con el botón <strong>❓</strong> violeta junto a las acciones rápidas.<br><br>¡Buen monitoreo! 🚀',
        side: 'over',
        align: 'center',
      },
    },
  ];
}

// ============= COMPONENTE PRINCIPAL =============
interface AppTourProps {
  isOpen: boolean;
  onClose: () => void;
  expandFab: () => void;
  collapseFab: () => void;
}

export default function AppTour({ isOpen, onClose, expandFab, collapseFab }: AppTourProps) {
  const styleRef = useRef<HTMLStyleElement | null>(null);
  const driverRef = useRef<ReturnType<typeof driver> | null>(null);
  const hasStarted = useRef(false);

  // Inyectar CSS personalizado (una sola vez)
  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = CUSTOM_CSS;
    document.head.appendChild(style);
    styleRef.current = style;
    return () => {
      if (styleRef.current && styleRef.current.parentNode) {
        styleRef.current.parentNode.removeChild(styleRef.current);
        styleRef.current = null;
      }
    };
  }, []);

  // Iniciar / destruir tour según isOpen
  useEffect(() => {
    if (!isOpen) {
      // Si se cierra externamente, destruir la instancia
      if (driverRef.current) {
        driverRef.current.destroy();
        driverRef.current = null;
      }
      hasStarted.current = false;
      return;
    }

    // Evitar inicio múltiple (el bug de "arranca n veces")
    if (hasStarted.current || driverRef.current) return;
    hasStarted.current = true;

    const steps = getTourSteps({ expandFab, collapseFab });

    const config: Config = {
      showProgress: true,
      animate: true,
      smoothScroll: true,
      allowClose: true,
      stagePadding: 8,
      stageRadius: 12,
      popoverOffset: 14,
      showButtons: ['next', 'previous', 'close'],
      nextBtnText: 'Siguiente →',
      prevBtnText: '← Anterior',
      doneBtnText: '¡Entendido! ✨',
      progressText: '{{current}} de {{total}}',
      steps,
      onDestroyed: () => {
        driverRef.current = null;
        hasStarted.current = false;
        onClose();
      },
    };

    // Un solo timeout, suficiente para que el DOM esté listo
    const timer = setTimeout(() => {
      if (!hasStarted.current) return;
      const d = driver(config);
      driverRef.current = d;
      d.drive();
    }, 500);

    return () => {
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Cleanup al desmontar el componente
  useEffect(() => {
    return () => {
      if (driverRef.current) {
        driverRef.current.destroy();
        driverRef.current = null;
      }
    };
  }, []);

  return null; // driver.js maneja su propio DOM
}
