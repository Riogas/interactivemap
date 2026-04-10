'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import dynamic from 'next/dynamic';
import { motion } from 'framer-motion';
import { MovilData, EmpresaFleteraSupabase, PedidoSupabase, ServiceSupabase, CustomMarker, MovilFilters, PedidoFilters, ServiceFilters } from '@/types';
import MovilSelector from '@/components/ui/MovilSelector';
import NavbarSimple from '@/components/layout/NavbarSimple';
import FloatingToolbar from '@/components/layout/FloatingToolbar';
import DashboardIndicators from '@/components/dashboard/DashboardIndicators';
import { useRealtime } from '@/components/providers/RealtimeProvider';
import { useUserPreferences } from '@/components/ui/PreferencesModal';
import ProtectedRoute from '@/components/auth/ProtectedRoute';
import { useAuth } from '@/contexts/AuthContext';
import { usePedidosRealtime, useServicesRealtime } from '@/lib/hooks/useRealtimeSubscriptions';
import { useTabVisibility } from '@/hooks/usePerformanceOptimizations';
import { computeDelayMinutes, getDelayInfo } from '@/utils/pedidoDelay';
import { useFilterHelpers } from '@/hooks/dashboard/useFilterHelpers';
import { useDashboardModals } from '@/hooks/dashboard/useDashboardModals';
import { useMapDataView } from '@/hooks/dashboard/useMapDataView';
import TrackingModal from '@/components/ui/TrackingModal';
import LeaderboardModal from '@/components/ui/LeaderboardModal';
import ZonaMovilesViewModal from '@/components/ui/ZonaMovilesViewModal';
import ZonaEstadisticasModal from '@/components/ui/ZonaEstadisticasModal';
import PedidosTableModal from '@/components/ui/PedidosTableModal';
import ServicesTableModal from '@/components/ui/ServicesTableModal';
import OsmImportModal from '@/components/ui/OsmImportModal';
import AppTour from '@/components/ui/AppTour';
import FleterasZonasModal from '@/components/ui/FleterasZonasModal';
import ZonasSinMovilModal from '@/components/ui/ZonasSinMovilModal';
import MovilesSinReportarModal from '@/components/ui/MovilesSinReportarModal';
import ZonasNoActivasModal from '@/components/ui/ZonasNoActivasModal';

// Import MapView dynamically to avoid SSR issues with Leaflet
const MapView = dynamic(() => import('@/components/map/MapView'), {
  ssr: false,
  loading: () => (
    <div className="h-full w-full bg-gray-100 rounded-xl flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4" />
        <p className="text-gray-600">Cargando mapa...</p>
      </div>
    </div>
  ),
});

