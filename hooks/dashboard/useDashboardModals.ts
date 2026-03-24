import { useState, useCallback } from 'react';

/**
 * Hook que centraliza todo el estado de modales del dashboard.
 * Maneja apertura/cierre de ~12 modales y pre-filtros para vistas extendidas.
 */
export function useDashboardModals() {
  // Modal de tracking
  const [isTrackingModalOpen, setIsTrackingModalOpen] = useState(false);

  // Modal de leaderboard/ranking
  const [isLeaderboardOpen, setIsLeaderboardOpen] = useState(false);

  // Modal de estadísticas por zona
  const [isZonaEstadisticasOpen, setIsZonaEstadisticasOpen] = useState(false);

  // Modal de vista móviles por zona
  const [zonaViewModalOpen, setZonaViewModalOpen] = useState(false);
  const [zonaViewModalZonaId, setZonaViewModalZonaId] = useState<number | null>(null);

  // Modal de vista extendida de pedidos
  const [isPedidosTableOpen, setIsPedidosTableOpen] = useState(false);

  // Modal de vista extendida de services
  const [isServicesTableOpen, setIsServicesTableOpen] = useState(false);

  // Pre-filtros para vistas extendidas
  const [preFilterMovil, setPreFilterMovil] = useState<number | undefined>();
  const [preFilterZona, setPreFilterZona] = useState<number | undefined>();

  // Modal de importación OSM
  const [isOsmImportOpen, setIsOsmImportOpen] = useState(false);

  // Tour interactivo
  const [isTourOpen, setIsTourOpen] = useState(false);

  // FAB (floating action buttons) expandido
  const [isActionsExpanded, setIsActionsExpanded] = useState(false);

  // --- Helpers ---

  /** Abrir modal de vista de zona (con zonaId específica o null para todas) */
  const openZonaView = useCallback((zonaId: number | null = null) => {
    setZonaViewModalZonaId(zonaId);
    setZonaViewModalOpen(true);
  }, []);

  /** Cerrar modal de pedidos y limpiar pre-filtros */
  const closePedidosTable = useCallback(() => {
    setIsPedidosTableOpen(false);
    setPreFilterMovil(undefined);
    setPreFilterZona(undefined);
  }, []);

  /** Cerrar modal de services y limpiar pre-filtros */
  const closeServicesTable = useCallback(() => {
    setIsServicesTableOpen(false);
    setPreFilterMovil(undefined);
    setPreFilterZona(undefined);
  }, []);

  /** Limpiar pre-filtros sin cerrar modales */
  const clearPreFilters = useCallback(() => {
    setPreFilterMovil(undefined);
    setPreFilterZona(undefined);
  }, []);

  return {
    // Tracking
    isTrackingModalOpen, setIsTrackingModalOpen,
    // Leaderboard
    isLeaderboardOpen, setIsLeaderboardOpen,
    // Zona Estadísticas
    isZonaEstadisticasOpen, setIsZonaEstadisticasOpen,
    // Zona View
    zonaViewModalOpen, setZonaViewModalOpen,
    zonaViewModalZonaId, openZonaView,
    // Pedidos Table
    isPedidosTableOpen, setIsPedidosTableOpen,
    // Services Table
    isServicesTableOpen, setIsServicesTableOpen,
    // Pre-filters
    preFilterMovil, setPreFilterMovil,
    preFilterZona, setPreFilterZona,
    // OSM Import
    isOsmImportOpen, setIsOsmImportOpen,
    // Tour
    isTourOpen, setIsTourOpen,
    // FAB
    isActionsExpanded, setIsActionsExpanded,
    // Helpers
    closePedidosTable, closeServicesTable, clearPreFilters,
  };
}
