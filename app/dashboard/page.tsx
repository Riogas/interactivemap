'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { motion } from 'framer-motion';
import { MovilData, EmpresaFleteraSupabase, PedidoPendiente, PedidoSupabase } from '@/types';
import MovilSelector from '@/components/ui/MovilSelector';
import NavbarSimple from '@/components/layout/NavbarSimple';
import FloatingToolbar from '@/components/layout/FloatingToolbar';
import { useRealtime } from '@/components/providers/RealtimeProvider';
import { useUserPreferences, UserPreferences } from '@/components/ui/PreferencesModal';
import ProtectedRoute from '@/components/auth/ProtectedRoute';
import { usePedidosRealtime } from '@/lib/hooks/useRealtimeSubscriptions';

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
  // Hook de Realtime para escuchar actualizaciones GPS y móviles nuevos
  const { latestPosition, latestMovil, isConnected } = useRealtime();
  
  // Hook de preferencias de usuario
  const { preferences, updatePreferences } = useUserPreferences();
  
  const [moviles, setMoviles] = useState<MovilData[]>([]);
  const [selectedMoviles, setSelectedMoviles] = useState<number[]>([]); // Array de móviles seleccionados
  const [focusedMovil, setFocusedMovil] = useState<number | undefined>(); // Móvil enfocado en el mapa (para centrar)
  const [selectedMovil, setSelectedMovil] = useState<number | undefined>(); // Móvil seleccionado para animación
  const [popupMovil, setPopupMovil] = useState<number | undefined>(); // Móvil con popup abierto
  const [popupPedido, setPopupPedido] = useState<number | undefined>(); // Pedido con popup abierto
  const [showPendientes, setShowPendientes] = useState(false); // Mostrar marcadores de pedidos
  const [showCompletados, setShowCompletados] = useState(false); // Mostrar marcadores de completados
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isInitialLoad, setIsInitialLoad] = useState(true); // Flag para carga inicial
  
  // Estado para el panel colapsable
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  
  // Estado para empresas fleteras
  const [empresas, setEmpresas] = useState<EmpresaFleteraSupabase[]>([]);
  const [selectedEmpresas, setSelectedEmpresas] = useState<number[]>([]);
  
  // 🔥 NUEVO: Hook para escuchar cambios en pedidos en tiempo real
  const { 
    pedidos: pedidosRealtime, 
    isConnected: pedidosConnected,
    error: pedidosError 
  } = usePedidosRealtime(
    1000, // escenarioId (ajustar según tu base de datos)
    selectedMoviles.length > 0 ? selectedMoviles : undefined // Solo escuchar pedidos de móviles seleccionados
  );
  
  // Estado para pedidos cargados inicialmente
  const [pedidosIniciales, setPedidosIniciales] = useState<PedidoSupabase[]>([]);
  const [isLoadingPedidos, setIsLoadingPedidos] = useState(true);
  
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

  // Cargar empresas fleteras al montar el componente
  useEffect(() => {
    const loadEmpresas = async () => {
      try {
        console.log('🏢 Loading empresas fleteras...');
        const response = await fetch('/api/empresas');
        const result = await response.json();
        
        if (result.success) {
          setEmpresas(result.data);
          // Por defecto, seleccionar todas las empresas
          setSelectedEmpresas(result.data.map((e: EmpresaFleteraSupabase) => e.empresa_fletera_id));
          console.log(`✅ Loaded ${result.data.length} empresas fleteras`);
        }
      } catch (err) {
        console.error('❌ Error loading empresas:', err);
      } finally {
        setIsLoadingEmpresas(false);
      }
    };
    
    loadEmpresas();
  }, []);

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
        }

        // Mapear por ID (que es TEXT), no por nro
        const extendedDataMap = new Map<string, ExtendedData>(
          result.data.map((item: ExtendedData) => [item.id, item])
        );

        console.log('📊 Extended data map:', Array.from(extendedDataMap.entries()).slice(0, 2)); // Ver primeros 2 móviles

        const enrichedMoviles = moviles.map(movil => {
          // Convertir movil.id a string para buscar en el map
          const extendedData = extendedDataMap.get(movil.id.toString());
          if (extendedData) {
            // Calcular el color basado en la ocupación
            const calculatedColor = getMovilColorByOccupancy(
              extendedData.pedidosAsignados, 
              extendedData.tamanoLote
            );
            
            console.log(`✅ Enriching movil ${movil.id}:`, {
              tamanoLote: extendedData.tamanoLote,
              pedidosAsignados: extendedData.pedidosAsignados,
              matricula: extendedData.matricula,
              color: calculatedColor
            });
            return {
              ...movil,
              tamanoLote: extendedData.tamanoLote,
              pedidosAsignados: extendedData.pedidosAsignados,
              matricula: extendedData.matricula,
              color: calculatedColor, // Usar el color calculado en lugar del del API
            };
          }
          console.warn(`⚠️ No extended data for movil ${movil.id}`);
          return movil;
        });

        console.log(`✅ Enriched ${enrichedMoviles.length} moviles with extended data`);
        console.log('📊 Sample enriched movil:', enrichedMoviles[0]);
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

  // Función para cargar pedidos desde API
  const fetchPedidos = useCallback(async () => {
    try {
      console.log('📦 Fetching pedidos from API...');
      setIsLoadingPedidos(true);
      
      // Construir URL con filtros
      const params = new URLSearchParams();
      params.append('escenario', '1000'); // Escenario (ajustar según tu base de datos)
      if (selectedDate) {
        params.append('fecha', selectedDate);
      }
      
      const url = `/api/pedidos?${params.toString()}`;
      const response = await fetch(url);
      const result = await response.json();

      if (result.success) {
        console.log(`✅ Loaded ${result.count} pedidos (con y sin coordenadas)`);
        setPedidosIniciales(result.data || []);
      } else {
        console.error('❌ Error loading pedidos:', result.error);
      }
    } catch (err) {
      console.error('❌ Error fetching pedidos:', err);
    } finally {
      setIsLoadingPedidos(false);
    }
  }, [selectedDate]);

  // 🔥 NUEVO: Seleccionar todos los móviles automáticamente en la carga inicial
  useEffect(() => {
    // Solo auto-seleccionar si:
    // 1. Hay móviles cargados
    // 2. No hay ningún móvil seleccionado (primera carga o después de limpiar)
    // 3. Es la primera carga (isInitialLoad es false significa que ya terminó la carga inicial)
    if (moviles.length > 0 && selectedMoviles.length === 0 && !isInitialLoad) {
      console.log('✅ Auto-selección: Marcando todos los móviles por defecto:', moviles.length);
      setSelectedMoviles(moviles.map(m => m.id));
    }
  }, [moviles.length, isInitialLoad]); // Depende de la cantidad de móviles y si es carga inicial

  // Recargar móviles cuando cambia la selección de empresas o la fecha (forzar recarga completa)
  useEffect(() => {
    if (!isLoadingEmpresas) {
      console.log('🏢 Empresas o fecha cambiaron - Forzando recarga completa');
      setIsInitialLoad(true); // Forzar recarga completa cuando cambian las empresas o la fecha
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
    
    const movilId = parseInt(latestPosition.movil);
    console.log(`🔔 Actualización Realtime para móvil ${movilId}:`, latestPosition);
    
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
    
    const movilId = latestMovil.movil;
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
      // CASO 1: Si NO hay móviles seleccionados, traer TODOS los pedidos del día
      if (movilesIds.length === 0) {
        console.log(`📦 Cargando TODOS los pedidos pendientes del día`);
        
        // selectedDate ya es un string en formato 'YYYY-MM-DD'
        const fecha = selectedDate;
        const response = await fetch(`/api/pedidos-pendientes?escenarioId=1&fecha=${fecha}`);
        const result = await response.json();
        
        if (result.pedidos && result.pedidos.length > 0) {
          console.log(`✅ Encontrados ${result.pedidos.length} pedidos pendientes en total`);
          
          // Convertir todos los pedidos a formato PedidoServicio
          const todosPedidos = result.pedidos.map((p: PedidoPendiente) => ({
            tipo: 'PEDIDO' as const,
            id: p.pedido_id,
            cliid: 0,
            clinom: p.cliente_nombre || 'Sin nombre',
            fecha: p.fecha_para || '',
            x: p.latitud,
            y: p.longitud,
            estado: p.estado || 0,
            subestado: 0,
            zona: p.zona || '',
            producto_codigo: p.producto_codigo || '',
            producto_nombre: p.producto_nombre || '',
            producto_cantidad: p.producto_cantidad || 0,
            observacion: p.observacion || '',
            prioridad: p.prioridad || 0,
            movilId: p.movil, // Mantener referencia al móvil
          }));
          
          // Actualizar móviles agrupando pedidos por móvil
          setMoviles(prevMoviles => {
            return prevMoviles.map(movil => {
              const pedidosDelMovil = todosPedidos.filter((p: any) => p.movilId === movil.id);
              
              if (pedidosDelMovil.length > 0) {
                return {
                  ...movil,
                  pendientes: pedidosDelMovil,
                  pedidosPendientes: pedidosDelMovil.length,
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
      
      // Cargar pedidos para cada móvil seleccionado
      const pedidosPromises = movilesIds.map(async (movilId) => {
        const response = await fetch(`/api/pedidos-pendientes/${movilId}?escenarioId=1`);
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
            const pendientes = movilPedidos.pedidos.map((p: PedidoPendiente) => ({
              tipo: 'PEDIDO' as const,
              id: p.pedido_id,
              cliid: 0,
              clinom: p.cliente_nombre || 'Sin nombre',
              fecha: p.fecha_para || '',
              x: p.latitud,
              y: p.longitud,
              estado: p.estado || 0,
              subestado: 0,
              zona: p.zona || '',
              producto_codigo: p.producto_codigo || '',
              producto_nombre: p.producto_nombre || '',
              producto_cantidad: p.producto_cantidad || 0,
              observacion: p.observacion || '',
              prioridad: p.prioridad || 0,
            }));

            console.log(`✅ Móvil ${movil.id}: ${pendientes.length} pedidos pendientes`);
            
            return {
              ...movil,
              pendientes,
              pedidosPendientes: pendientes.length,
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
    setSelectedMoviles(moviles.map(m => m.id));
    setFocusedMovil(undefined);
  }, [moviles]);

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
        const url = `/api/pedidos-servicios-pendientes/${movilId}${selectedDate ? `?fecha_desde=${selectedDate} 00:00:00` : ''}`;
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
    // Verificar que solo haya UN móvil seleccionado
    if (selectedMoviles.length !== 1) {
      alert('⚠️ La animación solo está disponible cuando tienes UN solo móvil seleccionado');
      return;
    }
    
    console.log(`🎬 Iniciando animación para móvil ${movilId}`);
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

  // Handler para click en pedido
  const handlePedidoClick = useCallback((pedidoId: number | undefined) => {
    setPopupPedido(pedidoId); // Abre/cierra popup de pedido
  }, []);

  // Combinar pedidos iniciales con updates de realtime
  const pedidosCompletos = useMemo(() => {
    const pedidosMap = new Map<number, PedidoSupabase>();
    
    // Agregar pedidos iniciales
    pedidosIniciales.forEach(p => pedidosMap.set(p.id, p));
    
    // Actualizar/agregar pedidos de realtime (sobrescriben los iniciales si existen)
    pedidosRealtime.forEach(p => pedidosMap.set(p.id, p));
    
    return Array.from(pedidosMap.values());
  }, [pedidosIniciales, pedidosRealtime]);

  // Initial fetch
  useEffect(() => {
    fetchPositions();
    fetchPedidos(); // Cargar pedidos iniciales
  }, [fetchPositions, fetchPedidos]);

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
  useEffect(() => {
    if (pedidosRealtime.length === 0) return;
    
    console.log(`📦 Actualizando ${pedidosRealtime.length} pedidos desde Realtime`);
    
    // Convertir pedidos de Realtime a formato compatible
    const pedidosFormateados = pedidosRealtime.map(p => ({
      tipo: 'PEDIDO' as const,
      id: p.pedido_id,
      cliid: 0,
      clinom: p.cliente_nombre || 'Sin nombre',
      fecha: p.fecha_para || '',
      x: p.latitud,
      y: p.longitud,
      estado: p.estado || 0,
      subestado: 0,
      zona: p.zona || '',
      producto_codigo: p.producto_codigo || '',
      producto_nombre: p.producto_nombre || '',
      producto_cantidad: p.producto_cantidad || 0,
      observacion: p.observacion || '',
      prioridad: p.prioridad || 0,
    }));
    
    // Actualizar móviles con los nuevos pedidos
    setMoviles(prevMoviles => {
      return prevMoviles.map(movil => {
        // Filtrar pedidos que pertenecen a este móvil
        const pedidosDelMovil = pedidosFormateados.filter(p => {
          // Buscar el pedido original para obtener el movil
          const pedidoOriginal = pedidosRealtime.find(pr => pr.pedido_id === p.id);
          return pedidoOriginal?.movil === movil.id;
        });
        
        if (pedidosDelMovil.length > 0) {
          // Actualizar el conteo de pedidos asignados
          const newPedidosAsignados = pedidosDelMovil.length;
          
          // Recalcular el color basado en la nueva ocupación
          const newColor = getMovilColorByOccupancy(
            newPedidosAsignados,
            movil.tamanoLote || 0
          );
          
          return {
            ...movil,
            pedidos: pedidosDelMovil,
            pedidosAsignados: newPedidosAsignados,
            color: newColor, // Actualizar el color dinámicamente
          };
        }
        
        return movil;
      });
    });
  }, [pedidosRealtime, getMovilColorByOccupancy]);

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50">
      {/* Navbar Simple - Solo logo y espacio para indicadores */}
      <div className="flex-shrink-0">
        <NavbarSimple>
          {/* Aquí puedes agregar indicadores personalizados */}
          <div className="flex items-center gap-4">
            {/* Ejemplo: Contador de móviles activos */}
            <div className="bg-white/20 backdrop-blur-sm rounded-lg px-4 py-2 border border-white/30">
              <span className="text-white font-semibold text-sm">
                🚗 {moviles.filter(m => !m.isInactive).length} activos
              </span>
            </div>
            {/* Ejemplo: Contador de pedidos */}
            <div className="bg-white/20 backdrop-blur-sm rounded-lg px-4 py-2 border border-white/30">
              <span className="text-white font-semibold text-sm">
                📦 {pedidosCompletos.length} pedidos
              </span>
            </div>
          </div>
        </NavbarSimple>
      </div>

      {/* Floating Toolbar - Filtros, Preferencias, Usuario */}
      <FloatingToolbar
        selectedDate={selectedDate}
        onDateChange={setSelectedDate}
        empresas={empresas}
        selectedEmpresas={selectedEmpresas}
        onEmpresasChange={setSelectedEmpresas}
        isLoadingEmpresas={isLoadingEmpresas}
        onPreferencesChange={(newPrefs) => {
          updatePreferences(newPrefs);
        }}
      />

      {/* Indicador de conexión Realtime */}
      <div className="fixed top-20 right-4 z-50">
        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          className={`px-3 py-1.5 rounded-full shadow-lg flex items-center gap-2 text-xs font-medium ${
            preferences.realtimeEnabled 
              ? (isConnected ? 'bg-green-500 text-white' : 'bg-yellow-500 text-white')
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
                  moviles={markInactiveMoviles(moviles)}
                  selectedMoviles={selectedMoviles}
                  onToggleMovil={handleToggleMovil}
                  onSelectAll={handleSelectAll}
                  onClearAll={handleClearAll}
                  pedidos={pedidosCompletos}
                  onPedidoClick={handlePedidoClick}
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
                moviles={markInactiveMoviles(moviles).filter(m => selectedMoviles.length === 0 || selectedMoviles.includes(m.id))}
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
                pedidos={pedidosCompletos}
                onPedidoClick={handlePedidoClick}
                popupPedido={popupPedido}
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
