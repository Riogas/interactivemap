'use client';

import React, { useEffect, useRef, useState, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { MovilData, PedidoServicio, PedidoPendiente, PedidoSupabase, CustomMarker } from '@/types';
import RouteAnimationControl from './RouteAnimationControl';
import { MovilInfoPopup } from './MovilInfoPopup';
import { PedidoInfoPopup } from './PedidoInfoPopup';
import PedidoServicioPopup from './PedidoServicioPopup';
import LayersControl from './LayersControl';
import CustomMarkerModal from './CustomMarkerModal';
import { format } from 'date-fns';
import 'leaflet/dist/leaflet.css';

// Fix for default marker icons in Next.js
const iconPrototype = L.Icon.Default.prototype as unknown as { _getIconUrl?: string };
delete iconPrototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

interface MapViewProps {
  moviles: MovilData[];
  focusedMovil?: number; // Móvil enfocado desde la lista (solo visual)
  selectedMovil?: number; // Móvil seleccionado para animación
  popupMovil?: number; // Móvil con popup abierto
  showPendientes?: boolean; // Mostrar marcadores de pendientes
  showCompletados?: boolean; // Mostrar solo marcadores de completados (sin animación)
  selectedMovilesCount?: number; // Número de móviles seleccionados en la lista
  defaultMapLayer?: 'streets' | 'satellite' | 'terrain' | 'cartodb' | 'dark' | 'light'; // Capa por defecto del mapa
  onMovilClick?: (movilId: number | undefined) => void;
  onShowAnimation?: (movilId: number) => void;
  onCloseAnimation?: () => void; // Cerrar animación
  onShowPendientes?: () => void;
  onShowCompletados?: () => void;
  pedidos?: PedidoSupabase[]; // Nueva prop para mostrar pedidos en el mapa
  onPedidoClick?: (pedidoId: number | undefined) => void; // Callback para click en pedido
  popupPedido?: number; // Pedido con popup abierto
}

function MapUpdater({ moviles, focusedMovil, selectedMovil, selectedMovilesCount }: { 
  moviles: MovilData[]; 
  focusedMovil?: number; 
  selectedMovil?: number;
  selectedMovilesCount?: number;
}) {
  const map = useMap();
  const hasInitialized = useRef(false);
  const lastSelectedMovil = useRef<number | undefined>(undefined);
  const lastFocusedMovil = useRef<number | undefined>(undefined);
  const lastSelectedMovilesCount = useRef<number>(0);
  const userHasInteracted = useRef(false);

  // Detectar cuando el usuario mueve el mapa manualmente
  useEffect(() => {
    const handleUserInteraction = () => {
      userHasInteracted.current = true;
    };

    // Detectar drag (pan) y zoom manual
    map.on('dragstart', handleUserInteraction);
    map.on('zoomstart', handleUserInteraction);

    return () => {
      map.off('dragstart', handleUserInteraction);
      map.off('zoomstart', handleUserInteraction);
    };
  }, [map]);

  // Efecto para centrar el mapa SOLO la primera vez que se cargan móviles
  useEffect(() => {
    if (!hasInitialized.current && moviles.length > 0 && !selectedMovil && !focusedMovil) {
      const movilesConPosicion = moviles.filter(m => m.currentPosition);
      
      if (movilesConPosicion.length > 0) {
        const bounds = movilesConPosicion.map(m => 
          [m.currentPosition!.coordX, m.currentPosition!.coordY] as [number, number]
        );
        console.log('📍 Ajuste inicial del mapa a bounds de', movilesConPosicion.length, 'móviles');
        map.fitBounds(bounds, { padding: [50, 50], maxZoom: 13 });
        hasInitialized.current = true;
      }
    }
  }, [map, moviles.length]); // Solo cuando cambia la cantidad de móviles (primera carga)

  // Efecto para centrar el mapa SOLO cuando cambia la selección (no por actualizaciones GPS)
  useEffect(() => {
    // Solo ajustar si cambió la cantidad de móviles seleccionados
    const selectionChanged = selectedMovilesCount !== lastSelectedMovilesCount.current;
    
    if (!selectionChanged) {
      return; // No hacer nada si es solo actualización de coordenadas GPS
    }

    // Actualizar la referencia
    lastSelectedMovilesCount.current = selectedMovilesCount || 0;

    // Resetear flag de interacción del usuario cuando cambia la selección
    userHasInteracted.current = false;

    // No ajustar si hay animación activa
    if (selectedMovil) {
      return;
    }

    // Si no hay móviles para mostrar, no hacer nada
    if (moviles.length === 0) {
      return;
    }

    const movilesConPosicion = moviles.filter(m => m.currentPosition);
    
    if (movilesConPosicion.length === 0) {
      return;
    }

    // Si hay múltiples móviles, ajustar bounds para mostrar todos
    if (movilesConPosicion.length > 1) {
      const bounds = movilesConPosicion.map(m => 
        [m.currentPosition!.coordX, m.currentPosition!.coordY] as [number, number]
      );
      console.log('📍 Ajustando mapa para mostrar', movilesConPosicion.length, 'móviles seleccionados');
      console.log('📍 IDs de móviles:', movilesConPosicion.map(m => m.id).join(', '));
      map.fitBounds(bounds, { padding: [80, 80], maxZoom: 15 });
    } else if (movilesConPosicion.length === 1) {
      // Si solo hay un móvil con posición, centrar en él
      const movil = movilesConPosicion[0];
      console.log('📍 Centrando mapa en único móvil visible:', movil.id);
      map.setView([movil.currentPosition!.coordX, movil.currentPosition!.coordY], 15, {
        animate: true,
      });
    }
  }, [map, selectedMovilesCount, moviles, selectedMovil]); // Solo depende de selectedMovilesCount para cambios de selección

  // Efecto para centrar el mapa cuando se enfoca un móvil desde la lista
  useEffect(() => {
    if (focusedMovil !== lastFocusedMovil.current) {
      lastFocusedMovil.current = focusedMovil;
      
      if (focusedMovil && moviles.length > 0) {
        const movil = moviles.find(m => m.id === focusedMovil);
        if (movil?.currentPosition) {
          console.log('📍 Centrando mapa en móvil enfocado:', movil.id);
          map.setView([movil.currentPosition.coordX, movil.currentPosition.coordY], 15, {
            animate: true,
          });
        }
      }
    }
  }, [map, focusedMovil, moviles]);

  // Efecto para centrar el mapa SOLO cuando CAMBIA la selección de móvil (animación)
  useEffect(() => {
    // Solo centrar si la selección realmente cambió (no en actualizaciones de datos)
    if (selectedMovil !== lastSelectedMovil.current) {
      lastSelectedMovil.current = selectedMovil;
      
      if (selectedMovil && moviles.length > 0) {
        const movil = moviles.find(m => m.id === selectedMovil);
        if (movil?.currentPosition) {
          console.log('📍 Centrando mapa en móvil para animación:', movil.id);
          map.setView([movil.currentPosition.coordX, movil.currentPosition.coordY], 15, {
            animate: true,
          });
        }
      }
    }
  }, [map, selectedMovil, moviles]); // Se ejecuta en cambios, pero solo centra si selectedMovil cambió

  return null;
}

// Componente para seguir la animación
interface AnimationFollowerProps {
  moviles: MovilData[];
  selectedMovil?: number;
  animationProgress: number;
  isAnimating: boolean;
  startTime: string;
  endTime: string;
}

function AnimationFollower({ 
  moviles, 
  selectedMovil, 
  animationProgress, 
  isAnimating,
  startTime,
  endTime
}: AnimationFollowerProps) {
  const map = useMap();
  const lastFollowedPoint = useRef<[number, number] | null>(null);

  useEffect(() => {
    if (!isAnimating || !selectedMovil) {
      lastFollowedPoint.current = null;
      return;
    }

    const selectedMovilData = moviles.find(m => m.id === selectedMovil);
    if (!selectedMovilData?.history || selectedMovilData.history.length === 0) {
      return;
    }

    // Filtrar historial por rango de tiempo (misma lógica que en el componente principal)
    const filteredHistory = selectedMovilData.history.filter(coord => {
      if (!coord.fechaInsLog) return true;
      try {
        const coordDate = new Date(coord.fechaInsLog);
        const hours = coordDate.getHours();
        const minutes = coordDate.getMinutes();
        const timeStr = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
        return timeStr >= startTime && timeStr <= endTime;
      } catch {
        return true;
      }
    });

    if (filteredHistory.length === 0) return;

    // Calcular el índice del punto actual basado en el progreso
    const totalPoints = filteredHistory.length;
    const currentIndex = Math.min(
      Math.floor((animationProgress / 100) * totalPoints),
      totalPoints - 1
    );

    const currentPoint = filteredHistory[totalPoints - 1 - currentIndex]; // Orden inverso
    if (currentPoint) {
      const newCenter: [number, number] = [currentPoint.coordX, currentPoint.coordY];
      
      // Solo mover el mapa si el punto cambió significativamente
      if (!lastFollowedPoint.current || 
          Math.abs(lastFollowedPoint.current[0] - newCenter[0]) > 0.0001 ||
          Math.abs(lastFollowedPoint.current[1] - newCenter[1]) > 0.0001) {
        
        map.panTo(newCenter, {
          animate: true,
          duration: 0.5,
          noMoveStart: true
        });
        
        lastFollowedPoint.current = newCenter;
      }
    }
  }, [map, isAnimating, selectedMovil, animationProgress, moviles, startTime, endTime]);

  return null;
}

// Componente para capturar clics en el mapa
function MapClickHandler({ 
  isPlacingMarker, 
  onMapClick 
}: { 
  isPlacingMarker: boolean; 
  onMapClick: (lat: number, lng: number) => void;
}) {
  useMapEvents({
    click: (e) => {
      if (isPlacingMarker) {
        onMapClick(e.latlng.lat, e.latlng.lng);
      }
    },
  });
  return null;
}

export default function MapView({ 
  moviles, 
  focusedMovil, 
  selectedMovil, 
  popupMovil, 
  showPendientes, 
  showCompletados, 
  selectedMovilesCount = 0, 
  defaultMapLayer = 'streets', 
  onMovilClick, 
  onShowAnimation, 
  onCloseAnimation, 
  onShowPendientes, 
  onShowCompletados,
  pedidos = [],
  onPedidoClick,
  popupPedido
}: MapViewProps) {
  // Default center (Montevideo, Uruguay)
  const defaultCenter: [number, number] = [-34.9011, -56.1645];
  
  // Estado para controlar la animación del recorrido
  const [isAnimating, setIsAnimating] = useState(false);
  const [animationProgress, setAnimationProgress] = useState(0);
  const [animationSpeed, setAnimationSpeed] = useState(1); // 1x, 2x, 4x, etc.
  const [startTime, setStartTime] = useState('00:00');
  const [endTime, setEndTime] = useState('23:59');
  const [simplifiedPath, setSimplifiedPath] = useState(true); // Mostrar solo últimas 3 líneas
  const [selectedPedidoServicio, setSelectedPedidoServicio] = useState<PedidoServicio | null>(null);
  
  // ===== MARCADORES PERSONALIZADOS =====
  const [customMarkers, setCustomMarkers] = useState<CustomMarker[]>([]);
  const [isPlacingMarker, setIsPlacingMarker] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [tempMarkerPosition, setTempMarkerPosition] = useState<{ lat: number; lng: number } | null>(null);
  
  const animationRef = useRef<number | null>(null);
  const animationStartTime = useRef<number>(0); // Timestamp de inicio de animación
  const lastProgressUpdate = useRef<number>(0); // Último progreso guardado

  // Cargar marcadores personalizados desde localStorage
  useEffect(() => {
    const savedMarkers = localStorage.getItem('customMarkers');
    if (savedMarkers) {
      try {
        setCustomMarkers(JSON.parse(savedMarkers));
      } catch (error) {
        console.error('Error al cargar marcadores:', error);
      }
    }
  }, []);

  // Guardar marcadores en localStorage cuando cambien
  useEffect(() => {
    if (customMarkers.length > 0) {
      localStorage.setItem('customMarkers', JSON.stringify(customMarkers));
    }
  }, [customMarkers]);

  // Manejar guardado de nuevo marcador
  const handleSaveMarker = (data: { nombre: string; observacion: string; icono: string }) => {
    if (!tempMarkerPosition) return;

    const newMarker: CustomMarker = {
      id: `marker-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      nombre: data.nombre,
      observacion: data.observacion,
      icono: data.icono,
      latitud: tempMarkerPosition.lat,
      longitud: tempMarkerPosition.lng,
      fechaCreacion: new Date().toISOString(),
      visible: true,
    };

    setCustomMarkers(prev => [...prev, newMarker]);
    setTempMarkerPosition(null);
    setIsPlacingMarker(false);
  };

  // Eliminar marcador
  const handleDeleteMarker = (markerId: string) => {
    setCustomMarkers(prev => prev.filter(m => m.id !== markerId));
  };

  // Extraer pedidos/servicios completados del historial de coordenadas
  // Ahora los completados están en LOGCOORDMOVIL con ORIGEN='UPDPEDIDOS' o 'DYLPEDIDOS'
  const pedidosCompletados = useMemo(() => {
    console.log('🔄 pedidosCompletados useMemo ejecutándose...', { selectedMovil, movilesCount: moviles.length });
    
    if (!selectedMovil) {
      console.log('⚠️ No hay selectedMovil, retornando []');
      return [];
    }
    
    const movilData = moviles.find(m => m.id === selectedMovil);
    console.log(`🔍 Buscando móvil ${selectedMovil} en array de ${moviles.length} móviles`);
    console.log(`🔍 Móvil encontrado:`, movilData ? `✅ id=${movilData.id}, history=${movilData.history ? movilData.history.length + ' registros' : 'undefined'}` : '❌ NO ENCONTRADO');
    
    if (!movilData?.history) {
      console.log(`⚠️ Móvil ${selectedMovil} no tiene history, retornando []`);
      return [];
    }

    console.log(`🔍 Móvil ${selectedMovil} tiene ${movilData.history.length} registros en history`);
    
    // Debug: ver los primeros 5 registros para entender la estructura
    console.log(`🔍 Primeros 5 registros del history:`, movilData.history.slice(0, 5));
    
    // Debug: ver todos los ORIGEN únicos
    const origenesUnicos = [...new Set(movilData.history.map(coord => coord.origen?.trim()))];
    console.log(`🔍 ORIGEN únicos encontrados:`, origenesUnicos);

    // Debug: ver todos los registros con UPDPEDIDOS/DYLPEDIDOS
    const registrosOrigen = movilData.history.filter(coord => 
      coord.origen?.trim() === 'UPDPEDIDOS' || coord.origen?.trim() === 'DYLPEDIDOS'
    );
    console.log(`🔍 Found ${registrosOrigen.length} registros con ORIGEN UPDPEDIDOS/DYLPEDIDOS:`, registrosOrigen);

    // Filtrar coordenadas con origen UPDPEDIDOS o DYLPEDIDOS que tengan coordenadas válidas
    const completados = movilData.history
      .filter(coord => {
        const origen = coord.origen?.trim();
        const esOrigenCorrecto = origen === 'UPDPEDIDOS' || origen === 'DYLPEDIDOS';
        const tienePedidoId = coord.pedidoId && coord.pedidoId > 0;
        
        // Las coordenadas del cliente pueden venir como números o strings
        const clienteXNum = typeof coord.clienteX === 'string'
          ? parseFloat((coord.clienteX as string).trim())
          : typeof coord.clienteX === 'number'
            ? coord.clienteX
            : 0;
        const clienteYNum = typeof coord.clienteY === 'string'
          ? parseFloat((coord.clienteY as string).trim())
          : typeof coord.clienteY === 'number'
            ? coord.clienteY
            : 0;
        
        const tieneCoordenadasValidas = 
          clienteXNum && !isNaN(clienteXNum) && clienteXNum !== 0 &&
          clienteYNum && !isNaN(clienteYNum) && clienteYNum !== 0;

        if (esOrigenCorrecto && tienePedidoId && !tieneCoordenadasValidas) {
          console.log(`⚠️ Pedido ${coord.pedidoId} sin coordenadas válidas:`, { clienteX: coord.clienteX, clienteY: coord.clienteY });
        }

        return esOrigenCorrecto && tienePedidoId && tieneCoordenadasValidas;
      })
      .map(coord => {
        const clienteXNum = typeof coord.clienteX === 'string'
          ? parseFloat((coord.clienteX as string).trim())
          : coord.clienteX!;
        const clienteYNum = typeof coord.clienteY === 'string'
          ? parseFloat((coord.clienteY as string).trim())
          : coord.clienteY!;

        return {
          tipo: coord.obs?.trim() === 'Services' ? 'SERVICIO' as const : 'PEDIDO' as const,
          id: coord.pedidoId!,
          cliid: 0, // No disponible en este punto
          clinom: '', // Se obtendrá al hacer click
          fecha: coord.fechaInsLog,
          x: clienteXNum,
          y: clienteYNum,
          estado: 2, // Completado
          subestado: 0,
        } as PedidoServicio;
      });

    // Deduplicar por pedidoId - el mismo pedido puede tener UPDPEDIDOS y DYLPEDIDOS
    // Mantenemos el primero que encontramos (que es el más reciente por orden de la consulta)
    const deduplicados = completados.reduce((acc, curr) => {
      const existe = acc.find(item => item.id === curr.id);
      if (!existe) {
        acc.push(curr);
      }
      return acc;
    }, [] as PedidoServicio[]);

    console.log(`✅ Extracted ${completados.length} registros, deduplicados a ${deduplicados.length} pedidos/servicios únicos:`, deduplicados);
    return deduplicados;
  }, [moviles, selectedMovil]);

  // Extraer pedidos completados del móvil enfocado (para mostrar sin animación)
  const pedidosCompletadosFocused = useMemo(() => {
    if (!focusedMovil || !showCompletados) {
      return [];
    }
    
    const movilData = moviles.find(m => m.id === focusedMovil);
    if (!movilData?.history) {
      return [];
    }

    // Filtrar y extraer pedidos completados
    const completados = movilData.history
      .filter(coord => {
        const origen = coord.origen?.trim();
        const esOrigenCorrecto = origen === 'UPDPEDIDOS' || origen === 'DYLPEDIDOS';
        const tienePedidoId = coord.pedidoId && coord.pedidoId > 0;
        
        const clienteXNum = typeof coord.clienteX === 'string'
          ? parseFloat((coord.clienteX as string).trim())
          : typeof coord.clienteX === 'number'
            ? coord.clienteX
            : 0;
        const clienteYNum = typeof coord.clienteY === 'string'
          ? parseFloat((coord.clienteY as string).trim())
          : typeof coord.clienteY === 'number'
            ? coord.clienteY
            : 0;
        
        const tieneCoordenadasValidas = 
          clienteXNum && !isNaN(clienteXNum) && clienteXNum !== 0 &&
          clienteYNum && !isNaN(clienteYNum) && clienteYNum !== 0;

        return esOrigenCorrecto && tienePedidoId && tieneCoordenadasValidas;
      })
      .map(coord => {
        const clienteXNum = typeof coord.clienteX === 'string'
          ? parseFloat((coord.clienteX as string).trim())
          : coord.clienteX!;
        const clienteYNum = typeof coord.clienteY === 'string'
          ? parseFloat((coord.clienteY as string).trim())
          : coord.clienteY!;

        return {
          tipo: coord.obs?.trim() === 'Services' ? 'SERVICIO' as const : 'PEDIDO' as const,
          id: coord.pedidoId!,
          cliid: 0,
          clinom: '',
          fecha: coord.fechaInsLog,
          x: clienteXNum,
          y: clienteYNum,
          estado: 2,
          subestado: 0,
        } as PedidoServicio;
      });

    // Deduplicar por pedidoId
    const deduplicados = completados.reduce((acc, curr) => {
      const existe = acc.find(item => item.id === curr.id);
      if (!existe) {
        acc.push(curr);
      }
      return acc;
    }, [] as PedidoServicio[]);

    console.log(`✅ Completados para móvil ${focusedMovil}: ${deduplicados.length} pedidos/servicios`);
    return deduplicados;
  }, [moviles, focusedMovil, showCompletados]);

  // Móvil actual del popup
  const movilActual = popupMovil ? moviles.find(m => m.id === popupMovil) : null;
  
  // Móvil seleccionado para mostrar pendientes
  const movilConPendientes = (popupMovil || focusedMovil) ? moviles.find(m => m.id === (popupMovil || focusedMovil)) : null;
  
  // Móvil con completados para mostrar (cuando showCompletados está activo)
  const movilConCompletados = focusedMovil ? moviles.find(m => m.id === focusedMovil) : null;
  
  // Los móviles ya vienen filtrados desde page.tsx según la selección múltiple
  // No necesitamos filtrar aquí nuevamente
  const movilesToShow = moviles;

  const createCustomIcon = (color: string, movilId?: number, isInactive?: boolean) => {
    // Si el móvil está inactivo, mostramos un ícono de alarma parpadeante
    if (isInactive) {
      return L.divIcon({
        className: '', // Sin className para evitar conflictos CSS
        html: `
          <div style="
            width: 46px;
            height: 46px;
            position: absolute;
            left: -23px;
            top: -23px;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
          ">
            <!-- Círculo principal con ícono de alarma -->
            <div style="
              width: 40px;
              height: 40px;
              background: linear-gradient(135deg, #EF4444 0%, #DC2626 100%);
              border: 3px solid white;
              border-radius: 50%;
              box-shadow: 0 4px 8px rgba(0,0,0,0.3), 0 0 0 0 rgba(239, 68, 68, 0.7);
              display: flex;
              align-items: center;
              justify-content: center;
              animation: alarm-pulse 1.5s infinite, alarm-ring 0.3s infinite;
            ">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="white" style="filter: drop-shadow(0 1px 2px rgba(0,0,0,0.3));">
                <path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.89 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z"/>
              </svg>
            </div>
            <!-- Badge con número del móvil -->
            ${movilId ? `
            <div style="
              position: absolute;
              bottom: -6px;
              background-color: white;
              color: #DC2626;
              border: 2px solid #EF4444;
              border-radius: 10px;
              padding: 2px 6px;
              font-size: 11px;
              font-weight: bold;
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
              box-shadow: 0 2px 4px rgba(0,0,0,0.2);
              white-space: nowrap;
              line-height: 1;
              animation: badge-pulse 1.5s infinite;
            ">${movilId}</div>
            ` : ''}
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
            @keyframes badge-pulse {
              0%, 100% { opacity: 1; }
              50% { opacity: 0.7; }
            }
          </style>
        `,
        iconSize: [46, 46],
        iconAnchor: [23, 23],
      });
    }

    // Ícono normal para móviles activos
    return L.divIcon({
      className: '', // Sin className para evitar conflictos CSS
      html: `
        <div style="
          width: 46px;
          height: 46px;
          position: absolute;
          left: -23px;
          top: -23px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
        ">
          <!-- Círculo principal con ícono del auto -->
          <div style="
            width: 40px;
            height: 40px;
            background-color: ${color};
            border: 3px solid white;
            border-radius: 50%;
            box-shadow: 0 4px 8px rgba(0,0,0,0.3);
            display: flex;
            align-items: center;
            justify-content: center;
            animation: pulse 2s infinite;
          ">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
              <path d="M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z"/>
            </svg>
          </div>
          <!-- Badge con número del móvil -->
          ${movilId ? `
          <div style="
            position: absolute;
            bottom: -6px;
            background-color: white;
            color: ${color};
            border: 2px solid ${color};
            border-radius: 10px;
            padding: 2px 6px;
            font-size: 11px;
            font-weight: bold;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            box-shadow: 0 2px 4px rgba(0,0,0,0.2);
            white-space: nowrap;
            line-height: 1;
          ">${movilId}</div>
          ` : ''}
        </div>
        <style>
          @keyframes pulse {
            0%, 100% { transform: scale(1); }
            50% { transform: scale(1.05); }
          }
        </style>
      `,
      iconSize: [46, 46],
      iconAnchor: [23, 23],
    });
  };

  // Iconos para pedidos (naranja) - MÁS GRANDE Y DISTINTIVO - LEGACY para animación
  const createPedidoIcon = () => {
    return L.divIcon({
      className: '',
      html: `
        <div style="
          width: 32px;
          height: 32px;
          position: absolute;
          left: -16px;
          top: -16px;
          background: linear-gradient(135deg, #f97316 0%, #fb923c 100%);
          border: 3px solid white;
          border-radius: 8px;
          box-shadow: 0 4px 8px rgba(0,0,0,0.4), 0 0 0 2px rgba(249, 115, 22, 0.3);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 18px;
          cursor: pointer;
          transition: transform 0.2s;
        " 
        onmouseover="this.style.transform='scale(1.15)'"
        onmouseout="this.style.transform='scale(1)'">📦</div>
      `,
      iconSize: [32, 32],
      iconAnchor: [16, 16],
    });
  };

  // Iconos para pedidos desde tabla - por estado
  const createPedidoIconByEstado = (estadoNro: number | null) => {
    // Colores según estado (mismo esquema que PedidoInfoPopup)
    let color = '#EF4444'; // Rojo por defecto
    let lightColor = '#FCA5A5';
    let shadowColor = 'rgba(239, 68, 68, 0.3)';
    
    if (estadoNro !== null && estadoNro <= 2) {
      // Asignado - Azul
      color = '#3B82F6';
      lightColor = '#93C5FD';
      shadowColor = 'rgba(59, 130, 246, 0.3)';
    } else if (estadoNro !== null && estadoNro >= 3 && estadoNro <= 5) {
      // En proceso - Amarillo
      color = '#EAB308';
      lightColor = '#FDE047';
      shadowColor = 'rgba(234, 179, 8, 0.3)';
    } else if (estadoNro === 7) {
      // Completado - Verde
      color = '#22C55E';
      lightColor = '#86EFAC';
      shadowColor = 'rgba(34, 197, 94, 0.3)';
    }

    return L.divIcon({
      className: '',
      html: `
        <div style="
          width: 32px;
          height: 32px;
          position: absolute;
          left: -16px;
          top: -16px;
          background: linear-gradient(135deg, ${color} 0%, ${lightColor} 100%);
          border: 3px solid white;
          border-radius: 8px;
          box-shadow: 0 4px 8px rgba(0,0,0,0.4), 0 0 0 2px ${shadowColor};
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 18px;
          cursor: pointer;
          transition: transform 0.2s;
        " 
        onmouseover="this.style.transform='scale(1.15)'"
        onmouseout="this.style.transform='scale(1)'">📦</div>
      `,
      iconSize: [32, 32],
      iconAnchor: [16, 16],
    });
  };

  // Iconos para servicios (rojo) - MÁS GRANDE Y DISTINTIVO
  const createServicioIcon = () => {
    return L.divIcon({
      className: '',
      html: `
        <div style="
          width: 32px;
          height: 32px;
          position: absolute;
          left: -16px;
          top: -16px;
          background: linear-gradient(135deg, #ef4444 0%, #f87171 100%);
          border: 3px solid white;
          border-radius: 8px;
          box-shadow: 0 4px 8px rgba(0,0,0,0.4), 0 0 0 2px rgba(239, 68, 68, 0.3);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 18px;
          cursor: pointer;
          transition: transform 0.2s;
        "
        onmouseover="this.style.transform='scale(1.15)'"
        onmouseout="this.style.transform='scale(1)'">🔧</div>
      `,
      iconSize: [32, 32],
      iconAnchor: [16, 16],
    });
  };

  // Iconos para pedidos/servicios COMPLETADOS (verde) - Para mostrar durante animación
  const createCompletadoIcon = (tipo: 'PEDIDO' | 'SERVICIO') => {
    const emoji = tipo === 'PEDIDO' ? '✅' : '✔️';
    return L.divIcon({
      className: '',
      html: `
        <div style="
          width: 28px;
          height: 28px;
          position: absolute;
          left: -14px;
          top: -14px;
          background: linear-gradient(135deg, #10b981 0%, #34d399 100%);
          border: 3px solid white;
          border-radius: 50%;
          box-shadow: 0 3px 6px rgba(0,0,0,0.3), 0 0 0 2px rgba(16, 185, 129, 0.3);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 14px;
          cursor: pointer;
          transition: transform 0.2s;
        "
        onmouseover="this.style.transform='scale(1.15)'"
        onmouseout="this.style.transform='scale(1)'">
          ${emoji}
        </div>
      `,
      iconSize: [28, 28],
      iconAnchor: [14, 14],
    });
  };

  // Funciones de control de animación
  const handlePlayPause = () => {
    setIsAnimating(!isAnimating);
  };

  const handleReset = () => {
    setIsAnimating(false);
    setAnimationProgress(0);
    lastProgressUpdate.current = 0;
    animationStartTime.current = 0;
  };

  const handleSpeedChange = (speed: number) => {
    setAnimationSpeed(speed);
  };

  const handleTimeRangeChange = (newStartTime: string, newEndTime: string) => {
    setStartTime(newStartTime);
    setEndTime(newEndTime);
    // Resetear animación cuando cambia el rango
    setIsAnimating(false);
    setAnimationProgress(0);
    lastProgressUpdate.current = 0;
    animationStartTime.current = 0;
  };

  // Función para filtrar historial por rango de tiempo
  const filterHistoryByTime = (history: any[]) => {
    if (!history || history.length === 0) return history;
    
    return history.filter(coord => {
      if (!coord.fechaInsLog) return true; // Incluir si no tiene fecha
      
      try {
        const coordDate = new Date(coord.fechaInsLog);
        const hours = coordDate.getHours();
        const minutes = coordDate.getMinutes();
        const timeStr = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
        
        return timeStr >= startTime && timeStr <= endTime;
      } catch {
        return true; // Incluir si hay error parseando fecha
      }
    });
  };

  // Efecto de animación
  useEffect(() => {
    if (!isAnimating) {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
      return;
    }

    const selectedMovilData = moviles.find(m => m.id === selectedMovil);
    if (!selectedMovilData?.history || selectedMovilData.history.length === 0) {
      return;
    }

    // Filtrar historial por rango de tiempo
    const filteredHistory = filterHistoryByTime(selectedMovilData.history);
    if (filteredHistory.length === 0) {
      return;
    }

    const totalPoints = filteredHistory.length;
    const baseDuration = 10000; // 10 segundos en velocidad 1x
    const duration = baseDuration / animationSpeed;

    // Si ya hay una animación en curso, continuar desde donde estaba
    if (animationRef.current) {
      // Ya está animando, no reiniciar
      return;
    }

    // Iniciar nueva animación o reanudar
    const currentProgress = lastProgressUpdate.current;
    animationStartTime.current = Date.now() - (currentProgress / 100 * duration);

    const animate = () => {
      const elapsed = Date.now() - animationStartTime.current;
      const progress = Math.min((elapsed / duration) * 100, 100);

      setAnimationProgress(progress);
      lastProgressUpdate.current = progress;

      if (progress < 100) {
        animationRef.current = requestAnimationFrame(animate);
      } else {
        setIsAnimating(false);
        setAnimationProgress(100);
        lastProgressUpdate.current = 100;
      }
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
    };
  }, [isAnimating, animationSpeed, moviles, selectedMovil, startTime, endTime]);

  // Resetear animación cuando cambia el móvil seleccionado
  useEffect(() => {
    setIsAnimating(false);
    setAnimationProgress(0);
    lastProgressUpdate.current = 0;
    animationStartTime.current = 0;
  }, [selectedMovil]);

  return (
    <div className="h-full w-full rounded-xl overflow-hidden shadow-2xl relative">
      <MapContainer
        center={defaultCenter}
        zoom={13}
        className="h-full w-full"
        zoomControl={true}
      >
        {/* Control de capas base (calles, satélite, terreno, etc.) */}
        <LayersControl defaultLayer={defaultMapLayer} />
        
        {selectedMovil ? (
          // Mostrar SOLO el móvil seleccionado con su recorrido
          <>
            {moviles
              .filter(m => m.id === selectedMovil && m.currentPosition)
              .map((movil) => {
                // Filtrar historial por rango de tiempo
                const filteredHistory = movil.history ? filterHistoryByTime(movil.history) : [];
                
                // Dibujar la línea del recorrido si tiene historial
                const fullPathCoordinates = filteredHistory.map(coord => [coord.coordX, coord.coordY] as [number, number]);

                // Calcular cuántos puntos mostrar según el progreso de la animación
                const totalPoints = fullPathCoordinates.length;
                const visiblePointsCount = Math.max(
                  1,
                  Math.ceil((animationProgress / 100) * totalPoints)
                );
                
                // Coordenadas visibles durante la animación (desde el final hacia el principio, orden invertido)
                const pathCoordinates = isAnimating || animationProgress > 0
                  ? fullPathCoordinates.slice(Math.max(0, totalPoints - visiblePointsCount))
                  : fullPathCoordinates;

                // Punto animado actual (el más reciente de los visibles)
                const animatedPointIndex = isAnimating || animationProgress > 0
                  ? totalPoints - visiblePointsCount
                  : 0;

                return (
                  <div key={movil.id}>
                    {/* Línea del recorrido - SIMPLIFICADA O COMPLETA según switch */}
                    {pathCoordinates.length > 1 && (
                      <>
                        {simplifiedPath ? (
                          /* MODO SIMPLIFICADO: Solo últimas 3 líneas desde el punto actual hacia atrás */
                          <>
                            {pathCoordinates.map((coord, index) => {
                              if (index === pathCoordinates.length - 1) return null;
                              
                              const nextCoord = pathCoordinates[index + 1];
                              const totalLines = pathCoordinates.length - 1;
                              
                              // Mostrar solo las últimas 3 líneas (desde el punto actual hacia atrás)
                              // index >= totalLines - 3 significa las últimas 3 líneas
                              if (index < totalLines - 3) return null;
                              
                              return (
                                <React.Fragment key={`simplified-${index}`}>
                                  {/* Sombra */}
                                  <Polyline
                                    positions={[coord, nextCoord]}
                                    pathOptions={{
                                      color: '#333',
                                      weight: 6,
                                      opacity: 0.2,
                                      lineCap: 'round',
                                      lineJoin: 'round',
                                    }}
                                  />
                                  {/* Línea principal */}
                                  <Polyline
                                    positions={[coord, nextCoord]}
                                    pathOptions={{
                                      color: movil.color,
                                      weight: 4,
                                      opacity: 0.9,
                                      dashArray: '10, 8',
                                      lineCap: 'round',
                                      lineJoin: 'round',
                                    }}
                                  />
                                </React.Fragment>
                              );
                            })}
                          </>
                        ) : (
                          /* MODO COMPLETO: Todas las líneas con difuminado progresivo */
                          <>
                            {/* Línea base (sombra) muy sutil */}
                            <Polyline
                              positions={pathCoordinates}
                              pathOptions={{
                                color: '#333',
                                weight: 6,
                                opacity: 0.1,
                                lineCap: 'round',
                                lineJoin: 'round',
                              }}
                            />
                            {/* Segmentos individuales con difuminado progresivo */}
                            {pathCoordinates.map((coord, index) => {
                              if (index === pathCoordinates.length - 1) return null;
                              
                              const nextCoord = pathCoordinates[index + 1];
                              const totalLines = pathCoordinates.length - 1;
                              
                              // Las últimas 3 líneas (desde el punto actual hacia atrás) son nítidas
                              const distanceFromEnd = totalLines - index;
                              const isRecent = distanceFromEnd <= 3;
                              
                              // Opacidad: últimas 3 = 0.9, anteriores casi transparentes (0.05-0.15)
                              const opacity = isRecent 
                                ? 0.9 
                                : Math.max(0.05, 0.15 * (index / (totalLines - 3)));
                              
                              const weight = isRecent ? 4 : 2;
                              const dashArray = isRecent ? '10, 8' : undefined;
                              
                              return (
                                <Polyline
                                  key={`segment-${index}`}
                                  positions={[coord, nextCoord]}
                                  pathOptions={{
                                    color: movil.color,
                                    weight: weight,
                                    opacity: opacity,
                                    dashArray: dashArray,
                                    lineCap: 'round',
                                    lineJoin: 'round',
                                  }}
                                />
                              );
                            })}
                          </>
                        )}
                      </>
                    )}
                    
                    {/* Marcadores en cada punto del historial con numeración y estilos mejorados */}
                    {filteredHistory.map((coord, index) => {
                      // Durante la animación, solo mostrar puntos ya "recorridos"
                      if ((isAnimating || animationProgress > 0) && index < animatedPointIndex) {
                        return null; // No mostrar este punto aún
                      }

                      const isFirst = index === 0; // Más reciente
                      const isLast = index === filteredHistory.length - 1; // Inicio del día
                      const totalPoints = filteredHistory.length;
                      
                      // Durante la animación, el punto actual es especial
                      const isAnimatedCurrent = (isAnimating || animationProgress > 0) && index === animatedPointIndex;
                      
                      // Tamaño progresivo
                      const size = isFirst ? 16 : isLast ? 14 : isAnimatedCurrent ? 14 : 8;
                      
                      // Opacidad que decrece con antigüedad
                      const opacity = isAnimatedCurrent ? 1 : 0.5 + (0.5 * (totalPoints - index) / totalPoints);
                      
                      // Mostrar etiqueta cada 5 puntos o en puntos clave
                      const showLabel = isFirst || isLast || isAnimatedCurrent || index % 5 === 0;
                      const pointNumber = totalPoints - index; // Contar desde el inicio del día
                      
                      return (
                        <Marker
                          key={`${movil.id}-${index}`}
                          position={[coord.coordX, coord.coordY]}
                          icon={L.divIcon({
                            className: '',
                            html: `
                              <div style="position: relative;">
                                <!-- Círculo principal -->
                                <div style="
                                  width: ${size}px;
                                  height: ${size}px;
                                  background-color: ${movil.color};
                                  border: 2px solid ${isFirst ? '#fff' : isLast ? '#ffd700' : isAnimatedCurrent ? '#ff6b6b' : 'rgba(255,255,255,0.9)'};
                                  border-radius: 50%;
                                  box-shadow: 0 2px 6px rgba(0,0,0,${opacity * 0.5});
                                  position: absolute;
                                  left: -${size/2}px;
                                  top: -${size/2}px;
                                  opacity: ${opacity};
                                  ${isFirst || isAnimatedCurrent ? `
                                    animation: pulse-marker 2s ease-in-out infinite;
                                  ` : ''}
                                "></div>
                                
                                ${isAnimatedCurrent ? `
                                  <!-- Anillo de animación para el punto actual -->
                                  <div style="
                                    position: absolute;
                                    left: -${size}px;
                                    top: -${size}px;
                                    width: ${size * 2}px;
                                    height: ${size * 2}px;
                                    border: 3px solid ${movil.color};
                                    border-radius: 50%;
                                    animation: ripple 1.5s ease-out infinite;
                                  "></div>
                                ` : ''}
                                
                                ${showLabel ? `
                                  <!-- Etiqueta con número/texto -->
                                  <div style="
                                    position: absolute;
                                    top: ${size + 4}px;
                                    left: 50%;
                                    transform: translateX(-50%);
                                    background: ${isAnimatedCurrent ? '#ff6b6b' : isFirst ? '#22c55e' : isLast ? '#eab308' : 'white'};
                                    color: ${isAnimatedCurrent || isFirst || isLast ? 'white' : movil.color};
                                    border: 1px solid ${movil.color};
                                    border-radius: 6px;
                                    padding: 2px 6px;
                                    font-size: 9px;
                                    font-weight: bold;
                                    white-space: nowrap;
                                    box-shadow: 0 2px 4px rgba(0,0,0,0.2);
                                    pointer-events: none;
                                    font-family: system-ui, -apple-system, sans-serif;
                                  ">${isAnimatedCurrent ? '🚗 EN RUTA' : isFirst ? '🎯 ACTUAL' : isLast ? '🏁 INICIO' : `#${pointNumber}`}</div>
                                ` : ''}
                                
                                <style>
                                  @keyframes pulse-marker {
                                    0%, 100% { transform: scale(1); opacity: ${opacity}; }
                                    50% { transform: scale(1.3); opacity: 1; }
                                  }
                                  @keyframes ripple {
                                    0% { 
                                      transform: scale(0.8);
                                      opacity: 1;
                                    }
                                    100% { 
                                      transform: scale(1.5);
                                      opacity: 0;
                                    }
                                  }
                                </style>
                              </div>
                            `,
                            iconSize: [size, size],
                            iconAnchor: [size/2, size/2],
                          })}
                        >
                          <Popup>
                            <div className="p-2 min-w-[200px]">
                              <h3 className="font-bold text-sm mb-1" style={{ color: movil.color }}>
                                {movil.name}
                                <span className={`ml-2 text-xs px-2 py-0.5 rounded ${
                                  isFirst ? 'bg-green-500 text-white' : 
                                  isLast ? 'bg-yellow-500 text-white' : 
                                  'bg-gray-200 text-gray-700'
                                }`}>
                                  {isFirst ? '🎯 Posición Actual' : isLast ? '🏁 Inicio del Día' : `Punto #${pointNumber}`}
                                </span>
                              </h3>
                              <div className="text-xs space-y-1 text-gray-700">
                                <p>
                                  <strong>� Hora:</strong> {new Date(coord.fechaInsLog).toLocaleTimeString('es-UY', { hour: '2-digit', minute: '2-digit' })}
                                </p>
                                <p>
                                  <strong>📅 Fecha:</strong> {new Date(coord.fechaInsLog).toLocaleDateString('es-UY')}
                                </p>
                                <p>
                                  <strong>🔄 Estado:</strong> {coord.auxIn2}
                                </p>
                                <p>
                                  <strong>📍 Distancia:</strong> {coord.distRecorrida.toFixed(2)} km
                                </p>
                                <p className="text-xs text-gray-500 mt-2 pt-1 border-t border-gray-200">
                                  Punto {pointNumber} de {totalPoints} registros (cada ~3 min)
                                </p>
                              </div>
                            </div>
                          </Popup>
                        </Marker>
                      );
                    })}
                    
                    {/* Marcador principal (posición actual) */}
                    <Marker
                      position={[movil.currentPosition!.coordX, movil.currentPosition!.coordY]}
                      icon={createCustomIcon(movil.color, movil.id, movil.isInactive)}
                    >
                      <Popup>
                        <div className="p-2">
                          <h3 className="font-bold text-lg" style={{ color: movil.color }}>
                            {movil.name}
                          </h3>
                          <p className="text-sm text-gray-600">
                            <strong>Estado:</strong> {movil.currentPosition!.auxIn2}
                          </p>
                          <p className="text-sm text-gray-600">
                            <strong>Origen:</strong> {movil.currentPosition!.origen}
                          </p>
                          <p className="text-sm text-gray-600">
                            <strong>Distancia:</strong> {movil.currentPosition!.distRecorrida.toFixed(2)} km
                          </p>
                          <p className="text-xs text-gray-400 mt-1">
                            {new Date(movil.currentPosition!.fechaInsLog).toLocaleString('es-UY')}
                          </p>
                          {movil.history && (
                            <p className="text-xs text-blue-600 mt-2 font-semibold">
                              📍 {movil.history.length} coordenadas en el recorrido
                            </p>
                          )}
                        </div>
                      </Popup>
                    </Marker>
                  </div>
                );
              })}

            {/* Marcadores de Pedidos y Servicios Pendientes para móvil seleccionado */}
            {moviles
              .filter(m => m.id === selectedMovil && m.pendientes && m.pendientes.length > 0)
              .map((movil) => (
                movil.pendientes!.map((item) => {
                  // Validar que tenga coordenadas válidas
                  if (!item.x || !item.y) return null;

                  return (
                    <Marker
                      key={`${item.tipo}-${item.id}`}
                      position={[item.x, item.y]}
                      icon={item.tipo === 'PEDIDO' ? createPedidoIcon() : createServicioIcon()}
                      eventHandlers={{
                        click: () => {
                          // Cerrar popup del móvil si está abierto
                          if (onMovilClick) {
                            onMovilClick(undefined);
                          }
                          // Abrir popup del pedido/servicio
                          setSelectedPedidoServicio(item);
                        },
                      }}
                    />
                  );
                })
              ))}

            {/* Marcadores de Pedidos/Servicios durante animación */}
            {/* Mostrar pedidos que ya han sido "visitados" en la animación */}
            {/* DYLPEDIDOS = naranja (en ruta), UPDPEDIDOS = verde (completado) */}
            {pedidosCompletados
              .map((item) => {
                // Validar que tenga coordenadas válidas
                if (!item.x || !item.y) return null;
                
                // Obtener el móvil seleccionado
                const movilData = moviles.find(m => m.id === selectedMovil);
                if (!movilData || !movilData.history || movilData.history.length === 0) {
                  return null;
                }
                
                // Filtrar historial por rango de tiempo (igual que la animación)
                const filteredHistory = filterHistoryByTime(movilData.history);
                if (filteredHistory.length === 0) return null;
                
                // Calcular hasta qué índice del historial ha llegado la animación
                const totalPoints = filteredHistory.length;
                const currentIndex = Math.floor((animationProgress / 100) * (totalPoints - 1));
                
                // Determinar el estado del pedido según los puntos ya recorridos
                let estado: 'oculto' | 'en-ruta' | 'completado' = 'oculto';
                
                // Si la animación no ha empezado (0%), ocultar
                if (animationProgress === 0) {
                  return null;
                }
                
                // Si la animación terminó (100%), mostrar todos como completados
                if (animationProgress === 100) {
                  estado = 'completado';
                } else {
                  // Buscar en el historial ya recorrido qué registros tiene este pedido
                  let tieneDYLPEDIDOS = false;
                  let tieneUPDPEDIDOS = false;
                  
                  for (let i = totalPoints - 1; i >= totalPoints - 1 - currentIndex; i--) {
                    const coord = filteredHistory[i];
                    if (coord.pedidoId === item.id) {
                      if (coord.origen?.trim() === 'DYLPEDIDOS') {
                        tieneDYLPEDIDOS = true;
                      }
                      if (coord.origen?.trim() === 'UPDPEDIDOS') {
                        tieneUPDPEDIDOS = true;
                      }
                    }
                  }
                  
                  // Determinar estado basado en lo que se encontró
                  if (tieneUPDPEDIDOS) {
                    estado = 'completado'; // Verde - ya fue completado
                  } else if (tieneDYLPEDIDOS) {
                    estado = 'en-ruta'; // Naranja - asignado pero aún no completado
                  } else {
                    return null; // No se ha llegado a este pedido aún
                  }
                }
                
                // Determinar el ícono según el estado
                let icon;
                if (estado === 'completado') {
                  icon = createCompletadoIcon(item.tipo); // Verde ✅
                } else if (estado === 'en-ruta') {
                  icon = item.tipo === 'PEDIDO' ? createPedidoIcon() : createServicioIcon(); // Naranja 📦 o rojo 🔧
                } else {
                  return null;
                }
                
                return (
                  <Marker
                    key={`completado-${item.tipo}-${item.id}-${estado}`}
                    position={[item.x, item.y]}
                    icon={icon}
                    eventHandlers={{
                      click: () => {
                        // Cerrar popup del móvil si está abierto
                        if (onMovilClick) {
                          onMovilClick(undefined);
                        }
                        // Abrir popup del pedido/servicio
                        setSelectedPedidoServicio(item);
                      },
                    }}
                  />
                );
              })
              .filter(marker => marker !== null)}
          </>
        ) : (
          // Mostrar móviles (todos o solo el enfocado)
          <>
            {movilesToShow.map((movil) => {
              if (!movil.currentPosition) return null;
              
              return (
                <Marker
                  key={movil.id}
                  position={[movil.currentPosition.coordX, movil.currentPosition.coordY]}
                  icon={createCustomIcon(movil.color, movil.id, movil.isInactive)}
                  eventHandlers={{
                    click: () => {
                      // Cerrar popup de pedido/servicio si está abierto
                      setSelectedPedidoServicio(null);
                      // Abrir popup del móvil
                      if (onMovilClick) {
                        onMovilClick(movil.id);
                      }
                    },
                  }}
                />
              );
            })}
          </>
        )}
        
        {/* Marcadores de pedidos/servicios pendientes - solo si showPendientes está activo */}
        {showPendientes && moviles && (
          <>
            {moviles.flatMap(movil => 
              (movil.pendientes || []).map((item) => {
                if (!item.x || !item.y) return null;

                return (
                  <Marker
                    key={`${item.tipo}-${item.id}-${movil.id}`}
                    position={[item.x, item.y]}
                    icon={item.tipo === 'PEDIDO' ? createPedidoIcon() : createServicioIcon()}
                    eventHandlers={{
                      click: () => {
                        // Abrir popup del pedido/servicio
                        setSelectedPedidoServicio(item);
                      },
                    }}
                  />
                );
              })
            ).filter(Boolean)}
          </>
        )}

        {/* Marcadores de pedidos/servicios completados - solo si showCompletados está activo */}
        {showCompletados && pedidosCompletadosFocused.length > 0 && (
          <>
            {pedidosCompletadosFocused.map((item) => {
              if (!item.x || !item.y) return null;

              return (
                <Marker
                  key={`completado-${item.tipo}-${item.id}`}
                  position={[item.x, item.y]}
                  icon={createCompletadoIcon(item.tipo)}
                  eventHandlers={{
                    click: () => {
                      // Abrir popup del pedido/servicio
                      setSelectedPedidoServicio(item);
                    },
                  }}
                />
              );
            })}
          </>
        )}
        
        {/* Marcadores de Pedidos desde tabla - con coordenadas */}
        {pedidos && pedidos.filter(p => p.latitud && p.longitud).map(pedido => (
          <Marker
            key={`pedido-tabla-${pedido.id}`}
            position={[pedido.latitud!, pedido.longitud!]}
            icon={createPedidoIconByEstado(pedido.estado_nro)}
            eventHandlers={{
              click: () => {
                onPedidoClick && onPedidoClick(pedido.id);
              }
            }}
          >
            <Tooltip direction="top" offset={[0, -10]} opacity={0.9}>
              <div className="text-xs">
                <div className="font-bold">Pedido #{pedido.id}</div>
                <div>{pedido.cliente_nombre}</div>
                <div className="text-gray-600">{pedido.producto_nom}</div>
              </div>
            </Tooltip>
          </Marker>
        ))}
        
        <MapUpdater 
          moviles={moviles} 
          focusedMovil={focusedMovil} 
          selectedMovil={selectedMovil}
          selectedMovilesCount={selectedMovilesCount}
        />
        <AnimationFollower 
          moviles={moviles}
          selectedMovil={selectedMovil}
          animationProgress={animationProgress}
          isAnimating={isAnimating}
          startTime={startTime}
          endTime={endTime}
        />

        {/* Handler para capturar clics en el mapa */}
        <MapClickHandler
          isPlacingMarker={isPlacingMarker}
          onMapClick={(lat, lng) => {
            setTempMarkerPosition({ lat, lng });
            setIsModalOpen(true);
          }}
        />

        {/* Renderizar marcadores personalizados */}
        {customMarkers.filter(m => m.visible).map((marker) => {
          // Crear icono personalizado con emoji
          const customIcon = L.divIcon({
            html: `
              <div style="
                font-size: 32px;
                text-align: center;
                line-height: 1;
                filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));
              ">
                ${marker.icono}
              </div>
            `,
            className: 'custom-marker-icon',
            iconSize: [32, 32],
            iconAnchor: [16, 32],
            popupAnchor: [0, -32],
          });

          return (
            <Marker
              key={marker.id}
              position={[marker.latitud, marker.longitud]}
              icon={customIcon}
            >
              <Popup>
                <div className="p-2 min-w-[200px]">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-lg font-bold flex items-center gap-2">
                      <span className="text-2xl">{marker.icono}</span>
                      {marker.nombre}
                    </h3>
                    <button
                      onClick={() => handleDeleteMarker(marker.id)}
                      className="text-red-500 hover:text-red-700 p-1"
                      title="Eliminar marcador"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                  {marker.observacion && (
                    <p className="text-sm text-gray-600 mb-2">{marker.observacion}</p>
                  )}
                  <div className="text-xs text-gray-400 border-t pt-2">
                    <p>📍 {marker.latitud.toFixed(6)}, {marker.longitud.toFixed(6)}</p>
                    <p>📅 {new Date(marker.fechaCreacion).toLocaleDateString()}</p>
                  </div>
                </div>
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>
      
      {/* Control de animación (solo visible cuando hay un móvil seleccionado con historial) */}
      {selectedMovil && moviles.find(m => m.id === selectedMovil)?.history && (
        <RouteAnimationControl
          isPlaying={isAnimating}
          progress={animationProgress}
          speed={animationSpeed}
          onPlayPause={handlePlayPause}
          onReset={handleReset}
          onSpeedChange={handleSpeedChange}
          onClose={onCloseAnimation}
          startTime={startTime}
          endTime={endTime}
          onTimeRangeChange={handleTimeRangeChange}
          simplifiedPath={simplifiedPath}
          onSimplifiedPathChange={setSimplifiedPath}
        />
      )}

      {/* Popup de información del móvil */}
      {popupMovil && movilActual && movilActual.currentPosition && (
        <MovilInfoPopup 
          movil={movilActual} 
          selectedMovilesCount={selectedMovilesCount}
          onClose={() => {
            if (onMovilClick) {
              onMovilClick(undefined);
            }
          }}
          onShowAnimation={() => {
            // Cerrar popup y activar la animación
            if (popupMovil && onShowAnimation) {
              onShowAnimation(popupMovil);
            }
          }}
          onShowPendientes={() => {
            // Activar vista de pendientes
            if (onShowPendientes) {
              onShowPendientes();
            }
          }}
        />
      )}

      {/* Popup de información del pedido */}
      {popupPedido && (
        <PedidoInfoPopup 
          pedido={pedidos.find(p => p.id === popupPedido) || null}
          onClose={() => {
            if (onPedidoClick) {
              onPedidoClick(undefined);
            }
          }}
        />
      )}

      {/* Popup de Pedido/Servicio */}
      <PedidoServicioPopup 
        item={selectedPedidoServicio} 
        onClose={() => setSelectedPedidoServicio(null)} 
      />

      {/* Botón para agregar marcadores personalizados */}
      <button
        onClick={() => {
          setIsPlacingMarker(!isPlacingMarker);
          if (isPlacingMarker) {
            setTempMarkerPosition(null);
          }
        }}
        className={`
          absolute bottom-32 right-4 z-[1000]
          flex items-center gap-2 px-4 py-3 rounded-lg shadow-xl
          font-medium transition-all duration-300 transform hover:scale-105
          ${isPlacingMarker
            ? 'bg-gradient-to-r from-red-500 to-red-600 text-white animate-pulse'
            : 'bg-gradient-to-r from-blue-500 to-blue-600 text-white hover:from-blue-600 hover:to-blue-700'
          }
        `}
        title={isPlacingMarker ? 'Haz clic en el mapa para colocar el marcador' : 'Agregar marcador personalizado'}
      >
        <span className="text-xl">
          {isPlacingMarker ? '📍' : '➕'}
        </span>
        <span className="text-sm font-bold">
          {isPlacingMarker ? 'Colocar Marcador' : 'Nuevo Marcador'}
        </span>
      </button>

      {/* Contador de marcadores */}
      {customMarkers.length > 0 && (
        <div className="absolute bottom-24 right-4 z-[999] bg-white/90 backdrop-blur-sm px-3 py-1.5 rounded-full shadow-lg">
          <span className="text-xs font-medium text-gray-700">
            📍 {customMarkers.length} {customMarkers.length === 1 ? 'marcador' : 'marcadores'}
          </span>
        </div>
      )}

      {/* Modal para configurar el marcador */}
      <CustomMarkerModal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setTempMarkerPosition(null);
          setIsPlacingMarker(false);
        }}
        onSave={handleSaveMarker}
      />
    </div>
  );
}
