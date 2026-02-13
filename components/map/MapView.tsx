'use client';

import React, { useEffect, useRef, useState, useMemo, useCallback, memo } from 'react';
import { MapContainer, Popup, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { MovilData, PedidoServicio, PedidoSupabase, ServiceSupabase, CustomMarker } from '@/types';
import { computeDelayMinutes, getDelayInfo } from '@/utils/pedidoDelay';
import RouteAnimationControl from './RouteAnimationControl';
import { MovilInfoPopup } from './MovilInfoPopup';
import { PedidoInfoPopup } from './PedidoInfoPopup';
import { ServiceInfoPopup } from './ServiceInfoPopup';
import PedidoServicioPopup from './PedidoServicioPopup';
import LayersControl from './LayersControl';
import CustomMarkerModal from './CustomMarkerModal';
import { OptimizedMarker, OptimizedPolyline, optimizePath, getCachedIcon } from './MapOptimizations';
import { registerTileCacheServiceWorker } from './TileCacheConfig';
import dynamic from 'next/dynamic';
import toast from 'react-hot-toast';
import 'leaflet/dist/leaflet.css';
import './MarkerCluster.css';
import './MapAnimations.css';

// 🚀 Lazy load del MarkerClusterGroup (solo se carga cuando se necesita)
const MarkerClusterGroup = dynamic(() => import('./MarkerClusterGroup'), { ssr: false });

// 🚀 Constantes para umbrales de rendimiento
const HIGH_DENSITY_THRESHOLD = 80; // Activar modo alta densidad con >80 marcadores totales
const DISABLE_ANIMATIONS_THRESHOLD = 150; // Deshabilitar animaciones CSS con >150 marcadores

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
  secondaryAnimMovil?: number; // Segundo móvil para animación dual (máx 2)
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
  allPedidos?: PedidoSupabase[]; // Todos los pedidos (incluyendo finalizados) para lookup de popup
  services?: ServiceSupabase[]; // Services para mostrar en el mapa
  allServices?: ServiceSupabase[]; // Todos los services (incluyendo finalizados) para lookup de popup
  onPedidoClick?: (pedidoId: number | undefined) => void; // Callback para click en pedido
  onServiceClick?: (serviceId: number | undefined) => void; // Callback para click en service
  popupPedido?: number; // Pedido con popup abierto
  popupService?: number; // Service con popup abierto
  focusedPedidoId?: number; // ✅ NUEVO: ID del pedido a centralizar
  focusedPuntoId?: string; // ✅ NUEVO: ID del punto de interés a centralizar
  isPlacingMarker?: boolean; // Prop externa para controlar el modo de colocación
  onPlacingMarkerChange?: (isPlacing: boolean) => void; // Callback para notificar cambios
  onMarkersChange?: (markers: CustomMarker[]) => void; // Callback para notificar cambios en los marcadores
  allMoviles?: MovilData[]; // Todos los móviles (para selector en panel de animación)
  selectedDate?: string; // Fecha seleccionada actual
  onMovilDateChange?: (movilId: number, date: string) => void; // Cambiar móvil/fecha desde panel animación
  onSecondaryAnimMovilChange?: (movilId: number | undefined) => void; // Cambiar 2do móvil animación
}

function MapUpdater({ 
  moviles, 
  focusedMovil, 
  selectedMovil, 
  selectedMovilesCount,
  focusedPedidoId,
  focusedPuntoId,
  pedidos,
  customMarkers
}: { 
  moviles: MovilData[]; 
  focusedMovil?: number; 
  selectedMovil?: number;
  selectedMovilesCount?: number;
  focusedPedidoId?: number; // ✅ NUEVO
  focusedPuntoId?: string; // ✅ NUEVO
  pedidos?: PedidoSupabase[]; // ✅ NUEVO
  customMarkers?: CustomMarker[]; // ✅ NUEVO
}) {
  const map = useMap();
  const hasInitialized = useRef(false);
  const lastSelectedMovil = useRef<number | undefined>(undefined);
  const lastFocusedMovil = useRef<number | undefined>(undefined);
  const lastSelectedMovilesCount = useRef<number>(0);
  const lastFocusedPedidoId = useRef<number | undefined>(undefined); // ✅ NUEVO
  const lastFocusedPuntoId = useRef<string | undefined>(undefined); // ✅ NUEVO
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

  // ✅ NUEVO: Efecto para centrar el mapa en un pedido
  useEffect(() => {
    if (focusedPedidoId !== lastFocusedPedidoId.current) {
      lastFocusedPedidoId.current = focusedPedidoId;
      
      if (focusedPedidoId && pedidos && pedidos.length > 0) {
        const pedido = pedidos.find(p => p.id === focusedPedidoId);
        if (pedido?.latitud && pedido?.longitud) {
          console.log('📦 Centrando mapa en pedido:', pedido.id);
          map.setView([pedido.latitud, pedido.longitud], 16, {
            animate: true,
          });
        }
      }
    }
  }, [map, focusedPedidoId, pedidos]);

  // ✅ NUEVO: Efecto para centrar el mapa en un punto de interés
  useEffect(() => {
    if (focusedPuntoId !== lastFocusedPuntoId.current) {
      lastFocusedPuntoId.current = focusedPuntoId;
      
      if (focusedPuntoId && customMarkers && customMarkers.length > 0) {
        const punto = customMarkers.find(p => p.id === focusedPuntoId);
        if (punto) {
          console.log('📍 Centrando mapa en punto de interés:', punto.nombre);
          map.setView([punto.latitud, punto.longitud], 16, {
            animate: true,
          });
        }
      }
    }
  }, [map, focusedPuntoId, customMarkers]);

  // Efecto para centrar el mapa SOLO la primera vez que se cargan datos
  useEffect(() => {
    if (hasInitialized.current) return;
    if (selectedMovil || focusedMovil) return;

    const allBounds: [number, number][] = [];

    // Agregar móviles con posición
    moviles.filter(m => m.currentPosition).forEach(m => {
      allBounds.push([m.currentPosition!.coordX, m.currentPosition!.coordY]);
    });

    // Agregar pedidos con coordenadas
    if (pedidos) {
      pedidos.filter(p => p.latitud && p.longitud).forEach(p => {
        allBounds.push([p.latitud!, p.longitud!]);
      });
    }

    // Agregar puntos de interés
    if (customMarkers) {
      customMarkers.filter(m => m.latitud && m.longitud).forEach(m => {
        allBounds.push([m.latitud, m.longitud]);
      });
    }

    if (allBounds.length > 0) {
      map.fitBounds(allBounds, { padding: [50, 50], maxZoom: 13 });
      hasInitialized.current = true;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, moviles.length, pedidos, customMarkers]);

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

    const movilesConPosicion = moviles.filter(m => m.currentPosition);

    if (movilesConPosicion.length > 1) {
      // Múltiples móviles seleccionados: ajustar bounds para mostrar todos
      const bounds = movilesConPosicion.map(m => 
        [m.currentPosition!.coordX, m.currentPosition!.coordY] as [number, number]
      );
      map.fitBounds(bounds, { padding: [80, 80], maxZoom: 15 });
    } else if (movilesConPosicion.length === 1) {
      // Un solo móvil: centrar en él
      const movil = movilesConPosicion[0];
      map.setView([movil.currentPosition!.coordX, movil.currentPosition!.coordY], 15, {
        animate: true,
      });
    } else {
      // Sin móviles seleccionados: centrar en pedidos + POIs visibles
      const allBounds: [number, number][] = [];

      // Agregar pedidos con coordenadas
      if (pedidos) {
        pedidos.forEach(p => {
          if (p.latitud && p.longitud) {
            allBounds.push([p.latitud, p.longitud]);
          }
        });
      }

      // Agregar puntos de interés
      if (customMarkers) {
        customMarkers.forEach(m => {
          if (m.latitud && m.longitud) {
            allBounds.push([m.latitud, m.longitud]);
          }
        });
      }

      if (allBounds.length > 0) {
        map.fitBounds(allBounds, { padding: [80, 80], maxZoom: 13 });
      }
    }
  }, [map, selectedMovilesCount, moviles, selectedMovil, pedidos, customMarkers]);

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
  secondaryMovil?: number;
  animationProgress: number;
  isAnimating: boolean;
  startTime: string;
  endTime: string;
  unifiedTimeRange?: { minTime: number; maxTime: number } | null;
}