function DashboardContent() {
  // Hook de autenticación (para obtener empresas permitidas)
  const { user } = useAuth();
  
  // Hook de Realtime para escuchar actualizaciones GPS y móviles nuevos
  const { latestPosition, latestMovil, isConnected } = useRealtime();
  
  // Hook de preferencias de usuario
  const { preferences, updatePreferences, updatePreference } = useUserPreferences();
  
  const [moviles, setMoviles] = useState<MovilData[]>([]);
  const movilesRef = useRef<MovilData[]>([]); // Ref para acceso sincrónico en callbacks
  movilesRef.current = moviles;
  const [selectedMoviles, setSelectedMoviles] = useState<number[]>([]); // Array de móviles seleccionados
  const userExplicitlyCleared = useRef(false); // Evita auto-selección cuando el usuario intencionalmente deseleccionó
  
  // 🚀 Optimización: Detectar visibilidad de tab para pausar updates
  const isTabVisible = useTabVisibility();
  
  const [focusedMovil, setFocusedMovil] = useState<number | undefined>(); // Móvil enfocado en el mapa (para centrar)
  const [selectedMovil, setSelectedMovil] = useState<number | undefined>(); // Móvil seleccionado para animación
  const [selectedMovil2, setSelectedMovil2] = useState<number | undefined>(); // 2do móvil para animación dual
  const [popupMovil, setPopupMovil] = useState<number | undefined>(); // Móvil con popup abierto
  const [popupPedido, setPopupPedido] = useState<number | undefined>(); // Pedido con popup abierto
  const [popupService, setPopupService] = useState<number | undefined>(); // Service con popup abierto
  const [focusedPedidoId, setFocusedPedidoId] = useState<number | undefined>(); // Pedido a centralizar
  const [focusedServiceId, setFocusedServiceId] = useState<number | undefined>(); // Service a centralizar
  const focusTriggerRef = useRef(0); // Trigger para forzar re-centrar el mismo pedido/service
  const [focusTrigger, setFocusTrigger] = useState(0);
  const [focusedPuntoId, setFocusedPuntoId] = useState<string | undefined>(); // Punto a centralizar
  const [showPendientes, setShowPendientes] = useState(false); // Mostrar marcadores de pedidos
  const [showCompletados, setShowCompletados] = useState(false); // Mostrar marcadores de completados
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isInitialLoad, setIsInitialLoad] = useState(true); // Flag para carga inicial
  
  // Estado para marcadores personalizados
  const [isPlacingMarker, setIsPlacingMarker] = useState(false);
  
  // 🔧 Modal state (extracted to useDashboardModals hook)
  const {
    isTrackingModalOpen, setIsTrackingModalOpen,
    isLeaderboardOpen, setIsLeaderboardOpen,
    isZonaEstadisticasOpen, setIsZonaEstadisticasOpen,
    zonaViewModalOpen, setZonaViewModalOpen,
    zonaViewModalZonaId, openZonaView,
    isPedidosTableOpen, setIsPedidosTableOpen,
    isServicesTableOpen, setIsServicesTableOpen,
    preFilterMovil, setPreFilterMovil,
    preFilterZona, setPreFilterZona,
    isOsmImportOpen, setIsOsmImportOpen,
    isTourOpen, setIsTourOpen,
    isActionsExpanded, setIsActionsExpanded,
    isFleterasZonasOpen, setIsFleterasZonasOpen,
    closePedidosTable, closeServicesTable,
  } = useDashboardModals();

  const [isZonasSinMovilOpen, setIsZonasSinMovilOpen] = useState(false);
  const [isMovilesSinReportarOpen, setIsMovilesSinReportarOpen] = useState(false);
  const [isZonasNoActivasOpen, setIsZonasNoActivasOpen] = useState(false);

  // Mapa completo movil_nro → estadoNro (para todos los moviles, no solo los con GPS)
  const [allMovilEstados, setAllMovilEstados] = useState<Map<string, number>>(new Map());
  
  // Trigger para recargar marcadores del mapa tras importación OSM
  const [reloadMarkersTrigger, setReloadMarkersTrigger] = useState(0);
  
  // Estado para ocultar/mostrar indicadores de móviles en el mapa (persistido en preferencias)
  const movilesHidden = !preferences.movilesVisible;
  const setMovilesHidden = useCallback((hidden: boolean) => updatePreference('movilesVisible', !hidden), [updatePreference]);
  
  // Estado para ocultar/mostrar indicadores de pedidos en el mapa (persistido en preferencias)
  const pedidosHidden = !preferences.pedidosVisible;
  const setPedidosHidden = useCallback((hidden: boolean) => updatePreference('pedidosVisible', !hidden), [updatePreference]);
  
  // Estado para ocultar/mostrar indicadores de services en el mapa (persistido en preferencias)
  const servicesHidden = !preferences.servicesVisible;
  const setServicesHidden = useCallback((hidden: boolean) => updatePreference('servicesVisible', !hidden), [updatePreference]);
  
  // Estado para ocultar/mostrar POIs y categorías de POIs (persistido en preferencias)
  const poisHidden = !preferences.poisVisible;
  const setPoisHidden = useCallback((hidden: boolean) => updatePreference('poisVisible', !hidden), [updatePreference]);
  const hiddenPoiCategories = useMemo(() => new Set(preferences.hiddenPoiCategories || []), [preferences.hiddenPoiCategories]);
  const togglePoiCategory = useCallback((category: string) => {
    const current = preferences.hiddenPoiCategories || [];
    const next = current.includes(category) ? current.filter((c: string) => c !== category) : [...current, category];
    updatePreference('hiddenPoiCategories', next);
  }, [preferences.hiddenPoiCategories, updatePreference]);
  
  // Estado para puntos de interés
  const [puntosInteres, setPuntosInteres] = useState<CustomMarker[]>([]);

  // 📊 Vista de datos del mapa — dataViewMode persistido en preferencias
  const dataViewMode = preferences.dataViewMode;
  
  // Estado para el panel colapsable
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  
  // 📐 Sidebar responsive: ancho dinámico según resolución
  const [sidebarWidth, setSidebarWidth] = useState(384);
  useEffect(() => {
    const updateSidebarWidth = () => {
      // < 1024px (lg): sidebar más angosto para dejar más espacio al mapa
      setSidebarWidth(window.innerWidth < 1024 ? 320 : 384);
    };
    updateSidebarWidth();
    window.addEventListener('resize', updateSidebarWidth);
    return () => window.removeEventListener('resize', updateSidebarWidth);
  }, []);
  
  // Estado para empresas fleteras
  const [empresas, setEmpresas] = useState<EmpresaFleteraSupabase[]>([]);
  const [selectedEmpresas, setSelectedEmpresas] = useState<number[]>([]);

  // 🔧 Map data view state + effects (extracted to useMapDataView hook)
  const {
    showZonas, setShowZonas,
    zonasData, allZonasData, demorasData,
    movilesZonasData, movilesZonasServiceFilter, setMovilesZonasServiceFilter,
    handleDataViewChange,
  } = useMapDataView({
    dataViewMode,
    selectedEmpresas,
    empresas,
    demorasPollingSeconds: preferences.demorasPollingSeconds ?? 30,
    movilesZonasPollingSeconds: preferences.movilesZonasPollingSeconds ?? 30,
    updatePreference,
  });

  // Escenario IDs derivados de las empresas seleccionadas (stable reference)
  const selectedEscenarioIds = useMemo(() => {
    return [...new Set(
      selectedEmpresas
        .map(id => empresas.find(e => e.empresa_fletera_id === id)?.escenario_id)
        .filter((v): v is number => v != null)
    )];
  }, [selectedEmpresas, empresas]);
  
  // � Móviles filtrados por empresas fleteras seleccionadas
  const movilesFiltered = useMemo(() => {
    if (selectedEmpresas.length === 0) return moviles;
    return moviles.filter(m => 
      m.empresaFleteraId && selectedEmpresas.includes(m.empresaFleteraId)
    );
  }, [moviles, selectedEmpresas]);
  
  // Estado para filtros de móviles (recibidos desde MovilSelector)
  const [movilesFilters, setMovilesFilters] = useState<MovilFilters>({ 
    capacidad: 'all', 
    estado: [],
    actividad: 'activo'
  });

  // Estado para filtros de pedidos y services (lifted desde MovilSelector para compartir con MapView)
  const [pedidosFilters, setPedidosFilters] = useState<PedidoFilters>({ atraso: [], tipoServicio: 'all', vista: 'pendientes' });
  const [servicesFilters, setServicesFilters] = useState<ServiceFilters>({ atraso: [], tipoServicio: 'all', vista: 'pendientes' });
  
  // Tipos de servicio dinámicos desde servicio_nombre de pedidos y services (calculado abajo con useMemo)
  
  // 🔥 NUEVO: Hook para escuchar cambios en pedidos en tiempo real
  const { 
    pedidos: pedidosRealtime, 
    isConnected: pedidosConnected,
    error: pedidosError 
  } = usePedidosRealtime(
    1000, // escenarioId (ajustar según tu base de datos)
    undefined // Cargar TODOS los pedidos (sin filtrar por móvil)
  );

  // 🔧 Hook para escuchar cambios en services en tiempo real
  const { 
    services: servicesRealtime, 
    isConnected: servicesConnected,
    error: servicesError 
  } = useServicesRealtime(
    1000,
    undefined
  );
  
  // Estado para pedidos cargados inicialmente
  const [pedidosIniciales, setPedidosIniciales] = useState<PedidoSupabase[]>([]);
  const [isLoadingPedidos, setIsLoadingPedidos] = useState(true);

  // Estado para services cargados inicialmente
  const [servicesIniciales, setServicesIniciales] = useState<ServiceSupabase[]>([]);
  const [isLoadingServices, setIsLoadingServices] = useState(true);
  
  const [isLoadingEmpresas, setIsLoadingEmpresas] = useState(true);
  
  // Estado para fecha seleccionada (por defecto hoy)
  const [selectedDate, setSelectedDate] = useState<string>(() => {
    const today = new Date();
    return today.toISOString().split('T')[0]; // Formato YYYY-MM-DD
  });

  // 🔧 Filter helpers (extracted to useFilterHelpers hook)
  const {
    isInUruguay, filterByDelay, filterByTipoServicio,
    applyAdvancedFilters, applyActivityFilter,
    removeDuplicateMoviles, markInactiveMoviles, getMovilColorByOccupancy,
  } = useFilterHelpers(movilesFilters, preferences);

  // Cargar empresas fleteras al montar el componente
  useEffect(() => {
    const loadEmpresas = async () => {
      try {
        console.log('🏢 Loading empresas fleteras...');
        const response = await fetch('/api/empresas');
        const result = await response.json();
        
        if (result.success) {
          let empresasData: EmpresaFleteraSupabase[] = result.data;
          
          // 🔑 Si el usuario NO es root y tiene empresas permitidas, filtrar
          if (user?.allowedEmpresas && user.allowedEmpresas.length > 0) {
            const allowedIds = user.allowedEmpresas;
            const empresasFiltradas = empresasData.filter(
              (e: EmpresaFleteraSupabase) => allowedIds.includes(e.empresa_fletera_id)
            );
            console.log(`🔐 Usuario ${user.username}: ${empresasFiltradas.length}/${empresasData.length} empresas permitidas (IDs: ${allowedIds.join(', ')})`);
            empresasData = empresasFiltradas;
          } else {
            console.log(`👑 Usuario ${user?.username || 'unknown'}: acceso a todas las empresas (${empresasData.length})`);
          }
          
          setEmpresas(empresasData);
          // Por defecto, seleccionar todas las empresas (filtradas o no)
          setSelectedEmpresas(empresasData.map((e: EmpresaFleteraSupabase) => e.empresa_fletera_id));
          console.log(`✅ Loaded ${empresasData.length} empresas fleteras`);
        }
      } catch (err) {
        console.error('❌ Error loading empresas:', err);
      } finally {
        setIsLoadingEmpresas(false);
      }
    };
    
    loadEmpresas();
  }, [user?.allowedEmpresas]);





  // 🔥 NUEVO: Función para enriquecer móviles con datos extendidos de Supabase
  const enrichMovilesWithExtendedData = useCallback(async (moviles: MovilData[]): Promise<MovilData[]> => {
    try {
      console.log('📊 Fetching extended data for moviles...');
      const response = await fetch('/api/moviles-extended');
      const result = await response.json();

      if (result.success) {
        // Definir tipo para los datos extendidos
        interface ExtendedData {
          id: string;           // TEXT - ID del móvil (clave principal)
          nro: number;          // INTEGER - Número del móvil
          tamanoLote: number;
          pedidosAsignados: number;
          matricula: string;
          descripcion: string;
          estadoDesc: string;
          estadoNro: number | null;
        }

        // Mapear por ID (que es TEXT), no por nro
        const extendedDataMap = new Map<string, ExtendedData>(
          result.data.map((item: ExtendedData) => [item.id, item])
        );

        console.log('📊 Extended data map size:', extendedDataMap.size);

        const enrichedMoviles = moviles.map(movil => {
          // Convertir movil.id a string para buscar en el map
          const extendedData = extendedDataMap.get(movil.id.toString());
          if (extendedData) {
            // Si el móvil es NO ACTIVO (estado_nro 3), usar color gris
            // Si el móvil es BAJA MOMENTÁNEA (estado_nro 4), usar color naranja
            const isNoActivo = extendedData.estadoNro === 3;
            const isBajaMomentanea = extendedData.estadoNro === 4;
            const calculatedColor = isNoActivo 
              ? '#9CA3AF' // Gris para NO ACTIVO
              : isBajaMomentanea
                ? '#8B5CF6' // Violeta para BAJA MOMENTÁNEA
                : getMovilColorByOccupancy(extendedData.pedidosAsignados, extendedData.tamanoLote);
            
            return {
              ...movil,
              tamanoLote: extendedData.tamanoLote,
              pedidosAsignados: extendedData.pedidosAsignados,
              matricula: extendedData.matricula,
              estadoDesc: extendedData.estadoDesc,
              estadoNro: extendedData.estadoNro ?? undefined,
              color: calculatedColor,
            };
          }
          return movil;
        });

        // Guardar mapa completo de estados (cubre moviles sin GPS)
        const estadosMap = new Map<string, number>();
        for (const item of result.data) {
          if (item.estadoNro !== undefined && item.estadoNro !== null) {
            estadosMap.set(String(item.nro), item.estadoNro);
          }
        }
        setAllMovilEstados(estadosMap);

        console.log(`✅ Enriched ${enrichedMoviles.length} moviles, ${estadosMap.size} estados`);
        return enrichedMoviles;
      }

      console.warn('⚠️ Could not fetch extended data, returning original moviles');
      return moviles;
    } catch (error) {
      console.error('❌ Error enriching moviles:', error);
      return moviles;
    }
  }, [getMovilColorByOccupancy]);

  const fetchPositions = useCallback(async () => {
    try {
      console.log('🔄 Fetching all positions from API...');
      
      // Construir URL con filtro de empresas y fecha
      const params = new URLSearchParams();
      if (selectedDate) {
        params.append('startDate', selectedDate);
      }
      if (selectedEmpresas.length > 0 && selectedEmpresas.length < empresas.length) {
        params.append('empresaIds', selectedEmpresas.join(','));
      }
      
      let url = '/api/all-positions';
      if (params.toString()) {
        url += `?${params.toString()}`;
      }
      
      const response = await fetch(url);
      const result = await response.json();

      if (result.success) {
        console.log(`✅ Received ${result.count} móviles from API`);
        
        if (isInitialLoad) {
          // PRIMERA CARGA: Crear array completo de móviles
          const newMoviles: MovilData[] = result.data.map((item: { 
            movilId: number; 
            movilName: string; 
            color: string;
            empresa_fletera_id: number;
            position: any 
          }) => ({
            id: Number(item.movilId),
            name: item.movilName,
            color: item.color,
            empresaFleteraId: item.empresa_fletera_id,
            currentPosition: item.position,
            history: undefined, // Se cargará bajo demanda
          }));
          
          console.log('📊 Sample movil from API:', newMoviles[0]); // Ver ID del móvil
          
          // Eliminar duplicados antes de establecer
          const uniqueMoviles = removeDuplicateMoviles(newMoviles);
          
          // 🔥 NUEVO: Enriquecer con datos extendidos de Supabase
          const enrichedMoviles = await enrichMovilesWithExtendedData(uniqueMoviles);
          
          setMoviles(enrichedMoviles);
          setIsInitialLoad(false); // Marcar que ya no es carga inicial
          console.log(`📦 Carga inicial completa con ${enrichedMoviles.length} móviles únicos enriquecidos`);
        } else {
          // ACTUALIZACIÓN: Solo actualizar las posiciones GPS manteniendo TODAS las propiedades
          setMoviles(prevMoviles => {
            return prevMoviles.map(movil => {
              // Buscar la nueva posición de este móvil
              const updatedData = result.data.find((item: any) => item.movilId === movil.id);
              
              if (updatedData) {
                // Solo actualizar currentPosition, mantener TODO el resto igual
                // (history, pendientes, pedidosPendientes, serviciosPendientes, tamanoLote, pedidosAsignados)
                return {
                  ...movil, // Mantener TODAS las propiedades existentes
                  currentPosition: updatedData.position, // Solo actualizar posición
                };
              }
              
              // Si el móvil no está en la actualización, mantenerlo sin cambios
              return movil;
            });
          });
          console.log('🔄 Posiciones GPS actualizadas (historial, pendientes y datos extendidos preservados)');
        }
        
        setLastUpdate(new Date());
        setError(null);
      } else {
        setError(result.error || 'Error al cargar datos');
      }
    } catch (err) {
      console.error('❌ Error fetching positions:', err);
      setError('Error de conexión');
    } finally {
      setIsLoading(false);
    }
  }, [selectedEmpresas, empresas.length, isInitialLoad, enrichMovilesWithExtendedData, removeDuplicateMoviles]);

  // Función para cargar TODOS los pedidos del día desde API
  // El filtrado por móviles seleccionados se hace client-side en MovilSelector y MapView
  const fetchPedidos = useCallback(async () => {
    try {
      console.log('📦 Fetching pedidos para fecha:', selectedDate);
      setIsLoadingPedidos(true);
      
      // Construir URL - traer TODOS los pedidos del día (sin filtrar por móvil)
      const params = new URLSearchParams();
      params.append('escenario', '1000');
      if (selectedDate) {
        params.append('fecha', selectedDate);
      }
      
      const url = `/api/pedidos?${params.toString()}`;
      
      const response = await fetch(url);
      
      const result = await response.json();

      if (result.success) {
        console.log(`✅ Loaded ${result.count} pedidos`);
        setPedidosIniciales(result.data || []);
      } else {
        console.error('❌ Error loading pedidos:', result.error);
      }
    } catch (err) {
      console.error('❌ Error fetching pedidos:', err);
      console.error('❌ Error details:', {
        name: (err as Error).name,
        message: (err as Error).message,
        stack: (err as Error).stack
      });
    } finally {
      setIsLoadingPedidos(false);
    }
  }, [selectedDate]);

  // Función para cargar TODOS los services del día desde API
  const fetchServices = useCallback(async () => {
    try {
      console.log('🔧 Fetching services para fecha:', selectedDate);
      setIsLoadingServices(true);
      
      const params = new URLSearchParams();
      params.append('escenario', '1000');
      if (selectedDate) {
        params.append('fecha', selectedDate);
      }
      
      const url = `/api/services?${params.toString()}`;
      const response = await fetch(url);
      const result = await response.json();

      if (result.success) {
        console.log(`✅ Loaded ${result.count} services`);
        setServicesIniciales(result.data || []);
      } else {
        console.error('❌ Error loading services:', result.error);
      }
    } catch (err) {
      console.error('❌ Error fetching services:', err);
    } finally {
      setIsLoadingServices(false);
    }
  }, [selectedDate]);

  // 🔥 NUEVO: Seleccionar todos los móviles automáticamente en la carga inicial
  useEffect(() => {
    // Solo auto-seleccionar si:
    // 1. Hay móviles cargados
    // 2. No hay ningún móvil seleccionado (primera carga)
    // 3. No es carga inicial (ya terminó la carga)
    // 4. El usuario NO limpió explícitamente la selección
    if (movilesFiltered.length > 0 && selectedMoviles.length === 0 && !isInitialLoad && !userExplicitlyCleared.current) {
      console.log('✅ Auto-selección inicial: Marcando todos los móviles por defecto:', movilesFiltered.length);
      setSelectedMoviles(movilesFiltered.map(m => m.id));
    }
  }, [movilesFiltered.length, isInitialLoad]); // Depende de la cantidad de móviles y si es carga inicial

  // Recargar móviles cuando cambia la selección de empresas o la fecha (forzar recarga completa)
  useEffect(() => {
    if (!isLoadingEmpresas) {
      console.log('🏢 Empresas o fecha cambiaron - Forzando recarga completa');
      setIsInitialLoad(true); // Forzar recarga completa cuando cambian las empresas o la fecha
      userExplicitlyCleared.current = false; // Reset: recarga = nueva selección automática
      setSelectedMoviles([]); // Limpiar selección para que auto-selección re-seleccione los filtrados
      fetchPositions();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEmpresas, isLoadingEmpresas, selectedDate]); // Remover fetchPositions de dependencias para evitar loops

  // 🔥 Escuchar actualizaciones en tiempo real de Supabase (solo si está activado)
  useEffect(() => {
    // Si el modo Tiempo Real está desactivado, no escuchar actualizaciones de Supabase
    if (!preferences.realtimeEnabled) {
      console.log('⏸️ Modo Tiempo Real desactivado - ignorando actualizaciones de Supabase');
      return;
    }
    
    if (!latestPosition) return;
    
    const movilId = parseInt(latestPosition.movil_id); // ✅ Usar 'movil_id'
    // La tabla gps_latest_positions se limpia cada madrugada por cron,
    // así que toda posición que llega por Realtime es vigente.
    console.log(`🔔 Actualización Realtime para móvil ${movilId}`);
    
    setMoviles(prevMoviles => {
      // Buscar si el móvil ya existe en la lista
      const movilExists = prevMoviles.some(m => m.id === movilId);
      
      if (!movilExists) {
        // 🆕 Móvil no existe en la lista - buscarlo en la API y agregarlo
        console.log(`🔍 Móvil ${movilId} no existe en lista, cargándolo desde API...`);
        
        // Hacer fetch asíncrono del móvil
        fetch(`/api/all-positions?movilId=${movilId}`)
          .then(res => res.json())
          .then(result => {
            if (result.success && result.data.length > 0) {
              const movilData = result.data[0];
              
              // 🔒 VERIFICAR SI EL MÓVIL PERTENECE A LAS EMPRESAS SELECCIONADAS
              const perteneceAEmpresaSeleccionada = 
                selectedEmpresas.length === 0 || // Si no hay filtro, mostrar todos
                selectedEmpresas.includes(movilData.empresa_fletera_id);
              
              if (!perteneceAEmpresaSeleccionada) {
                console.log(`🚫 Móvil ${movilId} pertenece a empresa ${movilData.empresa_fletera_id} que NO está seleccionada. No se agregará.`);
                return; // No agregar el móvil
              }
              
              const newMovil: MovilData = {
                id: movilData.movilId,
                name: movilData.movilName,
                color: movilData.color,
                empresaFleteraId: movilData.empresa_fletera_id,
                currentPosition: movilData.position,
                history: undefined,
              };
              
              console.log(`✅ Móvil ${movilId} de empresa ${movilData.empresa_fletera_id} cargado y agregado a la lista`);
              setMoviles(prev => {
                // Verificar nuevamente que no exista (por si se agregó mientras esperábamos)
                if (prev.some(m => m.id === movilId)) {
                  console.warn(`⚠️ Móvil ${movilId} ya existe, no se agregará duplicado`);
                  return prev;
                }
                return removeDuplicateMoviles([...prev, newMovil]);
              });
            }
          })
          .catch(err => {
            console.error(`❌ Error cargando móvil ${movilId}:`, err);
          });
        
        // Retornar lista sin cambios por ahora (se actualizará con el fetch)
        return prevMoviles;
      }
      
      // Móvil existe - actualizar su posición
      return prevMoviles.map(movil => {
        if (movil.id === movilId) {
          // Actualizar posición actual
          const newPosition = {
            identificador: latestPosition.id,
            origen: 'SUPABASE_REALTIME',
            coordX: parseFloat(latestPosition.latitud.toString()),
            coordY: parseFloat(latestPosition.longitud.toString()),
            fechaInsLog: latestPosition.fecha_hora,
            auxIn2: latestPosition.velocidad?.toString() || '0',
            distRecorrida: latestPosition.distancia_recorrida || 0,
          };
          
          return {
            ...movil,
            currentPosition: newPosition,
            // Agregar a history si existe
            history: movil.history 
              ? [newPosition, ...movil.history]
              : undefined
          };
        }
        return movil;
      });
    });
    
    setLastUpdate(new Date());
  }, [latestPosition, removeDuplicateMoviles, preferences.realtimeEnabled]);

  // 🚗 Escuchar cuando aparece un móvil nuevo en la base de datos (solo si está activado)
  useEffect(() => {
    // Si el modo Tiempo Real está desactivado, no escuchar nuevos móviles
    if (!preferences.realtimeEnabled) {
      console.log('⏸️ Modo Tiempo Real desactivado - ignorando nuevos móviles');
      return;
    }
    
    if (!latestMovil) return;
    
    const movilId = parseInt(latestMovil.id); // ✅ Usar 'id' y convertir a number
    console.log(`🚗 Nuevo móvil detectado en tiempo real:`, latestMovil);
    
    setMoviles(prevMoviles => {
      // Verificar si el móvil ya existe en la lista
      const existingMovil = prevMoviles.find(m => m.id === movilId);
      
      if (existingMovil) {
        console.log(`ℹ️ Móvil ${movilId} ya existe, ignorando evento`);
        return prevMoviles;
      }
      
      // Agregar el nuevo móvil a la lista
      const newMovil: MovilData = {
        id: movilId,
        name: `Móvil-${movilId}`,
        color: `hsl(${(movilId * 137.508) % 360}, 70%, 50%)`, // Color generado
        currentPosition: undefined, // Se actualizará con el primer GPS
        history: undefined,
      };
      
      console.log(`✅ Agregando móvil ${movilId} a la lista`);
      return removeDuplicateMoviles([...prevMoviles, newMovil]);
    });
    
    setLastUpdate(new Date());
  }, [latestMovil, removeDuplicateMoviles, preferences.realtimeEnabled]);

  // Función para cargar el historial de un móvil específico
  const fetchMovilHistory = useCallback(async (movilId: number) => {
    try {
      console.log(`📜 Fetching history for móvil ${movilId}...`);
      const url = `/api/movil/${movilId}${selectedDate ? `?startDate=${selectedDate}` : ''}`;
      const response = await fetch(url);
      const result = await response.json();

      if (result.success) {
        console.log(`✅ Received ${result.count} coordinates for móvil ${movilId}`);
        console.log(`📊 Primeros 3 registros:`, result.data.slice(0, 3));
        
        // Actualizar el móvil con su historial
        setMoviles(prevMoviles => {
          const updated = prevMoviles.map(movil => {
            if (movil.id === movilId) {
              console.log(`🔧 Actualizando móvil ${movilId} con ${result.data.length} registros en history`);
              return {
                ...movil,
                history: result.data,
                currentPosition: result.data[0], // La primera es la más reciente
              };
            }
            return movil;
          });
          console.log(`🔧 Estado actualizado. Móvil ${movilId} ahora tiene history:`, updated.find(m => m.id === movilId)?.history?.length);
          return updated;
        });
      }
    } catch (err) {
      console.error(`❌ Error fetching history for móvil ${movilId}:`, err);
    }
  }, [selectedDate]);

  // Función para cargar los pedidos pendientes de móviles seleccionados O todos
  const fetchPedidosPendientes = useCallback(async (movilesIds: number[]) => {
    try {
      // selectedDate ya es un string en formato 'YYYY-MM-DD'
      const fecha = selectedDate;
      
      // CASO 1: Si NO hay móviles seleccionados, traer TODOS los pedidos del día
      if (movilesIds.length === 0) {
        console.log(`📦 Cargando TODOS los pedidos pendientes del día`);
        
        const response = await fetch(`/api/pedidos-pendientes?escenarioId=1000&fecha=${fecha}`);
        const result = await response.json();
        
        if (result.pedidos && result.pedidos.length > 0) {
          console.log(`✅ Encontrados ${result.pedidos.length} pedidos pendientes en total`);
          
            // Convertir todos los pedidos a formato PedidoServicio
          const todosPedidos = result.pedidos.map((p: any) => ({
            tipo: 'PEDIDO' as const,
            id: p.id || p.pedido_id,
            cliid: 0,
            clinom: p.cliente_nombre || 'Sin nombre',
            fecha: p.fecha_para || p.fch_para || '',
            x: p.latitud,
            y: p.longitud,
            estado: Number(p.estado_nro ?? p.estado ?? 0),
            subestado: 0,
            zona: String(p.zona_nro ?? p.zona ?? ''),
            producto_codigo: p.producto_cod ?? p.producto_codigo ?? '',
            producto_nombre: p.producto_nom ?? p.producto_nombre ?? '',
            producto_cantidad: p.producto_cant ?? p.producto_cantidad ?? 0,
            observacion: p.pedido_obs ?? p.observacion ?? '',
            prioridad: p.prioridad || 0,
            movilId: p.movil,
          }));          // Actualizar móviles agrupando pedidos por móvil
          setMoviles(prevMoviles => {
            return prevMoviles.map(movil => {
              const pedidosDelMovil = todosPedidos.filter((p: any) => p.movilId === movil.id);
              const pedidosEstado1 = pedidosDelMovil.filter((p: any) => p.estado === 1);
              
              if (pedidosDelMovil.length > 0) {
                return {
                  ...movil,
                  pendientes: pedidosDelMovil,
                  pedidosPendientes: pedidosEstado1.length,
                };
              }
              
              return {
                ...movil,
                pendientes: [],
                pedidosPendientes: 0,
              };
            });
          });
        } else {
          console.log(`ℹ️ No hay pedidos pendientes para el día ${fecha}`);
        }
        
        return;
      }
      
      // CASO 2: Si HAY móviles seleccionados, traer solo sus pedidos
      console.log(`📦 Cargando pedidos pendientes para móviles:`, movilesIds);
      
      // Cargar pedidos para cada móvil seleccionado (ahora con fecha)
      const pedidosPromises = movilesIds.map(async (movilId) => {
        const response = await fetch(`/api/pedidos-pendientes/${movilId}?escenarioId=1000&fecha=${fecha}`);
        const result = await response.json();
        return { movilId, pedidos: result.pedidos || [] };
      });

      const results = await Promise.all(pedidosPromises);
      
      // Actualizar móviles con sus pedidos pendientes
      setMoviles(prevMoviles => {
        return prevMoviles.map(movil => {
          const movilPedidos = results.find(r => r.movilId === movil.id);
          if (movilPedidos) {
            // Convertir pedidos a formato PedidoServicio para compatibilidad
            const pendientes = movilPedidos.pedidos.map((p: any) => ({
              tipo: 'PEDIDO' as const,
              id: p.id || p.pedido_id,
              cliid: 0,
              clinom: p.cliente_nombre || 'Sin nombre',
              fecha: p.fecha_para || p.fch_para || '',
              x: p.latitud,
              y: p.longitud,
              estado: Number(p.estado_nro ?? p.estado ?? 0),
              subestado: 0,
              zona: String(p.zona_nro ?? p.zona ?? ''),
              producto_codigo: p.producto_cod ?? p.producto_codigo ?? '',
              producto_nombre: p.producto_nom ?? p.producto_nombre ?? '',
              producto_cantidad: p.producto_cant ?? p.producto_cantidad ?? 0,
              observacion: p.pedido_obs ?? p.observacion ?? '',
              prioridad: p.prioridad || 0,
            }));

            const pendientesEstado1 = pendientes.filter((p: any) => p.estado === 1);
            console.log(`✅ Móvil ${movil.id}: ${pendientesEstado1.length} pedidos pendientes (estado=1)`);
            
            return {
              ...movil,
              pendientes,
              pedidosPendientes: pendientesEstado1.length,
            };
          }
          return movil;
        });
      });
    } catch (err) {
      console.error(`❌ Error cargando pedidos pendientes:`, err);
    }
  }, [selectedDate]);

  // Handler para toggle de móvil en la lista (selección múltiple)
  const handleToggleMovil = useCallback((movilId: number) => {
    userExplicitlyCleared.current = true; // El usuario está modificando la selección manualmente
    setSelectedMoviles(prev => {
      const newSelection = prev.includes(movilId)
        ? prev.filter(id => id !== movilId) // Deseleccionar
        : [...prev, movilId]; // Agregar
      
      // Solo centrar en móvil individual si va a quedar exactamente 1 seleccionado
      // Si hay múltiples, el MapUpdater se encarga del zoom automático
      if (newSelection.length === 1) {
        setFocusedMovil(newSelection[0]);
      } else {
        setFocusedMovil(undefined);
      }
      
      return newSelection;
    });
  }, []);

  // Handler para seleccionar todos los móviles
  const handleSelectAll = useCallback(() => {
    userExplicitlyCleared.current = false;
    // Solo seleccionar móviles que pasan el filtro de actividad
    const filteredIds = applyActivityFilter(movilesFiltered).map(m => m.id);
    setSelectedMoviles(filteredIds);
    setFocusedMovil(undefined);
  }, [movilesFiltered, applyActivityFilter]);

  // Handler para deseleccionar todos los móviles
  const handleClearAll = useCallback(() => {
    userExplicitlyCleared.current = true;
    setSelectedMoviles([]);
    setFocusedMovil(undefined);
  }, []);

  // 🆕 Cuando cambia el filtro de actividad, re-seleccionar solo móviles que cumplen el filtro
  useEffect(() => {
    userExplicitlyCleared.current = false; // Cambiar filtro = nueva selección automática
    const filteredIds = applyActivityFilter(movilesFiltered).map(m => m.id);
    setSelectedMoviles(filteredIds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [movilesFilters.actividad]); // Solo cuando cambia el filtro de actividad

  // Handler para clic en el marcador del mapa (abre popup con opciones)
  const handleMovilClick = useCallback(async (movilId: number | undefined) => {
    setSelectedMovil(undefined); // Cierra animación si estaba abierta
    setShowPendientes(false); // Oculta pendientes
    
    if (movilId) {
      // Verificar si el móvil existe en el estado actual (via ref para acceso sincrónico)
      // Usar Number() porque movil.id puede llegar como string desde Supabase
      const movilExists = movilesRef.current.some(m => Number(m.id) === Number(movilId));

      // Si no existe, cargarlo desde la API antes de abrir el popup
      if (!movilExists) {
        console.log(`🔍 Móvil ${movilId} no existe en lista para popup, cargándolo desde API...`);
        try {
          const res = await fetch(`/api/all-positions?movilId=${movilId}`);
          const apiResult = await res.json();
          if (apiResult.success && apiResult.data.length > 0) {
            const movilData = apiResult.data[0];
            const newMovil: MovilData = {
              id: movilData.movilId,
              name: movilData.movilName,
              color: movilData.color,
              empresaFleteraId: movilData.empresa_fletera_id,
              currentPosition: movilData.position,
              history: undefined,
            };
            console.log(`✅ Móvil ${movilId} cargado desde API para popup`);
            setMoviles(prev => {
              if (prev.some(m => Number(m.id) === Number(movilId))) return prev;
              return [...prev, newMovil];
            });
          }
        } catch (err) {
          console.error(`❌ Error cargando móvil ${movilId} para popup:`, err);
        }
      }

      // Ahora abrir el popup (el móvil ya existe en el estado)
      setPopupMovil(movilId);

      // Cargar el historial del móvil (para tener listo si quiere ver animación)
      fetchMovilHistory(movilId);
      
      // Cargar pedidos y servicios pendientes
      try {
        console.log(`📦 Fetching pendientes for móvil ${movilId}...`);
        const url = `/api/pedidos-servicios-pendientes/${movilId}?fecha=${selectedDate || new Date().toISOString().split('T')[0]}`;
        const response = await fetch(url);
        const result = await response.json();

        if (result.success) {
          console.log(`✅ Found ${result.pedidosPendientes} pedidos and ${result.serviciosPendientes} servicios pendientes`);
          
          // Actualizar el móvil con los datos de pendientes
          setMoviles(prevMoviles =>
            prevMoviles.map(movil => {
              if (Number(movil.id) === Number(movilId)) {
                return {
                  ...movil,
                  pedidosPendientes: result.pedidosPendientes,
                  serviciosPendientes: result.serviciosPendientes,
                  pendientes: result.data,
                };
              }
              return movil;
            })
          );
        }
      } catch (err) {
        console.error(`❌ Error fetching pendientes for móvil ${movilId}:`, err);
      }
    } else {
      setPopupMovil(undefined);
    }
  }, [fetchMovilHistory, selectedDate]);

  // Handler para mostrar la animación (solo si hay UN móvil seleccionado)
  const handleShowAnimation = useCallback(async (movilId: number) => {
    console.log(`🎬 Iniciando animación para móvil ${movilId}`);
    
    // Si el móvil no está en selectedMoviles, agregarlo y limpiar los demás
    if (!selectedMoviles.includes(movilId)) {
      setSelectedMoviles([movilId]);
    } else if (selectedMoviles.length > 1) {
      // Si hay múltiples seleccionados, dejar solo este
      setSelectedMoviles([movilId]);
    }
    
    setPopupMovil(undefined); // Cierra el popup
    setShowPendientes(false); // Oculta pendientes
    setShowCompletados(false); // Oculta completados
    
    // Asegurarse de que el historial esté cargado antes de activar la animación
    const movilData = moviles.find(m => m.id === movilId);
    if (!movilData?.history || movilData.history.length === 0) {
      console.log(`📜 Historial no disponible, cargando para móvil ${movilId}...`);
      await fetchMovilHistory(movilId);
      console.log(`✅ Historial cargado, activando animación`);
    } else {
      console.log(`✅ Historial ya disponible (${movilData.history.length} registros), activando animación`);
    }
    
    setSelectedMovil(movilId); // Activa la animación
  }, [moviles, fetchMovilHistory, selectedMoviles]);

  // Handler para mostrar pendientes en el mapa (abre tabla filtrada por móvil)
  const handleShowPendientes = useCallback(() => {
    setShowPendientes(true); // Muestra los marcadores de pedidos
    setShowCompletados(false); // Oculta completados
    setPedidosFilters(prev => ({ ...prev, vista: 'pendientes' })); // Forzar vista pendientes
    
    if (popupMovil) {
      setPreFilterMovil(popupMovil);
      
      // Determinar qué tabla abrir según los pendientes del móvil
      const movilData = movilesRef.current.find(m => m.id === popupMovil);
      const hasPedidos = (movilData?.pedidosPendientes ?? 0) > 0;
      const hasServices = (movilData?.serviciosPendientes ?? 0) > 0;
      
      if (hasPedidos && !hasServices) {
        setIsPedidosTableOpen(true);
      } else if (hasServices && !hasPedidos) {
        setIsServicesTableOpen(true);
      } else {
        // Ambos o ninguno: abrir pedidos por defecto
        setIsPedidosTableOpen(true);
      }
    } else {
      setIsPedidosTableOpen(true);
    }
    
    setPopupMovil(undefined); // Cierra el popup
  }, [popupMovil]);

  // Handler para mostrar completados en el mapa
  const handleShowCompletados = useCallback(() => {
    setShowCompletados(true); // Muestra los marcadores de completados
    setShowPendientes(false); // Oculta pendientes
    setSelectedMovil(undefined); // Desactiva animación si estaba activa
    setSelectedMovil2(undefined); // Limpiar 2do móvil
    setPopupMovil(undefined); // Cierra el popup
  }, []);

  // Handler para cerrar el panel de animación
  const handleCloseAnimation = useCallback(() => {
    setSelectedMovil(undefined); // Desactiva la animación
    setSelectedMovil2(undefined); // Limpiar 2do móvil
  }, []);

  // Handler para confirmar tracking desde el modal
  const handleTrackingConfirm = useCallback(async (movilId: number, date: string) => {
    console.log(`🎬 Tracking desde modal: móvil ${movilId}, fecha ${date}`);
    setIsTrackingModalOpen(false);
    
    // Si la fecha es diferente a la actual, actualizar y recargar historial
    if (date !== selectedDate) {
      setSelectedDate(date);
    }
    
    // Seleccionar solo este móvil
    if (!selectedMoviles.includes(movilId)) {
      setSelectedMoviles([movilId]);
    } else if (selectedMoviles.length > 1) {
      setSelectedMoviles([movilId]);
    }
    
    setPopupMovil(undefined);
    setShowPendientes(false);
    setShowCompletados(false);
    
    // Forzar recarga del historial con la fecha seleccionada
    try {
      const url = `/api/movil/${movilId}?startDate=${date}`;
      const response = await fetch(url);
      const result = await response.json();
      
      if (result.success) {
        console.log(`✅ Historial cargado: ${result.count} registros para fecha ${date}`);
        setMoviles(prevMoviles => prevMoviles.map(movil => {
          if (movil.id === movilId) {
            return {
              ...movil,
              history: result.data,
              currentPosition: result.data[0] || movil.currentPosition,
            };
          }
          return movil;
        }));
      }
    } catch (err) {
      console.error(`❌ Error cargando historial:`, err);
    }
    
    setSelectedMovil(movilId);
  }, [selectedDate, selectedMoviles]);

  // Handler para click en pedido (abre popup + centra mapa)
  const handlePedidoClick = useCallback((pedidoId: number | undefined) => {
    setPopupService(undefined);
    setPopupPedido(pedidoId);
    setFocusedServiceId(undefined);
    setFocusedPedidoId(pedidoId);
    focusTriggerRef.current += 1;
    setFocusTrigger(focusTriggerRef.current);
  }, []);

  // Handler para click en service (abre popup + centra mapa)
  const handleServiceClick = useCallback((serviceId: number | undefined) => {
    setPopupPedido(undefined);
    setPopupService(serviceId);
    setFocusedPedidoId(undefined);
    setFocusedServiceId(serviceId);
    focusTriggerRef.current += 1;
    setFocusTrigger(focusTriggerRef.current);
  }, []);

  // Handler para click en punto de interés
  const handlePuntoInteresClick = useCallback((puntoId: string) => {
    console.log('📍 Click en punto de interés:', puntoId);
    // Encontrar el punto en la lista
    const punto = puntosInteres.find(p => p.id === puntoId);
    if (punto) {
      // Centrar mapa en el punto (esto lo manejará MapView automáticamente)
      // Por ahora solo logueamos
      console.log('📍 Punto encontrado:', punto);
    }
  }, [puntosInteres]);

  // Combinar pedidos iniciales con updates de realtime
  // Fecha seleccionada en formato YYYYMMDD para filtrar por fch_para
  const selectedDateCompact = useMemo(() => selectedDate.replace(/-/g, ''), [selectedDate]);

  const pedidosCompletos = useMemo(() => {
    const pedidosMap = new Map<number, PedidoSupabase>();
    
    // Agregar pedidos iniciales
    pedidosIniciales.forEach(p => pedidosMap.set(p.id, p));
    
    // Actualizar/agregar pedidos de realtime (sobrescriben los iniciales si existen)
    pedidosRealtime.forEach(p => pedidosMap.set(p.id, p));
    
    // 🔥 Filtrar por fecha seleccionada: solo incluir pedidos de la fecha actual
    // Esto evita que realtime inyecte pedidos de otras fechas
    const resultado = Array.from(pedidosMap.values()).filter(p => {
      // Verificar por fch_para (formato YYYYMMDD) o por fch_hora_para (timestamp)
      if (p.fch_para && p.fch_para === selectedDateCompact) return true;
      if (p.fch_hora_para && p.fch_hora_para.startsWith(selectedDate)) return true;
      // Si no tiene ninguno de los dos campos, incluir (para no perder datos)
      if (!p.fch_para && !p.fch_hora_para) return true;
      return false;
    });
    
    console.log('🔷 DASHBOARD: pedidosCompletos calculado');
    console.log(`📊 Iniciales: ${pedidosIniciales.length} | Realtime: ${pedidosRealtime.length} | Filtrados por fecha ${selectedDate}: ${resultado.length}`);
    
    return resultado;
  }, [pedidosIniciales, pedidosRealtime, selectedDateCompact, selectedDate]);

  // Combinar services iniciales con updates de realtime
  const servicesCompletos = useMemo(() => {
    const servicesMap = new Map<number, ServiceSupabase>();
    servicesIniciales.forEach(s => servicesMap.set(s.id, s));
    servicesRealtime.forEach(s => servicesMap.set(s.id, s));
    
    // 🔥 Filtrar por fecha seleccionada
    const resultado = Array.from(servicesMap.values()).filter(s => {
      if (s.fch_para && s.fch_para === selectedDateCompact) return true;
      if (s.fch_hora_para && s.fch_hora_para.startsWith(selectedDate)) return true;
      if (!s.fch_para && !s.fch_hora_para) return true;
      return false;
    });
    
    console.log(`🔧 DASHBOARD: servicesCompletos filtrados por ${selectedDate}: ${resultado.length}`);
    return resultado;
  }, [servicesIniciales, servicesRealtime, selectedDateCompact, selectedDate]);

  // Derivar tipos de servicio dinámicos de servicio_nombre de pedidos y services
  const tiposServicio = useMemo(() => {
    const nombres = new Set<string>();
    pedidosCompletos.forEach(p => { if (p.servicio_nombre) nombres.add(p.servicio_nombre.trim()); });
    servicesCompletos.forEach(s => { if (s.servicio_nombre) nombres.add(s.servicio_nombre.trim()); });
    return [...nombres].filter(Boolean).sort((a, b) => a.localeCompare(b));
  }, [pedidosCompletos, servicesCompletos]);

  // 🚀 NUEVO: Actualizar lote de móviles en tiempo real basado en pedidos
  // Ref para rastrear el último key de pedidos y evitar loops infinitos
  const prevPedidosKeyRef = useRef<string>('');
  
  useEffect(() => {
    // 🚀 Pausar actualizaciones si la tab no está visible (ahorro de CPU)
    if (!isTabVisible) {
      console.log('🙈 Tab oculto - pausando actualización de lote');
      return;
    }
    
    // Solo contar pedidos con estado 1 (Pendiente/Asignado) para consistencia
    const ESTADOS_ACTIVOS = [1];
    
    // Contar pedidos activos por móvil
    const pedidosPorMovil = new Map<number, number>();
    
    pedidosCompletos.forEach(pedido => {
      const estadoNum = Number(pedido.estado_nro);
      if (pedido.movil && estadoNum && ESTADOS_ACTIVOS.includes(estadoNum) && Number(pedido.sub_estado_nro) === 5) {
        const movilNum = Number(pedido.movil);
        const count = pedidosPorMovil.get(movilNum) || 0;
        pedidosPorMovil.set(movilNum, count + 1);
      }
    });
    
    // Serializar para comparación estable (sort por key numérico)
    const pedidosKey = JSON.stringify(Array.from(pedidosPorMovil.entries()).sort((a, b) => a[0] - b[0]));
    
    // Si el key no cambió desde la última vez, no hacer nada (prevenir loop)
    if (pedidosKey === prevPedidosKeyRef.current) {
      return;
    }
    prevPedidosKeyRef.current = pedidosKey;
    
    console.log('📦 Actualizando lote de móviles en tiempo real');
    console.log('📊 Pedidos activos por móvil:', Object.fromEntries(pedidosPorMovil));
    
    setMoviles(prevMoviles => {
      let cambios = false;
      const updated = prevMoviles.map(movil => {
        const movilId = Number(movil.id);
        const pedidosAsignados = pedidosPorMovil.get(movilId) || 0;
        
        if (movil.pedidosAsignados !== pedidosAsignados) {
          console.log(`🔄 Móvil ${movilId}: ${pedidosAsignados}/${movil.tamanoLote || 6} pedidos`);
          cambios = true;
          return {
            ...movil,
            pedidosAsignados,
          };
        }
        
        return movil;
      });
      
      return cambios ? updated : prevMoviles;
    });
  }, [pedidosCompletos, isTabVisible]); // Se ejecuta cada vez que cambian los pedidos o visibilidad

  // Initial fetch - posiciones
  useEffect(() => {
    fetchPositions();
  }, [fetchPositions]);

  // Fetch pedidos cuando cambian los móviles seleccionados o la fecha
  useEffect(() => {
    fetchPedidos();
  }, [fetchPedidos]);

  // Fetch services cuando cambia la fecha
  useEffect(() => {
    fetchServices();
  }, [fetchServices]);

  // Reset focusedMovil when date or selected companies change
  useEffect(() => {
    setFocusedMovil(undefined);
    setSelectedMovil(undefined);
    setPopupMovil(undefined);
    setShowPendientes(false);
    setShowCompletados(false);
  }, [selectedDate, selectedEmpresas]);

  // Auto-refresh de posiciones y historial del móvil seleccionado (solo si Tiempo Real está activado)
  useEffect(() => {
    // Si el modo Tiempo Real está desactivado, no hacer polling
    if (!preferences.realtimeEnabled) {
      console.log('⏸️ Modo Tiempo Real desactivado - no hay auto-refresh');
      return;
    }

    // Intervalo fijo de 30 segundos cuando Tiempo Real está activado
    const REALTIME_INTERVAL = 30000; // 30 segundos
    
    const interval = setInterval(() => {
      console.log(`🔄 Auto-refresh triggered (Realtime Mode). Selected móvil: ${selectedMovil || 'none'}`);
      fetchPositions(); // Actualizar solo posiciones GPS
      
      // Si hay un móvil seleccionado, actualizar también su historial
      if (selectedMovil) {
        console.log(`📜 Refreshing history for móvil ${selectedMovil}`);
        fetchMovilHistory(selectedMovil);
      }
      if (selectedMovil2) {
        console.log(`📜 Refreshing history for 2nd móvil ${selectedMovil2}`);
        fetchMovilHistory(selectedMovil2);
      }
    }, REALTIME_INTERVAL);

    return () => clearInterval(interval);
  }, [fetchPositions, preferences.realtimeEnabled, selectedMovil, selectedMovil2, fetchMovilHistory]);

  // Cargar pedidos pendientes cuando se seleccionan móviles O cuando se carga el dashboard
  useEffect(() => {
    if (selectedMoviles.length > 0) {
      // CASO 1: Hay móviles seleccionados → Mostrar sus pedidos
      console.log(`📦 Cargando pedidos para móviles seleccionados:`, selectedMoviles);
      fetchPedidosPendientes(selectedMoviles);
      setShowPendientes(true);
    } else {
      // CASO 2: No hay móviles seleccionados → Mostrar TODOS los pedidos del día
      console.log(`📦 Cargando TODOS los pedidos del día actual`);
      fetchPedidosPendientes([]);
      setShowPendientes(true);
    }
  }, [selectedMoviles, fetchPedidosPendientes]);

  // 🔥 NUEVO: Actualizar pedidos en tiempo real cuando lleguen del hook
  const prevRealtimeKeyRef = useRef<string>('');
  
  useEffect(() => {
    if (pedidosRealtime.length === 0) return;
    
    // Crear key estable para comparar si realmente cambió algo
    const realtimeKey = JSON.stringify(pedidosRealtime.map(p => `${p.id}-${p.movil}-${p.estado_nro}`).sort());
    if (realtimeKey === prevRealtimeKeyRef.current) return;
    prevRealtimeKeyRef.current = realtimeKey;
    
    console.log(`📦 Actualizando ${pedidosRealtime.length} pedidos desde Realtime`);
    
    // Convertir pedidos de Realtime a formato compatible
    const pedidosFormateados = pedidosRealtime.map(p => ({
      tipo: 'PEDIDO' as const,
      id: p.id,
      cliid: 0,
      clinom: p.cliente_nombre || 'Sin nombre',
      fecha: p.fch_para || '',
      x: p.latitud,
      y: p.longitud,
      estado: p.estado_nro || 0,
      subestado: 0,
      zona: String(p.zona_nro || ''),
      producto_codigo: p.producto_cod || '',
      producto_nombre: p.producto_nom || '',
      producto_cantidad: p.producto_cant || 0,
      observacion: p.pedido_obs || '',
      prioridad: p.prioridad || 0,
      movilId: p.movil || undefined,
    }));
    
    // Actualizar móviles con los nuevos pedidos
    setMoviles(prevMoviles => {
      let cambios = false;
      const updated = prevMoviles.map(movil => {
        const pedidosDelMovil = pedidosFormateados.filter(p => p.movilId === movil.id);
        const pedidosEstado1 = pedidosDelMovil.filter(p => p.estado === 1);
        
        if (pedidosDelMovil.length > 0) {
          const newPedidosAsignados = pedidosEstado1.length;
          const newColor = getMovilColorByOccupancy(newPedidosAsignados, movil.tamanoLote || 0);
          
          if (movil.pedidosAsignados !== newPedidosAsignados || movil.color !== newColor) {
            cambios = true;
            return {
              ...movil,
              pedidos: pedidosDelMovil,
              pedidosAsignados: newPedidosAsignados,
              color: newColor,
            };
          }
        }
        
        return movil;
      });
      
      return cambios ? updated : prevMoviles;
    });
  }, [pedidosRealtime, getMovilColorByOccupancy]);

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 relative">
      {/* Navbar Simple - Solo logo y espacio para indicadores */}
      <div className="flex-shrink-0">
        <NavbarSimple
          empresas={empresas}
          selectedEmpresas={selectedEmpresas}
          onEmpresasChange={setSelectedEmpresas}
          isLoadingEmpresas={isLoadingEmpresas}
          showEmpresaSelector={false}
        >
          <DashboardIndicators
            moviles={markInactiveMoviles(movilesFiltered)}
            pedidos={pedidosCompletos}
            services={servicesCompletos}
            selectedDate={selectedDate}
            selectedMoviles={selectedMoviles}
            escenarioIds={selectedEscenarioIds}
            maxCoordinateDelayMinutes={preferences.maxCoordinateDelayMinutes}
            allMovilEstados={allMovilEstados}
            onSinAsignarClick={() => {
              setPedidosFilters(prev => ({ ...prev, vista: 'pendientes' }));
              setIsPedidosTableOpen(true);
            }}
            onEntregadosClick={() => {
              setPedidosFilters(prev => ({ ...prev, vista: 'finalizados' }));
              setIsPedidosTableOpen(true);
            }}
            onPorcentajeClick={() => {
              setPedidosFilters(prev => ({ ...prev, vista: 'finalizados' }));
              setIsPedidosTableOpen(true);
            }}
            zonasSinMovilServiceFilter={movilesZonasServiceFilter}
            onZonasSinMovilClick={() => setIsZonasSinMovilOpen(true)}
            onMovilesSinReportarClick={() => setIsMovilesSinReportarOpen(true)}
            onZonasNoActivasClick={() => setIsZonasNoActivasOpen(true)}
          />
        </NavbarSimple>
      </div>

      {/* Floating Toolbar - Filtros, Preferencias, Usuario */}
      <FloatingToolbar
        selectedDate={selectedDate}
        onDateChange={setSelectedDate}
        onPreferencesChange={(newPrefs) => {
          updatePreferences(newPrefs);
        }}
      />

      {/* Botones flotantes: FAB colapsable con Tracking + POI + Leaderboard */}
      {/* Por defecto solo muestra un botón ⚡. Al hacer clic se expanden los 3 botones de acción */}
      <div id="tour-fab-area" className="fixed z-[9999] flex items-center gap-2 top-3 right-16 flex-row">
        {/* Botones de acción - se muestran/ocultan con animación */}
        <div className={`flex items-center gap-2 transition-all duration-300 origin-right ${
          isActionsExpanded 
            ? 'opacity-100 scale-100 translate-x-0' 
            : 'opacity-0 scale-75 translate-x-4 pointer-events-none w-0 overflow-hidden'
        }`}>
          {/* Botón de Asignación de Zonas */}
          <button
            id="tour-fab-zonas"
            onClick={() => { openZonaView(null); setIsActionsExpanded(false); }}
            className="flex items-center justify-center w-10 h-10 rounded-full shadow-2xl transition-all duration-300 transform hover:scale-110 bg-gradient-to-br from-teal-500 to-emerald-600 hover:from-teal-600 hover:to-emerald-700"
            title="Asignación de Móviles a Zonas"
          >
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
            </svg>
          </button>

          {/* Botón de Zonas por Empresa Fletera */}
          <button
            id="tour-fab-fleteras-zonas"
            onClick={() => { setIsFleterasZonasOpen(true); setIsActionsExpanded(false); }}
            className="flex items-center justify-center w-10 h-10 rounded-full shadow-2xl transition-all duration-300 transform hover:scale-110 bg-gradient-to-br from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700"
            title="Zonas por Empresa Fletera"
          >
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
          </button>

          {/* Botón de Tracking */}
          <button
            id="tour-fab-tracking"
            onClick={() => { setIsTrackingModalOpen(true); setIsActionsExpanded(false); }}
            className="flex items-center justify-center w-10 h-10 rounded-full shadow-2xl transition-all duration-300 transform hover:scale-110 bg-gradient-to-br from-purple-500 to-indigo-600 hover:from-purple-600 hover:to-indigo-700"
            title="Ver recorrido de un móvil"
          >
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
            </svg>
          </button>

          {/* Botones POI y OSM Import removidos */}
        </div>

        {/* Botón toggle FAB ⚡ */}
        <button
          id="tour-fab-toggle"
          onClick={() => setIsActionsExpanded(!isActionsExpanded)}
          className={`flex items-center justify-center w-10 h-10 rounded-full shadow-2xl transition-all duration-300 transform hover:scale-110 ${
            isActionsExpanded
              ? 'bg-gradient-to-br from-gray-600 to-gray-700 rotate-45'
              : 'bg-gradient-to-br from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700'
          }`}
          title={isActionsExpanded ? 'Cerrar acciones' : 'Acciones rápidas'}
        >
          <svg className={`w-5 h-5 text-white transition-transform duration-300 ${isActionsExpanded ? 'rotate-0' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            {isActionsExpanded ? (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            )}
          </svg>
        </button>

        {/* Botón de Tour / Ayuda ❓ */}
        <button
          id="tour-help-btn"
          onClick={() => {
            setIsActionsExpanded(true);
            setTimeout(() => setIsTourOpen(true), 350);
          }}
          className="flex items-center justify-center w-10 h-10 rounded-full shadow-2xl transition-all duration-300 transform hover:scale-110 bg-gradient-to-br from-violet-500 to-purple-600 hover:from-violet-600 hover:to-purple-700 group"
          title="Tour interactivo de la aplicación"
        >
          <svg className="w-5 h-5 text-white group-hover:animate-bounce" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </button>
      </div>

      {/* Tour Interactivo */}
      <AppTour
        isOpen={isTourOpen}
        onClose={() => setIsTourOpen(false)}
        expandFab={() => setIsActionsExpanded(true)}
        collapseFab={() => setIsActionsExpanded(false)}
        openZonas={() => { openZonaView(null); }}
        closeZonas={() => setZonaViewModalOpen(false)}
        openRanking={() => setIsLeaderboardOpen(true)}
        closeRanking={() => setIsLeaderboardOpen(false)}
        openTracking={() => setIsTrackingModalOpen(true)}
        closeTracking={() => setIsTrackingModalOpen(false)}
        openPedidosTable={() => setIsPedidosTableOpen(true)}
        closePedidosTable={() => setIsPedidosTableOpen(false)}
      />

      {/* Modal de Tracking */}
      <TrackingModal
        isOpen={isTrackingModalOpen}
        onClose={() => setIsTrackingModalOpen(false)}
        onConfirm={handleTrackingConfirm}
        moviles={movilesFiltered}
        selectedDate={selectedDate}
        selectedMovil={selectedMoviles.length === 1 ? selectedMoviles[0] : undefined}
      />

      {/* Modal de Vista Extendida de Pedidos */}
      <PedidosTableModal
        key={`pedidos-${preFilterMovil ?? 'all'}-z${preFilterZona ?? 'all'}`}
        isOpen={isPedidosTableOpen}
        onClose={() => { setIsPedidosTableOpen(false); setPreFilterMovil(undefined); setPreFilterZona(undefined); }}
        pedidos={pedidosCompletos}
        moviles={movilesFiltered}
        onPedidoClick={handlePedidoClick}
        onMovilClick={handleMovilClick}
        vista={pedidosFilters.vista}
        onVistaChange={(v) => setPedidosFilters(prev => ({ ...prev, vista: v }))}
        selectedMoviles={selectedMoviles}
        externalAtraso={pedidosFilters.atraso}
        externalTipoServicio={pedidosFilters.tipoServicio}
        preFilterMovil={preFilterMovil}
        preFilterZona={preFilterZona}
        onClearPreFilter={() => { setPreFilterMovil(undefined); setPreFilterZona(undefined); }}
      />

      {/* Modal de Vista Extendida de Services */}
      <ServicesTableModal
        key={`services-${preFilterMovil ?? 'all'}-z${preFilterZona ?? 'all'}`}
        isOpen={isServicesTableOpen}
        onClose={() => { setIsServicesTableOpen(false); setPreFilterMovil(undefined); setPreFilterZona(undefined); }}
        services={servicesCompletos}
        moviles={movilesFiltered}
        onServiceClick={handleServiceClick}
        onMovilClick={handleMovilClick}
        vista={servicesFilters.vista}
        onVistaChange={(v) => setServicesFilters(prev => ({ ...prev, vista: v }))}
        selectedMoviles={selectedMoviles}
        externalAtraso={servicesFilters.atraso}
        externalTipoServicio={servicesFilters.tipoServicio}
        preFilterMovil={preFilterMovil}
        preFilterZona={preFilterZona}
        onClearPreFilter={() => { setPreFilterMovil(undefined); setPreFilterZona(undefined); }}
      />

      {/* Modal de importación de POIs desde OpenStreetMap */}
      <OsmImportModal
        isOpen={isOsmImportOpen}
        onClose={() => setIsOsmImportOpen(false)}
        onImportComplete={() => setReloadMarkersTrigger(prev => prev + 1)}
        usuarioEmail={user?.email || user?.username || ''}
      />

      {/* Modal de Zonas por Empresa Fletera */}
      <FleterasZonasModal
        isOpen={isFleterasZonasOpen}
        onClose={() => setIsFleterasZonasOpen(false)}
      />

      <ZonasSinMovilModal
        isOpen={isZonasSinMovilOpen}
        onClose={() => setIsZonasSinMovilOpen(false)}
        escenarioIds={selectedEscenarioIds}
        allMovilEstados={allMovilEstados}
        initialServiceFilter={movilesZonasServiceFilter}
      />

      <MovilesSinReportarModal
        isOpen={isMovilesSinReportarOpen}
        onClose={() => setIsMovilesSinReportarOpen(false)}
        moviles={markInactiveMoviles(movilesFiltered)}
      />

      <ZonasNoActivasModal
        isOpen={isZonasNoActivasOpen}
        onClose={() => setIsZonasNoActivasOpen(false)}
        escenarioIds={selectedEscenarioIds}
      />

      {/* Modal de Vista Móviles por Zona (click en mapa o botón) */}
      <ZonaMovilesViewModal
        isOpen={zonaViewModalOpen}
        onClose={() => setZonaViewModalOpen(false)}
        initialZonaId={zonaViewModalZonaId}
        initialServiceFilter={movilesZonasServiceFilter}
        moviles={movilesFiltered}
        movilesZonasData={movilesZonasData}
      />

      {/* Modal de Leaderboard/Ranking */}
      <LeaderboardModal
        isOpen={isLeaderboardOpen}
        onClose={() => setIsLeaderboardOpen(false)}
        moviles={applyActivityFilter(movilesFiltered)}
        pedidos={pedidosCompletos}
        services={servicesCompletos}
        onMovilClick={(movilId) => {
          setIsLeaderboardOpen(false);
          handleMovilClick(movilId);
        }}
        onStatClick={(movilId, viewMode, stat) => {
          setIsLeaderboardOpen(false);
          setPreFilterMovil(movilId);
          
          if (stat === 'noEntregados') {
            // No entregados = finalizados con sub_estado != 3
            if (viewMode === 'pedidos') {
              setPedidosFilters(prev => ({ ...prev, vista: 'finalizados' }));
              setIsPedidosTableOpen(true);
            } else {
              setServicesFilters(prev => ({ ...prev, vista: 'finalizados' }));
              setIsServicesTableOpen(true);
            }
          } else {
            // Atrasados y Pendientes = vista pendientes
            if (viewMode === 'pedidos') {
              setPedidosFilters(prev => ({ ...prev, vista: 'pendientes' }));
              setIsPedidosTableOpen(true);
            } else {
              setServicesFilters(prev => ({ ...prev, vista: 'pendientes' }));
              setIsServicesTableOpen(true);
            }
          }
        }}
      />

      {/* Modal de Estadísticas por Zona */}
      <ZonaEstadisticasModal
        isOpen={isZonaEstadisticasOpen}
        onClose={() => setIsZonaEstadisticasOpen(false)}
        pedidos={pedidosCompletos}
        escenarioIds={selectedEscenarioIds}
        movilEstados={allMovilEstados}
        onZonaClick={(zonaId, svcFilter) => {
          setIsZonaEstadisticasOpen(false);
          setPreFilterZona(zonaId);
          setPreFilterMovil(undefined);
          const upper = svcFilter.toUpperCase();
          if (upper === 'SERVICE') {
            setServicesFilters(prev => ({ ...prev, vista: 'pendientes' }));
            setIsServicesTableOpen(true);
          } else {
            // PEDIDOS agrupa URGENTE + NOCTURNO; pasar 'PEDIDOS' al filtro
            setPedidosFilters(prev => ({ ...prev, vista: 'pendientes', tipoServicio: upper === 'PEDIDOS' ? 'PEDIDOS' : svcFilter }));
            setIsPedidosTableOpen(true);
          }
        }}
        onMovsPrioClick={(_zonaId, movilIds, _svcFilter) => {
          setIsZonaEstadisticasOpen(false);
          if (movilIds.length === 1) {
            // Un solo móvil: abrir su popup en mapa
            setPopupMovil(movilIds[0]);
          } else if (movilIds.length > 1) {
            // Múltiples móviles: abrir vista extendida pre-filtrada por el primero
            // (el usuario puede cambiar en el dropdown)
            setPreFilterMovil(movilIds[0]);
            setPreFilterZona(undefined);
            setPedidosFilters(prev => ({ ...prev, vista: 'pendientes' }));
            setIsPedidosTableOpen(true);
          }
        }}
      />

      {/* Indicador de conexión Realtime - Debajo del navbar, a la derecha */}
      {/* right-4 siempre, los botones ya no están en < xl */}
      <div id="tour-realtime-indicator" className="absolute right-4 top-[68px] z-50">
        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          className={`px-3 py-1.5 rounded-full shadow-lg flex items-center gap-2 text-xs font-medium ${
            preferences.realtimeEnabled 
              ? (isConnected 
                  ? 'bg-green-500 text-white' 
                  : 'bg-yellow-500 text-white')
              : 'bg-gray-500 text-white'
          }`}
        >
          <div className={`w-2 h-2 rounded-full ${
            preferences.realtimeEnabled 
              ? (isConnected ? 'bg-white animate-pulse' : 'bg-white')
              : 'bg-gray-300'
          }`} />
          {preferences.realtimeEnabled 
            ? (isConnected ? '📡 Tiempo Real Activo' : '📡 Conectando...') 
            : '⏸️ Modo Estático'
          }
        </motion.div>
      </div>

      {/* Main Content - Flex grow to fill remaining space */}
      <main className="flex-1 flex overflow-hidden relative">{error && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="absolute top-4 left-1/2 transform -translate-x-1/2 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-lg z-40 shadow-lg"
          >
            <strong className="font-bold">Error: </strong>
            <span>{error}</span>
          </motion.div>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center w-full">
            <div className="text-center">
              <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-blue-600 mx-auto mb-4" />
              <p className="text-xl text-gray-600">Cargando datos...</p>
            </div>
          </div>
        ) : (
          <>
            {/* Panel Lateral Colapsable - Absolute positioned */}
            <motion.div
              id="tour-sidebar"
              initial={false}
              animate={{
                x: isSidebarCollapsed ? -(sidebarWidth + 4) : 0,
              }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              className="absolute left-0 top-0 bottom-0 z-30 bg-white shadow-2xl flex flex-col"
              style={{ width: sidebarWidth }}
            >
              {/* Selector de Móviles - Full height */}
              <div className="flex-1 overflow-hidden">
                <MovilSelector
                  moviles={markInactiveMoviles(movilesFiltered)}
                  selectedMoviles={selectedMoviles}
                  onToggleMovil={handleToggleMovil}
                  onSelectAll={handleSelectAll}
                  onClearAll={handleClearAll}
                  pedidos={pedidosCompletos}
                  services={servicesCompletos}
                  onPedidoClick={handlePedidoClick}
                  onServiceClick={handleServiceClick}
                  puntosInteres={puntosInteres}
                  onPuntoInteresClick={handlePuntoInteresClick}
                  onFiltersChange={setMovilesFilters}
                  onOpenPedidosTable={() => setIsPedidosTableOpen(true)}
                  onOpenServicesTable={() => setIsServicesTableOpen(true)}
                  pedidosFilters={pedidosFilters}
                  onPedidosFiltersChange={setPedidosFilters}
                  servicesFilters={servicesFilters}
                  onServicesFiltersChange={setServicesFilters}
                  tiposServicio={tiposServicio}
                  onOpenRanking={() => setIsLeaderboardOpen(true)}
                  movilesHidden={movilesHidden}
                  onToggleMovilesHidden={() => setMovilesHidden(!movilesHidden)}
                  pedidosHidden={pedidosHidden}
                  onTogglePedidosHidden={() => setPedidosHidden(!pedidosHidden)}
                  servicesHidden={servicesHidden}
                  onToggleServicesHidden={() => setServicesHidden(!servicesHidden)}
                  poisHidden={poisHidden}
                  onTogglePoisHidden={() => setPoisHidden(!poisHidden)}
                  hiddenPoiCategories={hiddenPoiCategories}
                  onTogglePoiCategory={togglePoiCategory}
                  empresas={empresas}
                  selectedEmpresas={selectedEmpresas}
                  onEmpresasChange={setSelectedEmpresas}
                  showEmpresaSelector={user?.isRoot === 'S' || (empresas.length > 1)}
                />
              </div>
            </motion.div>

            {/* Botón para colapsar/expandir el sidebar */}
            <motion.button
              id="tour-sidebar-toggle"
              initial={false}
              animate={{
                left: isSidebarCollapsed ? 0 : sidebarWidth,
              }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
              className="absolute top-1/2 -translate-y-1/2 z-40 bg-blue-600 hover:bg-blue-700 text-white p-3 rounded-r-lg shadow-xl transition-colors"
              title={isSidebarCollapsed ? 'Mostrar panel' : 'Ocultar panel'}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-6 w-6 transition-transform"
                style={{ transform: isSidebarCollapsed ? 'rotate(0deg)' : 'rotate(180deg)' }}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 5l7 7-7 7"
                />
              </svg>
            </motion.button>

            {/* Mapa - Full width con padding dinámico */}
            <motion.div
              id="tour-map-area"
              initial={false}
              animate={{
                paddingLeft: isSidebarCollapsed ? 0 : sidebarWidth,
              }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              className="w-full h-full"
            >
              <MapView 
                moviles={movilesHidden ? [] : applyActivityFilter(applyAdvancedFilters(markInactiveMoviles(movilesFiltered))).filter(m => (selectedMoviles.includes(m.id) || m.id === selectedMovil2) && (!m.currentPosition || isInUruguay(m.currentPosition.coordX, m.currentPosition.coordY)))}
                focusedMovil={focusedMovil}
                selectedMovil={selectedMovil}
                secondaryAnimMovil={selectedMovil2}
                popupMovil={popupMovil}
                showPendientes={showPendientes}
                showCompletados={showCompletados}
                selectedMovilesCount={selectedMoviles.length}
                defaultMapLayer={preferences.defaultMapLayer}
                onMovilClick={handleMovilClick}
                onShowAnimation={handleShowAnimation}
                onCloseAnimation={handleCloseAnimation}
                onShowPendientes={handleShowPendientes}
                onShowCompletados={handleShowCompletados}
                pedidos={pedidosHidden ? [] : filterByTipoServicio(filterByDelay(
                  (pedidosFilters.vista === 'finalizados'
                    ? (selectedMoviles.length > 0 ? pedidosCompletos.filter(p => Number(p.estado_nro) === 2 && p.movil && selectedMoviles.some(id => Number(id) === Number(p.movil))) : pedidosCompletos.filter(p => Number(p.estado_nro) === 2))
                    : (selectedMoviles.length > 0
                        ? pedidosCompletos.filter(p => Number(p.estado_nro) === 1 && (
                            (p.movil && selectedMoviles.some(id => Number(id) === Number(p.movil))) ||
                            (!p.movil || Number(p.movil) === 0)
                          ))
                        : pedidosCompletos.filter(p => Number(p.estado_nro) === 1)
                      )
                  ).filter(p => !p.latitud || !p.longitud || isInUruguay(p.latitud, p.longitud)),
                  pedidosFilters.vista !== 'finalizados' ? pedidosFilters.atraso : []
                ), pedidosFilters.vista !== 'finalizados' ? pedidosFilters.tipoServicio : 'all')}
                allPedidos={pedidosCompletos}
                onPedidoClick={handlePedidoClick}
                popupPedido={popupPedido}
                focusedPedidoId={focusedPedidoId}
                focusedServiceId={focusedServiceId}
                focusTrigger={focusTrigger}
                services={servicesHidden ? [] : filterByTipoServicio(filterByDelay(
                  (servicesFilters.vista === 'finalizados'
                    ? (selectedMoviles.length > 0 ? servicesCompletos.filter(s => Number(s.estado_nro) === 2 && s.movil && selectedMoviles.some(id => Number(id) === Number(s.movil))) : servicesCompletos.filter(s => Number(s.estado_nro) === 2))
                    : (selectedMoviles.length > 0 ? servicesCompletos.filter(s => Number(s.estado_nro) === 1 && s.movil && selectedMoviles.some(id => Number(id) === Number(s.movil))) : servicesCompletos.filter(s => Number(s.estado_nro) === 1))
                  ).filter(s => !s.latitud || !s.longitud || isInUruguay(s.latitud, s.longitud)),
                  servicesFilters.vista !== 'finalizados' ? servicesFilters.atraso : []
                ), servicesFilters.vista !== 'finalizados' ? servicesFilters.tipoServicio : 'all')}
                allServices={servicesCompletos}
                onServiceClick={handleServiceClick}
                popupService={popupService}
                isPlacingMarker={isPlacingMarker}
                onPlacingMarkerChange={setIsPlacingMarker}
                onMarkersChange={setPuntosInteres}
                allMoviles={movilesFiltered}
                selectedDate={selectedDate}
                onMovilDateChange={handleTrackingConfirm}
                onSecondaryAnimMovilChange={async (movilId) => {
                  if (movilId) {
                    // Cargar historial del 2do móvil si no está cargado
                    const movilData = moviles.find(m => m.id === movilId);
                    if (!movilData?.history || movilData.history.length === 0) {
                      await fetchMovilHistory(movilId);
                    }
                  }
                  setSelectedMovil2(movilId);
                }}
                zonas={showZonas ? zonasData : []}
                markerStyle={preferences.markerStyle || 'normal'}
                pedidosCluster={preferences.pedidosCluster !== undefined ? preferences.pedidosCluster : true}
                pedidoMarkerStyle={preferences.pedidoMarkerStyle || 'normal'}
                serviceMarkerStyle={preferences.serviceMarkerStyle || 'normal'}
                movilShape={preferences.movilShape || 'circle'}
                pedidoShape={preferences.pedidoShape || 'square'}
                serviceShape={preferences.serviceShape || 'triangle'}
                dataViewMode={dataViewMode}
                onDataViewChange={handleDataViewChange}
                onOpenEstadisticas={() => setIsZonaEstadisticasOpen(true)}
                demorasData={demorasData}
                allMovilEstados={allMovilEstados}
                movilesZonasData={movilesZonasData}
                movilesZonasServiceFilter={movilesZonasServiceFilter}
                onMovilesZonasServiceFilterChange={setMovilesZonasServiceFilter}
                tiposServicioDisponibles={tiposServicio}
                allZonas={allZonasData}
                showDemoraLabels={preferences.showDemoraLabels ?? false}
                zonaOpacity={preferences.zonaOpacity ?? 50}
                reloadMarkersTrigger={reloadMarkersTrigger}
                poisHidden={poisHidden}
                hiddenPoiCategories={hiddenPoiCategories}
                pedidosVista={pedidosFilters.vista}
                servicesVista={servicesFilters.vista}
                onZonaClick={dataViewMode === 'moviles-zonas' ? openZonaView : undefined}
              />
            </motion.div>
          </>
        )}
      </main>
    </div>
  );
}

export default function Dashboard() {
  return (
    <ProtectedRoute>
      <DashboardContent />
    </ProtectedRoute>
  );
}
