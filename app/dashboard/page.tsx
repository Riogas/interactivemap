'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import dynamic from 'next/dynamic';
import { motion } from 'framer-motion';
import { MovilData, EmpresaFleteraSupabase, PedidoPendiente, PedidoSupabase, ServiceSupabase, CustomMarker, MovilFilters } from '@/types';
import MovilSelector from '@/components/ui/MovilSelector';
import NavbarSimple from '@/components/layout/NavbarSimple';
import FloatingToolbar from '@/components/layout/FloatingToolbar';
import DashboardIndicators from '@/components/dashboard/DashboardIndicators';
import MovilesSinGPS from '@/components/dashboard/MovilesSinGPS';
import { useRealtime } from '@/components/providers/RealtimeProvider';
import { useUserPreferences, UserPreferences } from '@/components/ui/PreferencesModal';
import ProtectedRoute from '@/components/auth/ProtectedRoute';
import { useAuth } from '@/contexts/AuthContext';
import { usePedidosRealtime, useServicesRealtime } from '@/lib/hooks/useRealtimeSubscriptions';
import { useTabVisibility } from '@/hooks/usePerformanceOptimizations';
import TrackingModal from '@/components/ui/TrackingModal';

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
  const { preferences, updatePreferences } = useUserPreferences();
  
  const [moviles, setMoviles] = useState<MovilData[]>([]);
  const [selectedMoviles, setSelectedMoviles] = useState<number[]>([]); // Array de móviles seleccionados
  
  // 🚀 Optimización: Detectar visibilidad de tab para pausar updates
  const isTabVisible = useTabVisibility();
  
  const [focusedMovil, setFocusedMovil] = useState<number | undefined>(); // Móvil enfocado en el mapa (para centrar)
  const [selectedMovil, setSelectedMovil] = useState<number | undefined>(); // Móvil seleccionado para animación
  const [popupMovil, setPopupMovil] = useState<number | undefined>(); // Móvil con popup abierto
  const [popupPedido, setPopupPedido] = useState<number | undefined>(); // Pedido con popup abierto
  const [popupService, setPopupService] = useState<number | undefined>(); // Service con popup abierto
  const [focusedPedidoId, setFocusedPedidoId] = useState<number | undefined>(); // ✅ NUEVO: Pedido a centralizar
  const [focusedPuntoId, setFocusedPuntoId] = useState<string | undefined>(); // ✅ NUEVO: Punto a centralizar
  const [showPendientes, setShowPendientes] = useState(false); // Mostrar marcadores de pedidos
  const [showCompletados, setShowCompletados] = useState(false); // Mostrar marcadores de completados
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isInitialLoad, setIsInitialLoad] = useState(true); // Flag para carga inicial
  
  // Estado para marcadores personalizados
  const [isPlacingMarker, setIsPlacingMarker] = useState(false);
  
  // Estado para modal de tracking
  const [isTrackingModalOpen, setIsTrackingModalOpen] = useState(false);
  
  // Estado para puntos de interés
  const [puntosInteres, setPuntosInteres] = useState<CustomMarker[]>([]);
  
  // Estado para el panel colapsable
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  
  // Estado para empresas fleteras
  const [empresas, setEmpresas] = useState<EmpresaFleteraSupabase[]>([]);
  const [selectedEmpresas, setSelectedEmpresas] = useState<number[]>([]);
  
  // � Móviles filtrados por empresas fleteras seleccionadas
  const movilesFiltered = useMemo(() => {
    if (selectedEmpresas.length === 0) return moviles;
    return moviles.filter(m => 
      m.empresaFleteraId && selectedEmpresas.includes(m.empresaFleteraId)
    );
  }, [moviles, selectedEmpresas]);
  
  // �🆕 Estado para filtros de móviles (recibidos desde MovilSelector)
  const [movilesFilters, setMovilesFilters] = useState<MovilFilters>({ 
    capacidad: 'all', 
    estado: [] 
  });
  
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

  // Helper para eliminar móviles duplicados
  const removeDuplicateMoviles = useCallback((moviles: MovilData[]): MovilData[] => {
    const seen = new Set<number>();
    return moviles.filter(movil => {
      if (seen.has(movil.id)) {
        console.warn(`⚠️ Móvil duplicado encontrado y eliminado: ${movil.id}`);
        return false;
      }
      seen.add(movil.id);
      return true;
    });
  }, []);

  // Helper para marcar móviles inactivos según preferencias del usuario
  const markInactiveMoviles = useCallback((moviles: MovilData[]): MovilData[] => {
    return moviles.map(movil => {
      // Si no hay posición actual, marcar como inactivo si showActiveMovilesOnly está activado
      if (!movil.currentPosition) {
        return {
          ...movil,
          isInactive: preferences.showActiveMovilesOnly
        };
      }

      // Verificar el retraso máximo de coordenadas
      const coordDate = new Date(movil.currentPosition.fechaInsLog);
      const now = new Date();
      const minutesDiff = (now.getTime() - coordDate.getTime()) / (1000 * 60);
      
      // Si excede el retraso máximo configurado, marcar como inactivo
      if (minutesDiff > preferences.maxCoordinateDelayMinutes) {
        console.log(`👻 Móvil ${movil.id} marcado como inactivo: coordenada de hace ${Math.round(minutesDiff)} minutos (máximo: ${preferences.maxCoordinateDelayMinutes})`);
        return {
          ...movil,
          isInactive: true
        };
      }

      // Móvil activo
      return {
        ...movil,
        isInactive: false
      };
    });
  }, [preferences.showActiveMovilesOnly, preferences.maxCoordinateDelayMinutes]);

  // 🆕 Aplicar filtros avanzados de estado a los móviles
  // Filtro geográfico: solo mostrar datos dentro de Uruguay
  const URUGUAY_BOUNDS = { latMin: -35.8, latMax: -30.0, lngMin: -58.5, lngMax: -53.0 };
  const isInUruguay = useCallback((lat: number, lng: number): boolean => {
    return lat >= URUGUAY_BOUNDS.latMin && lat <= URUGUAY_BOUNDS.latMax &&
           lng >= URUGUAY_BOUNDS.lngMin && lng <= URUGUAY_BOUNDS.lngMax;
  }, []);

  const applyAdvancedFilters = useCallback((moviles: MovilData[]): MovilData[] => {
    // Si no hay filtros de estado activos, retornar todos
    if (movilesFilters.estado.length === 0) {
      return moviles;
    }

    return moviles.filter(movil => {
      const tamanoLote = movil.tamanoLote || 6;
      const pedidosAsignados = movil.pedidosAsignados || 0;
      const capacidadRestante = tamanoLote - pedidosAsignados;

      // Verificar cada estado seleccionado
      return movilesFilters.estado.some(estado => {
        switch (estado) {
          case 'no_reporta_gps':
            // Móviles sin posición o inactivos
            return !movil.currentPosition || movil.isInactive;
          
          case 'baja_momentanea':
            // Móviles con baja momentánea (sin historial reciente)
            return movil.currentPosition && !movil.history?.length;
          
          case 'con_capacidad':
            // Móviles con capacidad disponible (> 0)
            return capacidadRestante > 0;
          
          case 'sin_capacidad':
            // Móviles sin capacidad (0% disponible)
            return capacidadRestante === 0;
          
          default:
            return true;
        }
      });
    });
  }, [movilesFilters.estado]);

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

  // 🎨 Función para calcular el color del móvil según ocupación
  const getMovilColorByOccupancy = useCallback((pedidosAsignados: number, capacidad: number): string => {
    // Si no hay capacidad definida, usar color por defecto
    if (!capacidad || capacidad === 0) {
      return '#3B82F6'; // Azul por defecto
    }

    // Calcular porcentaje de ocupación
    const occupancyPercentage = (pedidosAsignados / capacidad) * 100;

    // Asignar color según porcentaje:
    // 100% (lleno) = Negro
    // 67-99% (casi lleno) = Amarillo
    // 0-66% (disponible) = Verde
    if (occupancyPercentage >= 100) {
      return '#000000'; // Negro - Lote lleno
    } else if (occupancyPercentage >= 67) {
      return '#EAB308'; // Amarillo - Casi lleno (4-5/6 en una capacidad de 6)
    } else {
      return '#22C55E'; // Verde - Disponible (0-3/6 en una capacidad de 6)
    }
  }, []);

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
            // Calcular el color basado en la ocupación
            const calculatedColor = getMovilColorByOccupancy(
              extendedData.pedidosAsignados, 
              extendedData.tamanoLote
            );
            
            return {
              ...movil,
              tamanoLote: extendedData.tamanoLote,
              pedidosAsignados: extendedData.pedidosAsignados,
              matricula: extendedData.matricula,
              estadoDesc: extendedData.estadoDesc,
              color: calculatedColor,
            };
          }
          return movil;
        });

        console.log(`✅ Enriched ${enrichedMoviles.length} moviles`);
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
          let newMoviles: MovilData[] = result.data.map((item: { 
            movilId: number; 
            movilName: string; 
            color: string;
            empresa_fletera_id: number;
            position: any 
          }) => ({
            id: item.movilId,
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
    // 2. No hay ningún móvil seleccionado (primera carga o después de limpiar)
    // 3. Es la primera carga (isInitialLoad es false significa que ya terminó la carga inicial)
    if (movilesFiltered.length > 0 && selectedMoviles.length === 0 && !isInitialLoad) {
      console.log('✅ Auto-selección: Marcando todos los móviles por defecto:', movilesFiltered.length);
      setSelectedMoviles(movilesFiltered.map(m => m.id));
    }
  }, [movilesFiltered.length, isInitialLoad]); // Depende de la cantidad de móviles y si es carga inicial

  // Recargar móviles cuando cambia la selección de empresas o la fecha (forzar recarga completa)
  useEffect(() => {
    if (!isLoadingEmpresas) {
      console.log('🏢 Empresas o fecha cambiaron - Forzando recarga completa');
      setIsInitialLoad(true); // Forzar recarga completa cuando cambian las empresas o la fecha
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
    setSelectedMoviles(movilesFiltered.map(m => m.id));
    setFocusedMovil(undefined);
  }, [movilesFiltered]);

  // Handler para deseleccionar todos los móviles
  const handleClearAll = useCallback(() => {
    setSelectedMoviles([]);
    setFocusedMovil(undefined);
  }, []);

  // Handler para clic en el marcador del mapa (abre popup con opciones)
  const handleMovilClick = useCallback(async (movilId: number | undefined) => {
    setPopupMovil(movilId);
    setSelectedMovil(undefined); // Cierra animación si estaba abierta
    setShowPendientes(false); // Oculta pendientes
    
    if (movilId) {
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
              if (movil.id === movilId) {
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

  // Handler para mostrar pendientes en el mapa
  const handleShowPendientes = useCallback(() => {
    setShowPendientes(true); // Muestra los marcadores de pedidos
    setShowCompletados(false); // Oculta completados
    setPopupMovil(undefined); // Cierra el popup
  }, []);

  // Handler para mostrar completados en el mapa
  const handleShowCompletados = useCallback(() => {
    setShowCompletados(true); // Muestra los marcadores de completados
    setShowPendientes(false); // Oculta pendientes
    setSelectedMovil(undefined); // Desactiva animación si estaba activa
    setPopupMovil(undefined); // Cierra el popup
  }, []);

  // Handler para cerrar el panel de animación
  const handleCloseAnimation = useCallback(() => {
    setSelectedMovil(undefined); // Desactiva la animación
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

  // Handler para click en pedido
  const handlePedidoClick = useCallback((pedidoId: number | undefined) => {
    setPopupService(undefined); // Cerrar popup de service si estaba abierto
    setPopupPedido(pedidoId);
  }, []);

  // Handler para click en service
  const handleServiceClick = useCallback((serviceId: number | undefined) => {
    setPopupPedido(undefined); // Cerrar popup de pedido si estaba abierto
    setPopupService(serviceId);
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
  const pedidosCompletos = useMemo(() => {
    const pedidosMap = new Map<number, PedidoSupabase>();
    
    // Agregar pedidos iniciales
    pedidosIniciales.forEach(p => pedidosMap.set(p.id, p));
    
    // Actualizar/agregar pedidos de realtime (sobrescriben los iniciales si existen)
    pedidosRealtime.forEach(p => pedidosMap.set(p.id, p));
    
    const resultado = Array.from(pedidosMap.values());
    
    // 🐛 DEBUG: Logging de pedidos completos
    console.log('🔷 DASHBOARD: pedidosCompletos calculado');
    console.log('📊 Total pedidos iniciales:', pedidosIniciales.length);
    console.log('📊 Total pedidos realtime:', pedidosRealtime.length);
    console.log('📊 Total pedidos completos:', resultado.length);
    if (resultado.length > 0) {
      console.log('📍 Primer pedido completo:', {
        id: resultado[0].id,
        latitud: resultado[0].latitud,
        longitud: resultado[0].longitud,
        cliente: resultado[0].cliente_nombre,
        estado: resultado[0].estado_nro
      });
      const conCoords = resultado.filter(p => p.latitud && p.longitud);
      console.log(`📍 ${conCoords.length} pedidos tienen coordenadas válidas`);
    }
    
    return resultado;
  }, [pedidosIniciales, pedidosRealtime]);

  // Combinar services iniciales con updates de realtime
  const servicesCompletos = useMemo(() => {
    const servicesMap = new Map<number, ServiceSupabase>();
    servicesIniciales.forEach(s => servicesMap.set(s.id, s));
    servicesRealtime.forEach(s => servicesMap.set(s.id, s));
    const resultado = Array.from(servicesMap.values());
    console.log(`🔧 DASHBOARD: servicesCompletos: ${resultado.length}`);
    return resultado;
  }, [servicesIniciales, servicesRealtime]);

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
      if (pedido.movil && estadoNum && ESTADOS_ACTIVOS.includes(estadoNum)) {
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
    }, REALTIME_INTERVAL);

    return () => clearInterval(interval);
  }, [fetchPositions, preferences.realtimeEnabled, selectedMovil, fetchMovilHistory]);

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
        >
          <DashboardIndicators
            moviles={movilesFiltered}
            pedidos={pedidosCompletos}
            services={servicesCompletos}
            selectedDate={selectedDate}
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

      {/* Botones flotantes: Tracking + POI */}
      <div className="fixed top-3 right-16 z-[9999] flex items-center gap-2">
        {/* Botón de Tracking */}
        <button
          onClick={() => setIsTrackingModalOpen(true)}
          className="flex items-center justify-center w-10 h-10 rounded-full shadow-2xl transition-all duration-300 transform hover:scale-110 bg-gradient-to-br from-purple-500 to-indigo-600 hover:from-purple-600 hover:to-indigo-700"
          title="Ver recorrido de un móvil"
        >
          <svg 
            className="w-5 h-5 text-white"
            fill="none" 
            stroke="currentColor" 
            viewBox="0 0 24 24"
          >
            <path 
              strokeLinecap="round" 
              strokeLinejoin="round" 
              strokeWidth={2} 
              d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" 
            />
          </svg>
        </button>

        {/* Botón para activar modo de colocación de marcadores (POI) */}
        <button
          onClick={() => setIsPlacingMarker(!isPlacingMarker)}
          className={`
            flex items-center justify-center w-10 h-10 rounded-full shadow-2xl
            transition-all duration-300 transform hover:scale-110
            ${isPlacingMarker
              ? 'bg-gradient-to-br from-red-500 to-red-600 animate-pulse'
              : 'bg-gradient-to-br from-green-500 to-green-600 hover:from-green-600 hover:to-green-700'
            }
          `}
          title={isPlacingMarker ? 'Cancelar modo de colocación' : 'Agregar marcador personalizado'}
        >
          <svg 
            className={`w-5 h-5 text-white transition-transform ${isPlacingMarker ? 'scale-110' : ''}`}
            fill="none" 
            stroke="currentColor" 
            viewBox="0 0 24 24"
          >
            <path 
              strokeLinecap="round" 
              strokeLinejoin="round" 
              strokeWidth={2} 
              d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" 
            />
            <path 
              strokeLinecap="round" 
              strokeLinejoin="round" 
              strokeWidth={2} 
              d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" 
            />
          </svg>
        </button>
      </div>

      {/* Modal de Tracking */}
      <TrackingModal
        isOpen={isTrackingModalOpen}
        onClose={() => setIsTrackingModalOpen(false)}
        onConfirm={handleTrackingConfirm}
        moviles={movilesFiltered}
        selectedDate={selectedDate}
        selectedMovil={selectedMoviles.length === 1 ? selectedMoviles[0] : undefined}
      />

      {/* Indicador de conexión Realtime - Alineado a la derecha en el borde header/mapa */}
      <div className="absolute right-4 top-[68px] z-50">
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
              initial={false}
              animate={{
                x: isSidebarCollapsed ? -380 : 0,
              }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              className="absolute left-0 top-0 bottom-0 z-30 w-96 bg-white shadow-2xl flex flex-col"
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
                />
              </div>
            </motion.div>

            {/* Botón para colapsar/expandir el sidebar */}
            <motion.button
              initial={false}
              animate={{
                left: isSidebarCollapsed ? 0 : 384,
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
              initial={false}
              animate={{
                paddingLeft: isSidebarCollapsed ? 0 : 384,
              }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              className="w-full h-full"
            >
              <MapView 
                moviles={applyAdvancedFilters(markInactiveMoviles(movilesFiltered)).filter(m => selectedMoviles.includes(m.id) && (!m.currentPosition || isInUruguay(m.currentPosition.coordX, m.currentPosition.coordY)))}
                focusedMovil={focusedMovil}
                selectedMovil={selectedMovil}
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
                pedidos={(selectedMoviles.length > 0 ? pedidosCompletos.filter(p => Number(p.estado_nro) === 1 && p.movil && selectedMoviles.some(id => Number(id) === Number(p.movil))) : pedidosCompletos.filter(p => Number(p.estado_nro) === 1)).filter(p => !p.latitud || !p.longitud || isInUruguay(p.latitud, p.longitud))}
                allPedidos={pedidosCompletos}
                onPedidoClick={handlePedidoClick}
                popupPedido={popupPedido}
                services={(selectedMoviles.length > 0 ? servicesCompletos.filter(s => Number(s.estado_nro) === 1 && s.movil && selectedMoviles.some(id => Number(id) === Number(s.movil))) : servicesCompletos.filter(s => Number(s.estado_nro) === 1)).filter(s => !s.latitud || !s.longitud || isInUruguay(s.latitud, s.longitud))}
                allServices={servicesCompletos}
                onServiceClick={handleServiceClick}
                popupService={popupService}
                isPlacingMarker={isPlacingMarker}
                onPlacingMarkerChange={setIsPlacingMarker}
                onMarkersChange={setPuntosInteres}
                allMoviles={movilesFiltered}
                selectedDate={selectedDate}
                onMovilDateChange={handleTrackingConfirm}
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
