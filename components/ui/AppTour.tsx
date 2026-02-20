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
    max-width: 420px !important;
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

  /* z-index alto para que esté por encima de los modales (z-[10000]) */
  .driver-active .driver-overlay,
  .driver-active .driver-active-element {
    z-index: 100000 !important;
  }
  .driver-popover {
    z-index: 100001 !important;
  }

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

// Helper: esperar a que un elemento aparezca en el DOM
function waitForElement(id: string, timeout = 2000): Promise<HTMLElement | null> {
  return new Promise((resolve) => {
    const el = document.getElementById(id);
    if (el) { resolve(el); return; }
    const observer = new MutationObserver(() => {
      const found = document.getElementById(id);
      if (found) { observer.disconnect(); resolve(found); }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => { observer.disconnect(); resolve(null); }, timeout);
  });
}

// ============= DEFINICIÓN DE PASOS DEL TOUR =============
interface TourActions {
  expandFab: () => void;
  collapseFab: () => void;
  openZonas: () => void;
  closeZonas: () => void;
  openRanking: () => void;
  closeRanking: () => void;
  openTracking: () => void;
  closeTracking: () => void;
  openPedidosTable: () => void;
  closePedidosTable: () => void;
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
        description: '<div class="tour-section-badge">INTRODUCCIÓN</div><br>Esta guía te va a mostrar <strong>todas las funcionalidades</strong> de la aplicación de rastreo en tiempo real, paso a paso.<br><br>Vamos a ir abriendo cada pantalla para que veas cómo funciona todo. Navegá con <strong>Siguiente / Anterior</strong> o las teclas <strong>← →</strong>.',
        side: 'over',
        align: 'center',
      },
    },

    // 1 — Logo e identidad
    {
      element: '#tour-logo',
      popover: {
        title: '🚗 TrackMovil — Riogas',
        description: '<div class="tour-section-badge">NAVBAR</div><br>Barra de navegación principal. Desde acá ves toda la información resumida de la operación del día.',
        side: 'bottom',
        align: 'start',
      },
    },

    // 2 — Selector de empresas
    {
      element: '#tour-empresa-selector',
      popover: {
        title: '🏢 Selector de Empresa Fletera',
        description: 'Si tenés acceso a <strong>múltiples empresas fleteras</strong>, desde este combo filtrás cuáles querés visualizar. Los datos se actualizan automáticamente.',
        side: 'bottom',
        align: 'start',
      },
    },

    // 3 — Indicadores en la navbar
    {
      element: '#tour-indicators',
      popover: {
        title: '📊 Indicadores Operativos',
        description: 'Panel de <strong>KPIs en tiempo real</strong>:<br><br>• <span style="color:#f87171"><strong>⏰ Atrasados</strong></span> — Pedidos con demora<br>• <span style="color:#60a5fa"><strong>📦 Pendientes</strong></span> — En ruta<br>• <span style="color:#4ade80"><strong>🚗 Móviles</strong></span> — Activos<br>• <span style="color:#fb923c"><strong>📡 Sin Coord.</strong></span> — Sin GPS<br>• <span style="color:#4ade80"><strong>✅ Entregados/OK</strong></span> — Completados<br><br>Si no entran todos, usá las <strong>flechas ◄ ►</strong>.',
        side: 'bottom',
        align: 'center',
      },
    },

    // 4 — Indicador de conexión Realtime
    {
      element: '#tour-realtime-indicator',
      popover: {
        title: '📡 Estado de Conexión',
        description: '• <span style="color:#4ade80"><strong>🟢 Verde</strong></span> — Conectado, datos en vivo<br>• <span style="color:#facc15"><strong>🟡 Amarillo</strong></span> — Reconectando...<br>• <span style="color:#9ca3af"><strong>⚫ Gris</strong></span> — Modo estático',
        side: 'bottom',
        align: 'end',
      },
    },

    // ======================================================
    // PARTE 2: ACCIONES RÁPIDAS (FAB) + MODALES INTERACTIVOS
    // ======================================================

    // 5 — Introducción FAB
    {
      element: '#tour-fab-toggle',
      popover: {
        title: '⚡ Acciones Rápidas',
        description: '<div class="tour-section-badge">ACCIONES RÁPIDAS</div><br>Este botón <strong>expande 4 acciones</strong>. Vamos a abrirlas una a una para que veas lo que hacen.',
        side: 'bottom',
        align: 'end',
      },
      onHighlightStarted: () => {
        actions.expandFab();
      },
    },

    // 6 — Botón Zonas (presentación)
    {
      element: '#tour-fab-zonas',
      popover: {
        title: '🗺️ Asignación de Zonas',
        description: 'Este botón abre el modal de <strong>asignación de móviles a zonas</strong> mediante drag & drop. Vamos a abrirlo para que lo veas...',
        side: 'bottom',
        align: 'end',
      },
      onDeselected: () => {
        // Abrir el modal de zonas al avanzar
        actions.openZonas();
      },
    },

    // 7 — Modal Zonas abierto
    {
      element: '#tour-modal-zonas',
      popover: {
        title: '🗺️ Panel de Asignación de Zonas',
        description: 'Acá ves <strong>3 paneles</strong>:<br><br>• <strong>Izquierda:</strong> Lista de zonas configuradas. Seleccioná una para trabajar.<br>• <strong>Centro:</strong> Dos áreas de drop — <span style="color:#fbbf24"><strong>Prioridad</strong></span> y <span style="color:#22d3ee"><strong>Tránsito</strong></span>. Arrastrá móviles acá.<br>• <strong>Derecha:</strong> Móviles disponibles con buscador para filtrar.<br><br>Arrastrá los móviles de derecha al centro, y al finalizar hacé clic en <strong>"Guardar asignaciones"</strong>.',
        side: 'left',
        align: 'center',
      },
      onDeselected: () => {
        actions.closeZonas();
      },
    },

    // 8 — Botón Ranking (presentación)
    {
      element: '#tour-fab-ranking',
      popover: {
        title: '🏆 Ranking de Móviles',
        description: 'Abre el <strong>Leaderboard</strong> con el ranking de rendimiento diario de toda la flota. Veámoslo...',
        side: 'bottom',
        align: 'end',
      },
      onDeselected: () => {
        actions.openRanking();
      },
    },

    // 9 — Modal Ranking abierto
    {
      element: '#tour-modal-ranking',
      popover: {
        title: '🏆 Ranking de Móviles',
        description: 'El leaderboard muestra:<br><br>• <strong>4 tarjetas resumen</strong> — Móviles, Entregas, En Hora, Cumplimiento %<br>• <strong>Tabla de ranking</strong> — Ordenable por entregas, cumplimiento, en hora, pendientes o total<br>• <strong>🥇🥈🥉</strong> Medallas para los <strong>top 3</strong><br>• <strong>Barra de progreso</strong> visual por cada móvil<br>• Checkbox <strong>"Solo activos"</strong> para filtrar<br><br>Los datos son <strong>en tiempo real</strong> del día actual.',
        side: 'left',
        align: 'center',
      },
      onDeselected: () => {
        actions.closeRanking();
      },
    },

    // 10 — Botón Tracking (presentación)
    {
      element: '#tour-fab-tracking',
      popover: {
        title: '🛤️ Recorrido Histórico',
        description: 'Abre el modal de <strong>tracking</strong> para ver el recorrido de un móvil en el mapa. Veamos cómo funciona...',
        side: 'bottom',
        align: 'end',
      },
      onDeselected: () => {
        actions.openTracking();
      },
    },

    // 11 — Modal Tracking abierto
    {
      element: '#tour-modal-tracking',
      popover: {
        title: '🛤️ Ver Recorrido de un Móvil',
        description: 'Desde acá seleccionás:<br><br>• <strong>🚗 Móvil</strong> — Buscá por número, nombre o patente<br>• <strong>📅 Fecha</strong> — La jornada que querés ver<br><br>Al confirmar, el <strong>recorrido se dibuja animado</strong> sobre el mapa, punto a punto. Luego podés agregar un <strong>2do móvil</strong> desde el control del mapa para <strong>comparar rutas</strong> en paralelo.',
        side: 'right',
        align: 'center',
      },
      onDeselected: () => {
        actions.closeTracking();
      },
    },

    // 12 — Botón POI
    {
      element: '#tour-fab-poi',
      popover: {
        title: '📍 Puntos de Interés (POI)',
        description: 'Activa el <strong>modo marcador</strong>. El cursor cambia a <strong>✛</strong> y cualquier clic en el mapa crea un punto de interés con nombre, color e ícono personalizado.<br><br>Los POIs creados se listan en la sección <strong>"Puntos de Interés"</strong> del panel lateral.',
        side: 'bottom',
        align: 'end',
      },
    },

    // ======================================================
    // PARTE 3: CONFIGURACIÓN (⚙️ Gear)
    // ======================================================

    // 13 — Botón de engranaje (intro)
    {
      element: '#tour-gear-btn',
      popover: {
        title: '⚙️ Filtros y Configuración',
        description: '<div class="tour-section-badge">CONFIGURACIÓN</div><br>Este botón abre el <strong>panel de configuración</strong>. Desde ahí cambiás la fecha, accedés a preferencias y ves tu usuario.',
        side: 'left',
        align: 'start',
      },
      onDeselected: () => {
        clickElement('tour-gear-btn', 100);
      },
    },

    // 14 — Selector de fecha
    {
      element: '#tour-date-selector',
      popover: {
        title: '📅 Selector de Fecha',
        description: 'Cambiá la fecha para ver <strong>datos históricos</strong>. Se recargan todos los pedidos, services y posiciones de esa jornada.',
        side: 'left',
        align: 'start',
      },
    },

    // 15 — Botón de preferencias
    {
      element: '#tour-preferences-btn',
      popover: {
        title: '🔧 Preferencias Avanzadas',
        description: 'Abre el modal de preferencias:<br><br>• <strong>Capa del mapa</strong> — Satélite, calles, terreno, oscuro<br>• <strong>Tiempo de inactividad</strong> — Minutos sin GPS para marcar inactivo<br>• <strong>Modo tiempo real</strong> — Activar/desactivar auto-refresh',
        side: 'left',
        align: 'start',
      },
    },

    // 16 — Info de usuario
    {
      element: '#tour-user-info',
      popover: {
        title: '👤 Tu Usuario',
        description: 'Información de tu <strong>sesión activa</strong>. Debajo encontrás el botón para <strong>cerrar sesión</strong>.',
        side: 'left',
        align: 'end',
      },
      onDeselected: () => {
        clickElement('tour-gear-btn', 100);
      },
    },

    // ======================================================
    // PARTE 4: EL MAPA
    // ======================================================

    // 17 — Mapa principal
    {
      element: '#tour-map-area',
      popover: {
        title: '🗺️ Mapa Interactivo',
        description: '<div class="tour-section-badge">MAPA</div><br>El <strong>corazón de TrackMovil</strong>. Visualización en tiempo real:<br><br>🚗 <strong>Móviles</strong> — Ícono con número y color según ocupación. Activos con efecto "pulso".<br>📦 <strong>Pedidos</strong> — Marcadores coloreados por atraso: <span style="color:#4ade80">verde</span> → <span style="color:#facc15">amarillo</span> → <span style="color:#f472b6">rosa</span> → <span style="color:#f87171">rojo</span><br>🔧 <strong>Services</strong> — Marcadores de servicios técnicos<br>📍 <strong>POIs</strong> — Marcadores personalizados<br><br>Clic en un móvil para ver su popup con detalle completo.',
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

    // 18 — Panel lateral general
    {
      element: '#tour-sidebar',
      popover: {
        title: '📋 Panel Lateral',
        description: '<div class="tour-section-badge">SIDEBAR</div><br>El <strong>panel de control</strong> con todas las listas organizadas. Secciones: <strong>Móviles</strong>, <strong>Pedidos</strong>, <strong>Ped. Finalizados</strong>, <strong>Services</strong>, <strong>Svc. Finalizados</strong> y <strong>Puntos de Interés</strong>.',
        side: 'right',
        align: 'center',
      },
    },

    // 19 — Botón colapsar sidebar
    {
      element: '#tour-sidebar-toggle',
      popover: {
        title: '◀ Colapsar / Expandir',
        description: 'Ocultá o mostrá el panel lateral para ver el mapa en <strong>pantalla completa</strong>.',
        side: 'right',
        align: 'center',
      },
    },

    // 20 — Filtros del sidebar
    {
      element: '#tour-sidebar-filters',
      popover: {
        title: '🔍 Buscador y Filtros',
        description: 'Los filtros cambian según la sección abierta:<br><br>• <strong>Móviles:</strong> Buscar por nro, filtro de capacidad, actividad<br>• <strong>Pedidos/Services:</strong> Buscar por cliente, zona, móvil, atraso<br><br>Los filtros activos aparecen como <strong>badges</strong> removibles.',
        side: 'right',
        align: 'start',
      },
    },

    // 21 — Sección Móviles
    {
      element: '#tour-category-moviles',
      popover: {
        title: '🚗 Sección Móviles',
        description: 'Lista todos los móviles. Clic en uno para <strong>centrarlo en el mapa</strong>.<br><br>Cada móvil muestra: número, último GPS, zona, y <strong>color según pedidos</strong>. Usá <strong>"Seleccionar todos"</strong> o <strong>"Limpiar"</strong> para gestión masiva.',
        side: 'right',
        align: 'start',
      },
    },

    // 22 — Eye toggle
    {
      element: '#tour-eye-toggle',
      popover: {
        title: '👁️ Ocultar / Mostrar Móviles',
        description: '<strong>Oculta o muestra</strong> los marcadores de móviles en el mapa, sin perder la selección. Útil para ver <strong>solo pedidos o POIs</strong>.',
        side: 'left',
        align: 'center',
      },
    },

    // 23 — Sección Pedidos
    {
      element: '#tour-category-pedidos',
      popover: {
        title: '📦 Pedidos Pendientes',
        description: 'Pedidos del día con indicador de atraso:<br><br>• <span style="color:#4ade80">🟢 En tiempo</span> • <span style="color:#facc15">🟡 Próximo</span> • <span style="color:#f472b6">🩷 Atrasado</span> • <span style="color:#f87171">🔴 Muy atrasado</span><br><br>Clic en un pedido → se centra en el mapa.',
        side: 'right',
        align: 'start',
      },
    },

    // 24 — Botón tabla extendida (presentación)
    {
      element: '#tour-pedidos-table-btn',
      popover: {
        title: '📊 Vista Tabla de Pedidos',
        description: 'Este botón abre una <strong>tabla completa</strong> con todos los pedidos. Veámosla...',
        side: 'left',
        align: 'center',
      },
      onDeselected: () => {
        actions.openPedidosTable();
      },
    },

    // 25 — Modal Pedidos Table abierto
    {
      element: '#tour-modal-pedidos-table',
      popover: {
        title: '📊 Vista Extendida de Pedidos',
        description: 'Tabla completa con:<br><br>• <strong>12 columnas</strong> — Atraso, Pedido, Móvil, Zona, Cliente, Dirección, Producto, Cant., Importe, H. Máx, Estado, Coords<br>• <strong>Filtros avanzados:</strong> zona, móvil, producto, atraso, sin coordenadas<br>• <strong>Indicadores de atraso</strong> por colores en la barra superior<br>• <strong>Ordenamiento</strong> por cualquier columna<br>• <strong>Paginación</strong> de 50 por página<br><br>Clic en una fila para centrar ese pedido en el mapa.',
        side: 'left',
        align: 'center',
      },
      onDeselected: () => {
        actions.closePedidosTable();
      },
    },

    // 26 — Pedidos Finalizados
    {
      element: '#tour-category-pedidosFinalizados',
      popover: {
        title: '✅ Pedidos Finalizados',
        description: '<strong>Pedidos ya entregados</strong> del día. Incluye hora de entrega y datos del cliente.',
        side: 'right',
        align: 'start',
      },
    },

    // 27 — Services pendientes
    {
      element: '#tour-category-services',
      popover: {
        title: '🔧 Services Pendientes',
        description: '<strong>Servicios técnicos pendientes</strong> (instalaciones, reparaciones, mantenimiento). Mismo sistema de colores por atraso. Marcadores propios en el mapa.',
        side: 'right',
        align: 'start',
      },
    },

    // 28 — Services finalizados
    {
      element: '#tour-category-servicesFinalizados',
      popover: {
        title: '✅ Services Finalizados',
        description: '<strong>Servicios completados</strong> del día. Hora de finalización y estado de cada trabajo.',
        side: 'right',
        align: 'start',
      },
    },

    // 29 — Puntos de interés
    {
      element: '#tour-category-pois',
      popover: {
        title: '📍 Puntos de Interés',
        description: 'Tus <strong>marcadores personalizados</strong>. Se crean desde el botón 📍 del FAB y los gestionás desde acá.',
        side: 'right',
        align: 'start',
      },
    },

    // ======================================================
    // FINAL
    // ======================================================

    // 30 — Cierre
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
  openZonas: () => void;
  closeZonas: () => void;
  openRanking: () => void;
  closeRanking: () => void;
  openTracking: () => void;
  closeTracking: () => void;
  openPedidosTable: () => void;
  closePedidosTable: () => void;
}

export default function AppTour({
  isOpen,
  onClose,
  expandFab,
  collapseFab,
  openZonas,
  closeZonas,
  openRanking,
  closeRanking,
  openTracking,
  closeTracking,
  openPedidosTable,
  closePedidosTable,
}: AppTourProps) {
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
      if (driverRef.current) {
        driverRef.current.destroy();
        driverRef.current = null;
      }
      hasStarted.current = false;
      return;
    }

    if (hasStarted.current || driverRef.current) return;
    hasStarted.current = true;

    const steps = getTourSteps({
      expandFab,
      collapseFab,
      openZonas,
      closeZonas,
      openRanking,
      closeRanking,
      openTracking,
      closeTracking,
      openPedidosTable,
      closePedidosTable,
    });

    // Para los modales, necesitamos un hook global que espere al elemento
    // antes de mover el highlight. Usamos onHighlightStarted con retry.
    const stepsWithModalWait = steps.map((step) => {
      if (!step.element) return step;
      const elId = (step.element as string).replace('#', '');

      // Pasos que apuntan a modales necesitan esperar a que aparezcan
      if (elId.startsWith('tour-modal-')) {
        return {
          ...step,
          onHighlightStarted: async () => {
            // Esperar un poco para que el modal aparezca en el DOM
            await waitForElement(elId, 2000);
          },
        } as DriveStep;
      }
      return step;
    });

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
      steps: stepsWithModalWait,
      onDestroyed: () => {
        // Asegurar que todos los modales se cierren al terminar
        closeZonas();
        closeRanking();
        closeTracking();
        closePedidosTable();
        collapseFab();
        // Cerrar el gear panel si quedó abierto
        const gearPanel = document.getElementById('tour-date-selector');
        if (gearPanel && gearPanel.offsetParent !== null) {
          clickElement('tour-gear-btn', 50);
        }
        driverRef.current = null;
        hasStarted.current = false;
        onClose();
      },
    };

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

  // Cleanup al desmontar
  useEffect(() => {
    return () => {
      if (driverRef.current) {
        driverRef.current.destroy();
        driverRef.current = null;
      }
    };
  }, []);

  return null;
}
