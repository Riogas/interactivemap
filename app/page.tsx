'use client';

import { useState, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { motion } from 'framer-motion';
import { MovilData, EmpresaFletera } from '@/types';
import MovilSelector from '@/components/ui/MovilSelector';
import EmpresaSelector from '@/components/ui/EmpresaSelector';

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

export default function Home() {
  const [moviles, setMoviles] = useState<MovilData[]>([]);
  const [focusedMovil, setFocusedMovil] = useState<number | undefined>(); // Móvil enfocado desde la lista (solo visual)
  const [selectedMovil, setSelectedMovil] = useState<number | undefined>(); // Móvil seleccionado para animación
  const [popupMovil, setPopupMovil] = useState<number | undefined>(); // Móvil con popup abierto
  const [showPendientes, setShowPendientes] = useState(false); // Mostrar marcadores de pedidos
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updateInterval, setUpdateInterval] = useState(30000); // 30 segundos por defecto (optimizado)
  const [isInitialLoad, setIsInitialLoad] = useState(true); // Flag para carga inicial
  
  // Estado para empresas fleteras
  const [empresas, setEmpresas] = useState<EmpresaFletera[]>([]);
  const [selectedEmpresas, setSelectedEmpresas] = useState<number[]>([]);
  const [isLoadingEmpresas, setIsLoadingEmpresas] = useState(true);
  
  // Estado para fecha seleccionada (por defecto hoy)
  const [selectedDate, setSelectedDate] = useState<string>(() => {
    const today = new Date();
    return today.toISOString().split('T')[0]; // Formato YYYY-MM-DD
  });

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
          setSelectedEmpresas(result.data.map((e: EmpresaFletera) => e.eflid));
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
            position: any 
          }) => ({
            id: item.movilId,
            name: item.movilName,
            color: item.color,
            currentPosition: item.position,
            history: undefined, // Se cargará bajo demanda
          }));
          
          setMoviles(newMoviles);
          setIsInitialLoad(false); // Marcar que ya no es carga inicial
          console.log('📦 Carga inicial completa');
        } else {
          // ACTUALIZACIÓN: Solo actualizar las posiciones GPS manteniendo TODAS las propiedades
          setMoviles(prevMoviles => {
            return prevMoviles.map(movil => {
              // Buscar la nueva posición de este móvil
              const updatedData = result.data.find((item: any) => item.movilId === movil.id);
              
              if (updatedData) {
                // Solo actualizar currentPosition, mantener TODO el resto igual
                // (history, pendientes, pedidosPendientes, serviciosPendientes)
                return {
                  ...movil, // Mantener TODAS las propiedades existentes
                  currentPosition: updatedData.position, // Solo actualizar posición
                };
              }
              
              // Si el móvil no está en la actualización, mantenerlo sin cambios
              return movil;
            });
          });
          console.log('🔄 Posiciones GPS actualizadas (historial y pendientes preservados)');
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
  }, [selectedEmpresas, empresas.length, isInitialLoad]);

  // Recargar móviles cuando cambia la selección de empresas o la fecha (forzar recarga completa)
  useEffect(() => {
    if (!isLoadingEmpresas) {
      console.log('🏢 Empresas o fecha cambiaron - Forzando recarga completa');
      setIsInitialLoad(true); // Forzar recarga completa cuando cambian las empresas o la fecha
      fetchPositions();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEmpresas, isLoadingEmpresas, selectedDate]); // Remover fetchPositions de dependencias para evitar loops

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

  // Handler para clic en la lista (solo enfoca el móvil)
  const handleMovilFromList = useCallback((movilId: number | undefined) => {
    setFocusedMovil(movilId); // Enfocar este móvil (solo se muestra él en el mapa)
    setPopupMovil(undefined); // Cierra popup si estaba abierto
    setSelectedMovil(undefined); // Cierra animación si estaba abierta
    setShowPendientes(false); // Oculta pendientes
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

  // Handler para mostrar la animación (desde el botón del popup)
  const handleShowAnimation = useCallback(async (movilId: number) => {
    console.log(`🎬 Iniciando animación para móvil ${movilId}`);
    setPopupMovil(undefined); // Cierra el popup
    setShowPendientes(false); // Oculta pendientes
    
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
  }, [moviles, fetchMovilHistory]);

  // Handler para mostrar pendientes en el mapa
  const handleShowPendientes = useCallback(() => {
    setShowPendientes(true); // Muestra los marcadores de pedidos
    setPopupMovil(undefined); // Cierra el popup
  }, []);

  // Initial fetch
  useEffect(() => {
    fetchPositions();
  }, [fetchPositions]);

  // Auto-refresh de posiciones y historial del móvil seleccionado
  useEffect(() => {
    const interval = setInterval(() => {
      console.log(`🔄 Auto-refresh triggered. Selected móvil: ${selectedMovil || 'none'}`);
      fetchPositions(); // Actualizar solo posiciones GPS
      
      // Si hay un móvil seleccionado, actualizar también su historial
      if (selectedMovil) {
        console.log(`📜 Refreshing history for móvil ${selectedMovil}`);
        fetchMovilHistory(selectedMovil);
      }
    }, updateInterval);

    return () => clearInterval(interval);
  }, [fetchPositions, updateInterval, selectedMovil, fetchMovilHistory]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50">
      {/* Header */}
      <motion.header
        initial={{ y: -100 }}
        animate={{ y: 0 }}
        className="bg-white shadow-lg"
      >
        <div className="container mx-auto px-4 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 20, repeat: Infinity, ease: 'linear' }}
              >
                <svg className="w-10 h-10 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </motion.div>
              <div>
                <h1 className="text-3xl font-bold text-gray-800">TrackMovil</h1>
                <p className="text-sm text-gray-600">Sistema de rastreo en tiempo real</p>
              </div>
            </div>

            {/* Interval selector */}
            <div className="flex items-center gap-3">
              <label className="text-sm font-medium text-gray-700">
                Actualización:
              </label>
              <select
                value={updateInterval}
                onChange={(e) => setUpdateInterval(Number(e.target.value))}
                className="px-4 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value={5000}>5 segundos</option>
                <option value={10000}>10 segundos</option>
                <option value={30000}>30 segundos (Recomendado)</option>
                <option value={60000}>1 minuto</option>
                <option value={120000}>2 minutos</option>
              </select>
            </div>
          </div>
        </div>
      </motion.header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8">
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-lg mb-6"
          >
            <strong className="font-bold">Error: </strong>
            <span>{error}</span>
          </motion.div>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center h-96">
            <div className="text-center">
              <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-blue-600 mx-auto mb-4" />
              <p className="text-xl text-gray-600">Cargando datos...</p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-10 gap-6">
            {/* Left Sidebar */}
            <motion.div
              initial={{ opacity: 0, x: -50 }}
              animate={{ opacity: 1, x: 0 }}
              className="lg:col-span-3 space-y-6"
            >
              {/* Selector de Fecha */}
              <div className="bg-white rounded-xl shadow-lg p-4">
                <h3 className="font-bold text-gray-800 mb-3 flex items-center gap-2">
                  <span>📅</span>
                  Fecha de Consulta
                </h3>
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  max={new Date().toISOString().split('T')[0]}
                  className="w-full px-4 py-2.5 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200 text-gray-700 font-medium"
                />
                <p className="text-xs text-gray-500 mt-2">
                  🔍 Todas las consultas se filtrarán por esta fecha
                </p>
              </div>

              {/* Selector de Empresas Fleteras */}
              <div className="bg-white rounded-xl shadow-lg p-4">
                <h3 className="font-bold text-gray-800 mb-3 flex items-center gap-2">
                  <span>🏢</span>
                  Empresas Fleteras
                </h3>
                {isLoadingEmpresas ? (
                  <div className="text-center py-4">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto" />
                  </div>
                ) : (
                  <EmpresaSelector
                    empresas={empresas}
                    selectedEmpresas={selectedEmpresas}
                    onSelectionChange={setSelectedEmpresas}
                  />
                )}
              </div>

              {/* Selector de Móviles */}
              <MovilSelector
                moviles={moviles}
                selectedMovil={focusedMovil}
                onSelectMovil={handleMovilFromList}
              />
            </motion.div>

            {/* Map - Ampliado */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="lg:col-span-7 h-[800px]"
            >
              <MapView 
                moviles={moviles}
                focusedMovil={focusedMovil}
                selectedMovil={selectedMovil}
                popupMovil={popupMovil}
                showPendientes={showPendientes}
                onMovilClick={handleMovilClick}
                onShowAnimation={handleShowAnimation}
                onShowPendientes={handleShowPendientes}
              />
            </motion.div>

            {/* InfoPanel removido - información se mostrará en popup del mapa */}
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="bg-white shadow-lg mt-12">
        <div className="container mx-auto px-4 py-6 text-center text-gray-600">
          <p className="text-sm">
            © 2025 TrackMovil - Sistema de rastreo vehicular en tiempo real
          </p>
        </div>
      </footer>
    </div>
  );
}