function AnimationFollower({ 
  moviles, 
  selectedMovil, 
  secondaryMovil,
  animationProgress, 
  isAnimating,
  startTime,
  endTime,
  unifiedTimeRange
}: AnimationFollowerProps) {
  const map = useMap();
  const hasCenteredRef = useRef<boolean>(false);

  // Centrar el mapa UNA vez al iniciar animación: fitBounds en TODO el recorrido
  useEffect(() => {
    if (!isAnimating) {
      hasCenteredRef.current = false;
      return;
    }
    if (hasCenteredRef.current) return; // Ya centró

    const timeFilter = (history: any[]) => history.filter((coord: any) => {
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

    // Recopilar TODOS los puntos de todos los móviles seleccionados
    const allPoints: [number, number][] = [];
    const movilIds = [selectedMovil, secondaryMovil].filter(Boolean) as number[];

    for (const movilId of movilIds) {
      const movilData = moviles.find(m => m.id === movilId);
      if (!movilData?.history) continue;
      const filtered = timeFilter(movilData.history);
      for (const coord of filtered) {
        allPoints.push([coord.coordX, coord.coordY]);
      }
    }

    if (allPoints.length === 0) return;

    // FitBounds con todos los puntos de ambos recorridos
    const bounds = L.latLngBounds(allPoints.map(p => L.latLng(p[0], p[1])));
    map.fitBounds(bounds.pad(0.1), { animate: true, maxZoom: 15 });
    hasCenteredRef.current = true;
  }, [map, isAnimating, selectedMovil, secondaryMovil, moviles, startTime, endTime]);

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

// Función de comparación para React.memo
const arePropsEqual = (prev: MapViewProps, next: MapViewProps) => {
  // Solo re-renderizar si cambian datos críticos
  return (
    prev.moviles.length === next.moviles.length &&
    prev.selectedMovil === next.selectedMovil &&
    prev.secondaryAnimMovil === next.secondaryAnimMovil &&
    prev.focusedMovil === next.focusedMovil &&
    prev.showPendientes === next.showPendientes &&
    prev.showCompletados === next.showCompletados &&
    prev.popupMovil === next.popupMovil &&
    prev.popupPedido === next.popupPedido &&
    prev.popupService === next.popupService &&
    prev.defaultMapLayer === next.defaultMapLayer &&
    prev.selectedMovilesCount === next.selectedMovilesCount &&
    prev.isPlacingMarker === next.isPlacingMarker &&
    prev.focusedPedidoId === next.focusedPedidoId &&
    prev.focusedPuntoId === next.focusedPuntoId &&
    // 🚀 Comparar pedidos por cantidad (evitar deep comparison costosa)
    (prev.pedidos?.length ?? 0) === (next.pedidos?.length ?? 0) &&
    (prev.allPedidos?.length ?? 0) === (next.allPedidos?.length ?? 0) &&
    (prev.services?.length ?? 0) === (next.services?.length ?? 0) &&
    (prev.allServices?.length ?? 0) === (next.allServices?.length ?? 0) &&
    // Comparación de IDs de móviles (más barato que deep equal)
    prev.moviles.every((m, i) => m.id === next.moviles[i]?.id) &&
    // Detectar cuando se carga el historial de un móvil (history pasa de undefined/vacío a tener datos)
    prev.moviles.every((m, i) => (m.history?.length ?? 0) === (next.moviles[i]?.history?.length ?? 0))
  );
};

const MapView = memo(function MapView({ 
  moviles, 
  focusedMovil, 
  selectedMovil, 
  secondaryAnimMovil,
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
  allPedidos = [],
  services = [],
  allServices = [],
  onPedidoClick,
  onServiceClick,
  popupPedido,
  popupService,
  focusedPedidoId, // ✅ NUEVO
  focusedPuntoId, // ✅ NUEVO
  isPlacingMarker: externalIsPlacingMarker = false,
  onPlacingMarkerChange,
  onMarkersChange,
  allMoviles = [],
  selectedDate = '',
  onMovilDateChange,
  onSecondaryAnimMovilChange,
}: MapViewProps) {
  // Default center (Montevideo, Uruguay)
  const defaultCenter: [number, number] = [-34.9011, -56.1645];

  // 🔧 DEBUG: Log services recibidos en MapView
  useEffect(() => {
    const conCoords = services.filter(s => s.latitud && s.longitud);
    console.log(`🔧 MapView: ${services.length} services recibidos, ${conCoords.length} con coordenadas`);
    if (conCoords.length > 0) {
      console.log('🔧 Primer service con coords:', { id: conCoords[0].id, lat: conCoords[0].latitud, lng: conCoords[0].longitud, defecto: conCoords[0].defecto });
    }
    if (services.length > 0 && conCoords.length === 0) {
      console.log('🔧 Services sin coordenadas - ejemplo:', { id: services[0].id, lat: services[0].latitud, lng: services[0].longitud, movil: services[0].movil, estado: services[0].estado_nro });
    }
  }, [services]);
  
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
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [tempMarkerPosition, setTempMarkerPosition] = useState<{ lat: number; lng: number } | null>(null);
  const [editingMarker, setEditingMarker] = useState<CustomMarker | null>(null); // Nuevo: para edición
  
  // Usar el estado externo si se proporciona, sino usar estado interno
  const isPlacingMarker = externalIsPlacingMarker;
  
  const animationRef = useRef<number | null>(null);
  const animationStartTime = useRef<number>(0); // Timestamp de inicio de animación
  const lastProgressUpdate = useRef<number>(0); // Último progreso guardado

  // 🚀 Registrar Service Worker para cache de tiles (reduce CPU y network)
  useEffect(() => {
    registerTileCacheServiceWorker();
  }, []);

  // Cargar marcadores personalizados desde la API
  useEffect(() => {
    const loadMarkers = async () => {
      try {
        // Obtener email del usuario desde localStorage (trackmovil_user)
        const userStr = localStorage.getItem('trackmovil_user');
        if (!userStr) {
          console.warn('⚠️ No hay usuario logueado, cargando desde localStorage');
          const savedMarkers = localStorage.getItem('customMarkers');
          if (savedMarkers) {
            setCustomMarkers(JSON.parse(savedMarkers));
          }
          return;
        }

        const user = JSON.parse(userStr);
        const usuario_email = user.email || user.username;

        if (!usuario_email) {
          console.warn('⚠️ Usuario sin email, usando localStorage');
          const savedMarkers = localStorage.getItem('customMarkers');
          if (savedMarkers) {
            setCustomMarkers(JSON.parse(savedMarkers));
          }
          return;
        }

        console.log('📍 Cargando puntos para usuario:', usuario_email);

        // Cargar desde API
        const response = await fetch(`/api/puntos-interes?usuario_email=${encodeURIComponent(usuario_email)}`);
        if (response.ok) {
          const { data } = await response.json();
          // Convertir de PuntoInteresSupabase a CustomMarker
          const markers: CustomMarker[] = data.map((punto: any) => ({
            id: punto.id.toString(),
            nombre: punto.nombre,
            observacion: punto.descripcion || '',
            icono: punto.icono,
            latitud: parseFloat(punto.latitud),
            longitud: parseFloat(punto.longitud),
            creadoPor: punto.usuario_email,
            fechaCreacion: punto.created_at,
            visible: punto.visible,
          }));
          setCustomMarkers(markers);
          // Guardar backup en localStorage
          localStorage.setItem('customMarkers', JSON.stringify(markers));
          console.log(`✅ ${markers.length} marcadores cargados desde Supabase`);
        } else {
          console.warn('⚠️ No se pudieron cargar los marcadores, usando modo offline');
          toast.error('⚠️ No se pudieron cargar los puntos desde el servidor. Usando datos locales.');
          // Fallback a localStorage si la API falla
          const savedMarkers = localStorage.getItem('customMarkers');
          if (savedMarkers) {
            setCustomMarkers(JSON.parse(savedMarkers));
          }
        }
      } catch (error) {
        console.error('❌ Error al cargar marcadores:', error);
        toast.error('❌ Error al cargar los puntos. Usando datos locales.');
        // Fallback a localStorage
        const savedMarkers = localStorage.getItem('customMarkers');
        if (savedMarkers) {
          setCustomMarkers(JSON.parse(savedMarkers));
        }
      }
    };

    loadMarkers();
  }, []);

  // � DEBUG: Solo log mínimo en desarrollo
  useEffect(() => {
    if (process.env.NODE_ENV === 'development' && pedidos?.length > 0) {
      const conCoordenadas = pedidos.filter(p => p.latitud && p.longitud);
      console.log(`📦 MapView: ${pedidos.length} pedidos (${conCoordenadas.length} con coords)`);
    }
  }, [pedidos?.length]);

  // Notificar al padre cuando cambien los marcadores
  useEffect(() => {
    if (onMarkersChange) {
      onMarkersChange(customMarkers);
    }
  }, [customMarkers, onMarkersChange]);

  // Manejar guardado de nuevo marcador
  const handleSaveMarker = async (data: { nombre: string; observacion: string; icono: string }) => {
    if (!tempMarkerPosition) return;

    const toastId = toast.loading('💾 Guardando punto...');

    try {
      // Obtener email del usuario desde localStorage (trackmovil_user)
      const userStr = localStorage.getItem('trackmovil_user');
      let usuario_email = 'anonimo@trackmovil.com'; // Default

      if (userStr) {
        try {
          const user = JSON.parse(userStr);
          usuario_email = user.email || user.username || usuario_email;
          console.log('👤 Usuario guardando marcador:', usuario_email);
        } catch (e) {
          console.warn('⚠️ Error parseando usuario, usando email por defecto');
        }
      }

      // Guardar en Supabase via API
      const response = await fetch('/api/puntos-interes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          nombre: data.nombre,
          descripcion: data.observacion,
          icono: data.icono,
          latitud: tempMarkerPosition.lat,
          longitud: tempMarkerPosition.lng,
          tipo: 'privado', // Por defecto privado
          usuario_email, // Incluir email del usuario
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Error al guardar el marcador');
      }

      const { data: savedPunto } = await response.json();

      // Agregar al estado local
      const newMarker: CustomMarker = {
        id: savedPunto.id.toString(),
        nombre: savedPunto.nombre,
        observacion: savedPunto.descripcion || '',
        icono: savedPunto.icono,
        latitud: parseFloat(savedPunto.latitud),
        longitud: parseFloat(savedPunto.longitud),
        creadoPor: savedPunto.usuario_email,
        fechaCreacion: savedPunto.created_at,
        visible: savedPunto.visible,
      };

      setCustomMarkers(prev => [...prev, newMarker]);
      setTempMarkerPosition(null);
      
      // También guardar en localStorage como backup
      const updatedMarkers = [...customMarkers, newMarker];
      localStorage.setItem('customMarkers', JSON.stringify(updatedMarkers));
      
      console.log('✅ Marcador guardado exitosamente en Supabase');
      toast.success('✅ Punto guardado correctamente', { id: toastId });
      
      if (onPlacingMarkerChange) {
        onPlacingMarkerChange(false);
      }
    } catch (error) {
      console.error('❌ Error al guardar marcador:', error);
      toast.error('❌ Error al guardar el punto. Por favor intenta nuevamente.', { id: toastId });
    }
  };

  // Eliminar marcador
  const handleDeleteMarker = async (markerId: string) => {
    const toastId = toast.loading('🗑️ Eliminando punto...');

    try {
      // Obtener email del usuario desde localStorage (trackmovil_user)
      const userStr = localStorage.getItem('trackmovil_user');
      let usuario_email = 'anonimo@trackmovil.com';

      if (userStr) {
        try {
          const user = JSON.parse(userStr);
          usuario_email = user.email || user.username || usuario_email;
        } catch (e) {
          console.warn('⚠️ Error parseando usuario');
        }
      }

      // Eliminar de Supabase via API
      const response = await fetch(`/api/puntos-interes?id=${markerId}&usuario_email=${encodeURIComponent(usuario_email)}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Error al eliminar el marcador');
      }

      // Actualizar estado local
      setCustomMarkers(prev => prev.filter(m => m.id !== markerId));
      
      // También actualizar localStorage
      const updatedMarkers = customMarkers.filter(m => m.id !== markerId);
      localStorage.setItem('customMarkers', JSON.stringify(updatedMarkers));
      
      console.log('✅ Marcador eliminado exitosamente');
      toast.success('✅ Punto eliminado correctamente', { id: toastId });
    } catch (error) {
      console.error('❌ Error al eliminar marcador:', error);
      toast.error('❌ Error al eliminar el punto. Por favor intenta nuevamente.', { id: toastId });
    }
  };

  // Editar marcador existente
  const handleEditMarker = async (data: { nombre: string; observacion: string; icono: string }) => {
    if (!editingMarker) return;

    const toastId = toast.loading('🔄 Actualizando punto...');

    try {
      // Obtener email del usuario desde localStorage (trackmovil_user)
      const userStr = localStorage.getItem('trackmovil_user');
      let usuario_email = 'anonimo@trackmovil.com';

      if (userStr) {
        try {
          const user = JSON.parse(userStr);
          usuario_email = user.email || user.username || usuario_email;
        } catch (e) {
          console.warn('⚠️ Error parseando usuario');
        }
      }

      // Actualizar en Supabase via API
      const response = await fetch('/api/puntos-interes', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          id: editingMarker.id,
          usuario_email,
          nombre: data.nombre,
          descripcion: data.observacion,
          icono: data.icono,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Error al actualizar el marcador');
      }

      const { data: updatedPunto } = await response.json();

      // Actualizar estado local
      setCustomMarkers(prev => prev.map(m => 
        m.id === editingMarker.id 
          ? {
              ...m,
              nombre: updatedPunto.nombre,
              observacion: updatedPunto.descripcion || '',
              icono: updatedPunto.icono,
            }
          : m
      ));

      // También actualizar localStorage
      const updatedMarkers = customMarkers.map(m => 
        m.id === editingMarker.id 
          ? {
              ...m,
              nombre: updatedPunto.nombre,
              observacion: updatedPunto.descripcion || '',
              icono: updatedPunto.icono,
            }
          : m
      );
      localStorage.setItem('customMarkers', JSON.stringify(updatedMarkers));
      
      console.log('✅ Marcador actualizado exitosamente');
      toast.success('✅ Punto actualizado correctamente', { id: toastId });
      
      setEditingMarker(null);
    } catch (error) {
      console.error('❌ Error al actualizar marcador:', error);
      toast.error('❌ Error al actualizar el punto. Por favor intenta nuevamente.', { id: toastId });
    }
  };

  // Extraer pedidos/servicios completados del historial de coordenadas
  // Ahora los completados están en LOGCOORDMOVIL con ORIGEN='UPDPEDIDOS' o 'DYLPEDIDOS'
  const pedidosCompletados = useMemo(() => {
    const animMovilIds = [selectedMovil, secondaryAnimMovil].filter(Boolean) as number[];
    if (animMovilIds.length === 0) return [];
    
    const allCompletados: (PedidoServicio & { sourceMovilId: number })[] = [];
    
    for (const movilId of animMovilIds) {
      const movilData = moviles.find(m => m.id === movilId);
      if (!movilData?.history) continue;

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
            sourceMovilId: movilId,
          } as PedidoServicio & { sourceMovilId: number };
        });

      allCompletados.push(...completados);
    }

    // Deduplicar por pedidoId
    const deduplicados = allCompletados.reduce((acc, curr) => {
      const existe = acc.find(item => item.id === curr.id);
      if (!existe) {
        acc.push(curr);
      }
      return acc;
    }, [] as (PedidoServicio & { sourceMovilId: number })[]);

    return deduplicados;
  }, [moviles, selectedMovil, secondaryAnimMovil]);

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

  // 🎨 NUEVO: Calcular color del móvil basado en capacidad del lote
  const getMovilColor = useCallback((movil: MovilData) => {
    // 🆕 Si el móvil NO está activo (estado_nro 3), color gris
    const estadoNro = movil.estadoNro;
    if (estadoNro === 3) {
      return '#9CA3AF'; // Gris (NO ACTIVO)
    }
    // 🆕 Si el móvil está en BAJA MOMENTÁNEA (estado_nro 4), color naranja
    if (estadoNro === 4) {
      return '#8B5CF6'; // Violeta (BAJA MOMENTÁNEA)
    }

    const tamanoLote = movil.tamanoLote || 6;
    const pedidosAsignados = movil.pedidosAsignados || 0;
    
    // Calcular capacidad restante
    const capacidadRestante = tamanoLote - pedidosAsignados;
    const porcentajeDisponible = (capacidadRestante / tamanoLote) * 100;
    
    // Determinar color según reglas:
    // Negro - Capacidad = 0 (lote completo)
    if (capacidadRestante === 0) {
      return '#1F2937'; // Negro/Gris oscuro
    }
    
    // Amarillo - Capacidad < 50% (poco espacio)
    if (porcentajeDisponible < 50) {
      return '#F59E0B'; // Amarillo/Ámbar
    }
    
    // Verde - Capacidad >= 50% (buen espacio)
    return '#22C55E'; // Verde
  }, []);

  // 🚀 OPTIMIZACIÓN: Usar useCallback para funciones de creación de iconos
  const createCustomIcon = useCallback((color: string, movilId?: number, isInactive?: boolean, isNoActivo?: boolean, isBajaMomentanea?: boolean) => {
    const cacheKey = `custom-${color}-${movilId}-${isInactive}-${isNoActivo}-${isBajaMomentanea}`;
    
    return getCachedIcon(cacheKey, () => {
      // 🆕 Si el móvil tiene BAJA MOMENTÁNEA (estado_nro 4), ícono naranja con pausa
      if (isBajaMomentanea) {
        return L.divIcon({
          className: '',
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
              <!-- Círculo principal naranja con ícono de pausa -->
              <div style="
                width: 40px;
                height: 40px;
                background: linear-gradient(135deg, #8B5CF6 0%, #7C3AED 100%);
                border: 3px solid white;
                border-radius: 50%;
                box-shadow: 0 4px 8px rgba(0,0,0,0.3);
                display: flex;
                align-items: center;
                justify-content: center;
                opacity: 0.9;
              ">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="white" style="filter: drop-shadow(0 1px 2px rgba(0,0,0,0.3));">
                  <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
                </svg>
              </div>
              <!-- Badge con número del móvil -->
              ${movilId ? `
              <div style="
                position: absolute;
                bottom: -6px;
                background-color: white;
                color: #7C3AED;
                border: 2px solid #8B5CF6;
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
          `,
          iconSize: [46, 46],
          iconAnchor: [23, 23],
        });
      }

      // 🆕 Si el móvil tiene estado NO ACTIVO (estado_nro 3), ícono gris con X
      if (isNoActivo) {
        return L.divIcon({
          className: '',
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
              <!-- Círculo principal gris con ícono de pausa -->
              <div style="
                width: 40px;
                height: 40px;
                background: linear-gradient(135deg, #9CA3AF 0%, #6B7280 100%);
                border: 3px solid white;
                border-radius: 50%;
                box-shadow: 0 4px 8px rgba(0,0,0,0.3);
                display: flex;
                align-items: center;
                justify-content: center;
                opacity: 0.85;
              ">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="white" style="filter: drop-shadow(0 1px 2px rgba(0,0,0,0.3));">
                  <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                </svg>
              </div>
              <!-- Badge con número del móvil -->
              ${movilId ? `
              <div style="
                position: absolute;
                bottom: -6px;
                background-color: white;
                color: #6B7280;
                border: 2px solid #9CA3AF;
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
          `,
          iconSize: [46, 46],
          iconAnchor: [23, 23],
        });
      }

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
        `,
        iconSize: [46, 46],
        iconAnchor: [23, 23],
      });
    });
  }, []);

  // 🚀 OPTIMIZACIÓN: Iconos con cache
  const createPedidoIcon = useCallback(() => {
    return getCachedIcon('pedido-legacy', () => L.divIcon({
      className: '',
      html: `
        <div style="
          width: 20px;
          height: 20px;
          position: absolute;
          left: -10px;
          top: -10px;
          background: linear-gradient(135deg, #f97316 0%, #fb923c 100%);
          border: 2px solid white;
          border-radius: 5px;
          box-shadow: 0 2px 4px rgba(0,0,0,0.35), 0 0 0 1px rgba(249, 115, 22, 0.3);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 11px;
          cursor: pointer;
          transition: transform 0.2s;
        " 
        onmouseover="this.style.transform='scale(1.15)'"
        onmouseout="this.style.transform='scale(1)'">📦</div>
      `,
      iconSize: [20, 20],
      iconAnchor: [10, 10],
    }));
  }, []);

  // 🚀 OPTIMIZACIÓN: Iconos para pedidos desde tabla - por atraso/demora
  const createPedidoIconByDelay = useCallback((fchHoraMaxEntComp: string | null) => {
    const delayMinutes = computeDelayMinutes(fchHoraMaxEntComp);
    const info = getDelayInfo(delayMinutes);
    // Cache key basado en el rango de color (no en minutos exactos para reusar iconos)
    const cacheKey = `pedido-delay-${info.label}`;
    
    return getCachedIcon(cacheKey, () => {
      return L.divIcon({
        className: '',
        html: `
          <div style="
            width: 20px;
            height: 20px;
            position: absolute;
            left: -10px;
            top: -10px;
            background: linear-gradient(135deg, ${info.color} 0%, ${info.lightColor} 100%);
            border: 2px solid white;
            border-radius: 5px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.35), 0 0 0 1px ${info.shadowColor};
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 11px;
            cursor: pointer;
            transition: transform 0.2s;
          " 
          onmouseover="this.style.transform='scale(1.15)'"
          onmouseout="this.style.transform='scale(1)'">📦</div>
        `,
        iconSize: [20, 20],
        iconAnchor: [10, 10],
      });
    });
  }, []);

  // 🚀 OPTIMIZACIÓN: Iconos para servicios con cache
  const createServicioIcon = useCallback(() => {
    return getCachedIcon('servicio-legacy', () => L.divIcon({
      className: '',
      html: `
        <div style="
          width: 20px;
          height: 20px;
          position: absolute;
          left: -10px;
          top: -10px;
          background: linear-gradient(135deg, #ef4444 0%, #f87171 100%);
          border: 2px solid white;
          border-radius: 5px;
          box-shadow: 0 2px 4px rgba(0,0,0,0.35), 0 0 0 1px rgba(239, 68, 68, 0.3);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 11px;
          cursor: pointer;
          transition: transform 0.2s;
        "
        onmouseover="this.style.transform='scale(1.15)'"
        onmouseout="this.style.transform='scale(1)'">🔧</div>
      `,
      iconSize: [20, 20],
      iconAnchor: [10, 10],
    }));
  }, []);

  // � Iconos para services desde tabla - por atraso/demora (llavecita)
  const createServiceIconByDelay = useCallback((fchHoraMaxEntComp: string | null) => {
    const delayMinutes = computeDelayMinutes(fchHoraMaxEntComp);
    const info = getDelayInfo(delayMinutes);
    const cacheKey = `service-delay-${info.label}`;
    
    return getCachedIcon(cacheKey, () => {
      return L.divIcon({
        className: '',
        html: `
          <div style="
            width: 20px;
            height: 20px;
            position: absolute;
            left: -10px;
            top: -10px;
            background: linear-gradient(135deg, ${info.color} 0%, ${info.lightColor} 100%);
            border: 2px solid white;
            border-radius: 5px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.35), 0 0 0 1px ${info.shadowColor};
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 11px;
            cursor: pointer;
            transition: transform 0.2s;
          " 
          onmouseover="this.style.transform='scale(1.15)'"
          onmouseout="this.style.transform='scale(1)'">🔧</div>
        `,
        iconSize: [20, 20],
        iconAnchor: [10, 10],
      });
    });
  }, []);

  // �🚀 OPTIMIZACIÓN: Iconos para pedidos/servicios COMPLETADOS con cache
  const createCompletadoIcon = useCallback((tipo: 'PEDIDO' | 'SERVICIO') => {
    const cacheKey = `completado-${tipo}`;
    
    return getCachedIcon(cacheKey, () => {
      const emoji = tipo === 'PEDIDO' ? '✅' : '✔️';
      return L.divIcon({
        className: '',
        html: `
          <div style="
            width: 18px;
            height: 18px;
            position: absolute;
            left: -9px;
            top: -9px;
            background: linear-gradient(135deg, #10b981 0%, #34d399 100%);
            border: 2px solid white;
          border-radius: 50%;
          box-shadow: 0 2px 4px rgba(0,0,0,0.3), 0 0 0 1px rgba(16, 185, 129, 0.3);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 9px;
          cursor: pointer;
          transition: transform 0.2s;
        "
        onmouseover="this.style.transform='scale(1.15)'"
        onmouseout="this.style.transform='scale(1)'">
          ${emoji}
        </div>
      `,
        iconSize: [18, 18],
        iconAnchor: [9, 9],
      });
    });
  }, []);

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

  // 🕐 Rango de tiempo unificado para animación sincronizada de 2 móviles
  // Recorre los historiales de ambos móviles y calcula el minTime/maxTime global
  const unifiedTimeRange = useMemo(() => {
    const animMovilIds = [selectedMovil, secondaryAnimMovil].filter(Boolean) as number[];
    if (animMovilIds.length < 2) return null; // Solo necesario para 2 móviles

    let minTime = Infinity;
    let maxTime = -Infinity;

    for (const movilId of animMovilIds) {
      const movilData = moviles.find(m => m.id === movilId);
      if (!movilData?.history) continue;
      const filtered = filterHistoryByTime(movilData.history);
      for (const coord of filtered) {
        if (!coord.fechaInsLog) continue;
        const ts = new Date(coord.fechaInsLog).getTime();
        if (!isNaN(ts)) {
          if (ts < minTime) minTime = ts;
          if (ts > maxTime) maxTime = ts;
        }
      }
    }

    if (minTime === Infinity || maxTime === -Infinity || minTime >= maxTime) return null;
    return { minTime, maxTime };
  }, [moviles, selectedMovil, secondaryAnimMovil, startTime, endTime]);

  // Tiempo actual de la animación (derivado del progreso y rango unificado)
  const currentAnimTime = useMemo(() => {
    if (!unifiedTimeRange) return null;
    return unifiedTimeRange.minTime + (animationProgress / 100) * (unifiedTimeRange.maxTime - unifiedTimeRange.minTime);
  }, [unifiedTimeRange, animationProgress]);

  // String formateado para mostrar en el control de animación
  const currentAnimTimeStr = useMemo(() => {
    if (currentAnimTime === null) return '';
    try {
      const d = new Date(currentAnimTime);
      return d.toLocaleTimeString('es-UY', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch { return ''; }
  }, [currentAnimTime]);

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

  // Resetear animación cuando cambia el móvil PRIMARIO seleccionado
  // NO incluir secondaryAnimMovil — agregar un 2do no debe resetear la animación
  useEffect(() => {
    setIsAnimating(false);
    setAnimationProgress(0);
    lastProgressUpdate.current = 0;
    animationStartTime.current = 0;
  }, [selectedMovil]);

  // 🚀 OPTIMIZACIÓN: Calcular densidad total de marcadores para adaptar rendimiento
  const totalMarkerCount = useMemo(() => {
    const movilesCount = moviles.filter(m => m.currentPosition).length;
    const pedidosCount = pedidos?.filter(p => p.latitud && p.longitud).length ?? 0;
    const customCount = customMarkers.filter(m => m.visible).length;
    return movilesCount + pedidosCount + customCount;
  }, [moviles.length, pedidos?.length, customMarkers.length]);

  const isHighDensity = totalMarkerCount > HIGH_DENSITY_THRESHOLD;
  const shouldDisableAnimations = totalMarkerCount > DISABLE_ANIMATIONS_THRESHOLD;

  return (
    <div className={`h-full w-full rounded-xl overflow-hidden shadow-2xl relative ${isHighDensity ? 'high-density-map' : ''}`}>
      <MapContainer
        center={defaultCenter}
        zoom={13}
        maxZoom={19}
        className={`h-full w-full ${isPlacingMarker ? 'cursor-crosshair' : ''} ${isHighDensity ? 'high-density' : ''}`}
        zoomControl={true}
        // 🚀 OPTIMIZACIONES DE PERFORMANCE
        preferCanvas={true}        // Usar Canvas en lugar de SVG (2-3x más rápido con muchos marcadores)
        zoomAnimation={!shouldDisableAnimations} // Deshabilitar animación de zoom en alta densidad
        fadeAnimation={false}      // Deshabilitar fade (ahorra GPU)
        markerZoomAnimation={false} // Deshabilitar animación de marcadores (ahorra CPU)
        zoomSnap={0.5}            // Granularidad de zoom
        zoomDelta={0.5}           // Delta de zoom con botones
        wheelPxPerZoomLevel={120} // Sensibilidad de scroll
      >
        {/* Control de capas base (calles, satélite, terreno, etc.) */}
        <LayersControl defaultLayer={defaultMapLayer} />
        
        {(selectedMovil || secondaryAnimMovil) ? (
          // Mostrar los móviles seleccionados con su recorrido
          <>
            {moviles
              .filter(m => m.id === selectedMovil || m.id === secondaryAnimMovil)
              .map((movil) => {
                // Determinar si es el primario o secundario
                const isPrimary = movil.id === selectedMovil;
                const hasTwoMoviles = !!(selectedMovil && secondaryAnimMovil);
                // Colores diferenciados para cada ruta cuando hay 2 móviles
                const routeColor = hasTwoMoviles
                  ? (isPrimary ? '#3b82f6' : '#f97316') // Azul vs Naranja
                  : movil.color;
                const routeColorLabel = hasTwoMoviles
                  ? (isPrimary ? '#2563eb' : '#ea580c')
                  : movil.color;

                // Si no tiene posición actual, no renderizar nada
                if (!movil.currentPosition) return null;
                
                // Filtrar historial por rango de tiempo
                const filteredHistory = movil.history ? filterHistoryByTime(movil.history) : [];
                
                // Si no hay historial, solo mostrar el marcador actual
                if (filteredHistory.length === 0) {
                  return (
                    <OptimizedMarker
                      key={movil.id}
                      position={[movil.currentPosition.coordX, movil.currentPosition.coordY]}
                      icon={createCustomIcon(getMovilColor(movil), movil.id, movil.isInactive, movil.estadoNro === 3, movil.estadoNro === 4)}
                    >
                      <Popup>
                        <div className="p-2">
                          <h3 className="font-bold text-lg" style={{ color: getMovilColor(movil) }}>
                            {movil.name}
                          </h3>
                          <p className="text-sm text-gray-600">
                            <strong>Estado:</strong> {movil.currentPosition.auxIn2}
                          </p>
                          <p className="text-sm text-yellow-600 font-semibold mt-2">
                            ⚠️ Sin historial para esta fecha
                          </p>
                        </div>
                      </Popup>
                    </OptimizedMarker>
                  );
                }
                
                // Dibujar la línea del recorrido si tiene historial
                const fullPathCoordinates = filteredHistory.map(coord => [coord.coordX, coord.coordY] as [number, number]);

                // 🚀 OPTIMIZACIÓN: Simplificar el path completo para mejorar rendimiento
                const optimizedFullPath = fullPathCoordinates.length > 300
                  ? optimizePath(fullPathCoordinates, 200)
                  : fullPathCoordinates;

                const totalPoints = optimizedFullPath.length;
                const duringAnimation = isAnimating || animationProgress > 0;

                // ========== CÁLCULO DE VISIBILIDAD ==========
                // Si hay rango unificado (2 móviles), usar tiempo real; sino, porcentaje
                let visiblePointsCount: number;
                let pathCoordinates: [number, number][];
                let animatedCurrentCoord: [number, number] | null = null;
                let filteredHistoryAnimatedIndex: number = 0;
                let movilVisible = true; // ¿El móvil ya apareció en la línea de tiempo?

                if (duringAnimation && currentAnimTime !== null) {
                  // === MODO TIEMPO REAL (2 móviles) ===
                  // filteredHistory está ordenado: index 0 = más reciente, last = más antiguo
                  // Contar cuántas coordenadas tienen timestamp <= currentAnimTime
                  // (o sea, ya "sucedieron" en la línea de tiempo)
                  const filteredHistoryTotal = filteredHistory.length;
                  let visibleHistoryCount = 0;
                  for (let i = filteredHistoryTotal - 1; i >= 0; i--) {
                    const ts = new Date(filteredHistory[i].fechaInsLog).getTime();
                    if (ts <= currentAnimTime) {
                      visibleHistoryCount++;
                    } else {
                      break;
                    }
                  }

                  if (visibleHistoryCount === 0) {
                    // Este móvil aún no tiene coordenadas en el tiempo actual
                    movilVisible = false;
                    visiblePointsCount = 0;
                    pathCoordinates = [];
                    filteredHistoryAnimatedIndex = filteredHistoryTotal;
                  } else {
                    // Mapear la proporción de historial visible a optimizedFullPath
                    const ratio = visibleHistoryCount / filteredHistoryTotal;
                    visiblePointsCount = Math.max(1, Math.ceil(ratio * totalPoints));
                    pathCoordinates = optimizedFullPath.slice(Math.max(0, totalPoints - visiblePointsCount));
                    
                    const animatedPointIndex = totalPoints - visiblePointsCount;
                    animatedCurrentCoord = animatedPointIndex >= 0 && animatedPointIndex < totalPoints
                      ? optimizedFullPath[animatedPointIndex]
                      : null;
                    
                    filteredHistoryAnimatedIndex = Math.max(0, filteredHistoryTotal - visibleHistoryCount);
                  }
                } else if (duringAnimation) {
                  // === MODO PORCENTAJE (1 móvil) ===
                  visiblePointsCount = Math.max(1, Math.ceil((animationProgress / 100) * totalPoints));
                  pathCoordinates = optimizedFullPath.slice(Math.max(0, totalPoints - visiblePointsCount));
                  const animatedPointIndex = totalPoints - visiblePointsCount;
                  animatedCurrentCoord = animatedPointIndex >= 0 && animatedPointIndex < totalPoints
                    ? optimizedFullPath[animatedPointIndex]
                    : null;
                  const filteredHistoryTotal = filteredHistory.length;
                  filteredHistoryAnimatedIndex = Math.max(0, filteredHistoryTotal - Math.ceil((animationProgress / 100) * filteredHistoryTotal));
                } else {
                  // === SIN ANIMACIÓN ===
                  visiblePointsCount = totalPoints;
                  pathCoordinates = optimizedFullPath;
                }

                // Hora del punto animado (para etiqueta del marcador en movimiento)
                let animatedCurrentTimeStr = '';
                if (duringAnimation && animatedCurrentCoord) {
                  const animTimeCoord = filteredHistory[filteredHistoryAnimatedIndex];
                  if (animTimeCoord?.fechaInsLog) {
                    try {
                      const d = new Date(animTimeCoord.fechaInsLog);
                      animatedCurrentTimeStr = d.toLocaleTimeString('es-UY', { hour: '2-digit', minute: '2-digit' });
                    } catch { /* ignore */ }
                  }
                }

                // Si el móvil aún no apareció en la línea de tiempo, no renderizar nada
                if (!movilVisible) return null;

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
                                  <OptimizedPolyline
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
                                  <OptimizedPolyline
                                    positions={[coord, nextCoord]}
                                    pathOptions={{
                                      color: routeColor,
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
                            <OptimizedPolyline
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
                              
                              // Opacidad: últimas 3 = 0.9, anteriores con gradiente suave
                              const opacity = isRecent 
                                ? 0.9 
                                : Math.max(0.08, 0.25 * (index / (totalLines - 3)));
                              
                              const weight = isRecent ? 4 : 2.5;
                              const dashArray = isRecent ? '10, 8' : undefined;
                              
                              return (
                                <OptimizedPolyline
                                  key={`segment-${movil.id}-${index}`}
                                  positions={[coord, nextCoord]}
                                  pathOptions={{
                                    color: routeColor,
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
                    
                    {/* Marcador animado EN RUTA — renderizado desde optimizedFullPath para sync con mapa */}
                    {animatedCurrentCoord && (
                      <OptimizedMarker
                        key={`${movil.id}-animated-current`}
                        position={[animatedCurrentCoord[0], animatedCurrentCoord[1]]}
                        icon={L.divIcon({
                          className: '',
                          html: `
                            <div style="position: relative;">
                              <div style="
                                width: 18px;
                                height: 18px;
                                background-color: ${routeColor};
                                border: 3px solid white;
                                border-radius: 50%;
                                box-shadow: 0 2px 8px rgba(0,0,0,0.5);
                                position: absolute;
                                left: -9px;
                                top: -9px;
                                animation: pulse-marker 2s ease-in-out infinite;
                              "></div>
                              <div style="
                                position: absolute;
                                left: -16px;
                                top: -16px;
                                width: 32px;
                                height: 32px;
                                border: 3px solid ${routeColor};
                                border-radius: 50%;
                                animation: ripple 1.5s ease-out infinite;
                              "></div>
                              <div style="
                                position: absolute;
                                top: 20px;
                                left: 50%;
                                transform: translateX(-50%);
                                background: ${routeColorLabel};
                                color: white;
                                border: 1px solid white;
                                border-radius: 6px;
                                padding: 2px 8px;
                                font-size: 10px;
                                font-weight: bold;
                                white-space: nowrap;
                                box-shadow: 0 2px 4px rgba(0,0,0,0.3);
                                pointer-events: none;
                                font-family: system-ui, -apple-system, sans-serif;
                              ">🚗 #${movil.id}${animatedCurrentTimeStr ? ' - ' + animatedCurrentTimeStr : ''}</div>
                            </div>
                          `,
                          iconSize: [18, 18],
                          iconAnchor: [9, 9],
                        })}
                      />
                    )}

                    {/* Marcadores del historial (puntos recorridos) */}
                    {filteredHistory.map((coord, index) => {
                      // Durante la animación, solo mostrar puntos ya "recorridos"
                      const duringAnimation = isAnimating || animationProgress > 0;
                      if (duringAnimation && index < filteredHistoryAnimatedIndex) {
                        return null; // No mostrar este punto aún
                      }

                      const isFirst = index === 0; // Más reciente
                      const isLast = index === filteredHistory.length - 1; // Inicio del día
                      const totalPoints = filteredHistory.length;
                      
                      // 🚀 OPTIMIZACIÓN: Mostrar solo puntos importantes o cada N puntos
                      const skipInterval = totalPoints > 100 ? 15 : 10;
                      const shouldShow = isFirst || isLast || index % skipInterval === 0;
                      
                      if (!shouldShow) return null;
                      
                      // Tamaño progresivo
                      const size = isFirst ? 16 : isLast ? 14 : 8;
                      
                      // Opacidad que decrece con antigüedad
                      const opacity = 0.5 + (0.5 * (totalPoints - index) / totalPoints);
                      
                      // Mostrar etiqueta: siempre en primero/último
                      const showLabel = isFirst || isLast;
                      const pointNumber = totalPoints - index;
                      
                      return (
                        <OptimizedMarker
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
                                  background-color: ${routeColor};
                                  border: 2px solid ${isFirst ? '#fff' : isLast ? '#ffd700' : 'rgba(255,255,255,0.9)'};
                                  border-radius: 50%;
                                  box-shadow: 0 2px 6px rgba(0,0,0,${opacity * 0.5});
                                  position: absolute;
                                  left: -${size/2}px;
                                  top: -${size/2}px;
                                  opacity: ${opacity};
                                  ${isFirst ? `
                                    animation: pulse-marker 2s ease-in-out infinite;
                                  ` : ''}
                                "></div>
                                
                                ${showLabel ? `
                                  <!-- Etiqueta INICIO/ACTUAL -->
                                  <div style="
                                    position: absolute;
                                    top: ${size + 4}px;
                                    left: 50%;
                                    transform: translateX(-50%);
                                    background: ${isFirst ? '#22c55e' : isLast ? '#eab308' : 'white'};
                                    color: ${isFirst || isLast ? 'white' : routeColor};
                                    border: 1px solid ${routeColor};
                                    border-radius: 6px;
                                    padding: 2px 6px;
                                    font-size: 9px;
                                    font-weight: bold;
                                    white-space: nowrap;
                                    box-shadow: 0 2px 4px rgba(0,0,0,0.2);
                                    pointer-events: none;
                                    font-family: system-ui, -apple-system, sans-serif;
                                  ">${isFirst ? `🎯 #${movil.id} ACTUAL` : isLast ? `🏁 #${movil.id} INICIO` : `#${pointNumber}`}</div>
                                ` : ''}
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
                        </OptimizedMarker>
                      );
                    })}
                    
                    {/* Marcador principal (posición actual) */}
                    <OptimizedMarker
                      position={[movil.currentPosition!.coordX, movil.currentPosition!.coordY]}
                      icon={createCustomIcon(getMovilColor(movil), movil.id, movil.isInactive, movil.estadoNro === 3, movil.estadoNro === 4)}
                    >
                      <Popup>
                        <div className="p-2">
                          <h3 className="font-bold text-lg" style={{ color: getMovilColor(movil) }}>
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
                    </OptimizedMarker>
                  </div>
                );
              })}

            {/* Marcadores de Pedidos y Servicios Pendientes para móvil seleccionado */}
            {moviles
              .filter(m => (m.id === selectedMovil || m.id === secondaryAnimMovil) && m.pendientes && m.pendientes.length > 0)
              .map((movil) => (
                movil.pendientes!.map((item) => {
                  // Validar que tenga coordenadas válidas
                  if (!item.x || !item.y) return null;

                  return (
                    <OptimizedMarker
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
                
                // Obtener el móvil fuente de este pedido
                const sourceId = (item as any).sourceMovilId;
                const movilData = sourceId
                  ? moviles.find(m => m.id === sourceId)
                  : moviles.find(m => m.id === selectedMovil);
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
                  <OptimizedMarker
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
              // Si no tiene posición GPS, no mostrar en el mapa
              // TODO: Agregar panel lateral para móviles sin GPS
              if (!movil.currentPosition) {
                console.warn(`⚠️ Móvil ${movil.name} (ID: ${movil.id}) sin posición GPS para esta fecha`);
                return null;
              }
              
              return (
                <OptimizedMarker
                  key={movil.id}
                  position={[movil.currentPosition.coordX, movil.currentPosition.coordY]}
                  icon={createCustomIcon(getMovilColor(movil), movil.id, movil.isInactive, movil.estadoNro === 3, movil.estadoNro === 4)}
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
                  <OptimizedMarker
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
                <OptimizedMarker
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
        
        {/* Marcadores de Pedidos desde tabla - con coordenadas - CLUSTERIZADOS */}
        {(() => {
          const pedidosFiltrados = pedidos && pedidos.filter(p => p.latitud && p.longitud);
          return pedidosFiltrados;
        })()?.length ? (
          <MarkerClusterGroup>
            {pedidos.filter(p => p.latitud && p.longitud).map(pedido => {
              const delayMins = computeDelayMinutes(pedido.fch_hora_max_ent_comp);
              const delayInfo = getDelayInfo(delayMins);
              return (
              <OptimizedMarker
                key={`pedido-tabla-${pedido.id}`}
                position={[pedido.latitud!, pedido.longitud!]}
                icon={createPedidoIconByDelay(pedido.fch_hora_max_ent_comp)}
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
                    <div style={{ color: delayInfo.color, fontWeight: 'bold' }}>
                      {delayInfo.label}: {delayInfo.badgeText}
                    </div>
                  </div>
                </Tooltip>
              </OptimizedMarker>
              );
            })}
          </MarkerClusterGroup>
        ) : null}

        {/* Marcadores de Services desde tabla - con coordenadas - CLUSTERIZADOS */}
        {(() => {
          const servicesFiltrados = services && services.filter(s => s.latitud && s.longitud);
          return servicesFiltrados;
        })()?.length ? (
          <MarkerClusterGroup>
            {services.filter(s => s.latitud && s.longitud).map(service => {
              const delayMins = computeDelayMinutes(service.fch_hora_max_ent_comp);
              const delayInfo = getDelayInfo(delayMins);
              return (
              <OptimizedMarker
                key={`service-tabla-${service.id}`}
                position={[service.latitud!, service.longitud!]}
                icon={createServiceIconByDelay(service.fch_hora_max_ent_comp)}
                eventHandlers={{
                  click: () => {
                    onServiceClick && onServiceClick(service.id);
                  }
                }}
              >
                <Tooltip direction="top" offset={[0, -10]} opacity={0.9}>
                  <div className="text-xs">
                    <div className="font-bold">Service #{service.id}</div>
                    <div>{service.cliente_nombre}</div>
                    <div className="text-gray-600">{service.defecto}</div>
                    <div style={{ color: delayInfo.color, fontWeight: 'bold' }}>
                      {delayInfo.label}: {delayInfo.badgeText}
                    </div>
                  </div>
                </Tooltip>
              </OptimizedMarker>
              );
            })}
          </MarkerClusterGroup>
        ) : null}
        
        <MapUpdater 
          moviles={moviles} 
          focusedMovil={focusedMovil} 
          selectedMovil={selectedMovil}
          selectedMovilesCount={selectedMovilesCount}
          focusedPedidoId={focusedPedidoId}
          focusedPuntoId={focusedPuntoId}
          pedidos={pedidos}
          customMarkers={customMarkers}
        />
        <AnimationFollower 
          moviles={moviles}
          selectedMovil={selectedMovil}
          secondaryMovil={secondaryAnimMovil}
          animationProgress={animationProgress}
          isAnimating={isAnimating}
          startTime={startTime}
          endTime={endTime}
          unifiedTimeRange={unifiedTimeRange}
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
            <OptimizedMarker
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
                    <div className="flex gap-1">
                      <button
                        onClick={() => {
                          setEditingMarker(marker);
                          setIsModalOpen(true);
                        }}
                        className="text-blue-500 hover:text-blue-700 p-1"
                        title="Editar marcador"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </button>
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
            </OptimizedMarker>
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
          allMoviles={allMoviles}
          selectedMovilId={selectedMovil}
          secondaryMovilId={secondaryAnimMovil}
          onSecondaryMovilChange={onSecondaryAnimMovilChange}
          selectedDate={selectedDate}
          onMovilDateChange={onMovilDateChange}
          currentAnimTimeStr={currentAnimTimeStr}
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
          pedido={(allPedidos.length > 0 ? allPedidos : pedidos).find(p => p.id === popupPedido) || null}
          onClose={() => {
            if (onPedidoClick) {
              onPedidoClick(undefined);
            }
          }}
        />
      )}

      {/* Popup de información del service */}
      {popupService && (
        <ServiceInfoPopup 
          service={(allServices.length > 0 ? allServices : services).find(s => s.id === popupService) || null}
          onClose={() => {
            if (onServiceClick) {
              onServiceClick(undefined);
            }
          }}
        />
      )}

      {/* Popup de Pedido/Servicio */}
      <PedidoServicioPopup 
        item={selectedPedidoServicio} 
        onClose={() => setSelectedPedidoServicio(null)} 
      />

      {/* Modal para configurar el marcador */}
      <CustomMarkerModal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setTempMarkerPosition(null);
          setEditingMarker(null);
          if (onPlacingMarkerChange) {
            onPlacingMarkerChange(false);
          }
        }}
        onSave={editingMarker ? handleEditMarker : handleSaveMarker}
        initialData={editingMarker ? {
          nombre: editingMarker.nombre,
          observacion: editingMarker.observacion,
          icono: editingMarker.icono,
        } : undefined}
      />
    </div>
  );
}, arePropsEqual);

export default MapView;
