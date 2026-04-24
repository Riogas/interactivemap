import { useCallback } from 'react';
import { MovilData, MovilFilters } from '@/types';
import { computeDelayMinutes, getDelayInfo } from '@/utils/pedidoDelay';
import { isMovilActiveForUI } from '@/lib/moviles/visibility';

/** Límites geográficos de Uruguay */
const URUGUAY_BOUNDS = { latMin: -35.8, latMax: -30.0, lngMin: -58.5, lngMax: -53.0 };

/** Mapeo de labels de atraso → claves de filtro */
const DELAY_CATEGORY_MAP: Record<string, string> = {
  'En Hora': 'en_hora',
  'Hora Límite Cercana': 'limite_cercana',
  'Atrasado': 'atrasado',
  'Muy Atrasado': 'muy_atrasado',
  'Sin hora': 'sin_hora',
};

interface FilterPreferences {
  showActiveMovilesOnly: boolean;
  maxCoordinateDelayMinutes: number;
}

/**
 * Hook que centraliza todas las funciones de filtrado y utilidades del dashboard.
 * Stateless: solo retorna callbacks estables.
 */
export function useFilterHelpers(movilesFilters: MovilFilters, preferences: FilterPreferences) {
  /** Verificar si una coordenada está dentro de Uruguay */
  const isInUruguay = useCallback((lat: number, lng: number): boolean => {
    return lat >= URUGUAY_BOUNDS.latMin && lat <= URUGUAY_BOUNDS.latMax &&
           lng >= URUGUAY_BOUNDS.lngMin && lng <= URUGUAY_BOUNDS.lngMax;
  }, []);

  /** Filtrar pedidos/services por categoría de atraso */
  const filterByDelay = useCallback(<T extends { fch_hora_max_ent_comp?: string | null }>(
    items: T[],
    atrasoFilter: string[]
  ): T[] => {
    if (atrasoFilter.length === 0) return items;
    return items.filter(item => {
      const delayMins = computeDelayMinutes(item.fch_hora_max_ent_comp ?? null);
      const info = getDelayInfo(delayMins);
      const category = DELAY_CATEGORY_MAP[info.label] || 'sin_hora';
      return atrasoFilter.includes(category);
    });
  }, []);

  /** Filtrar pedidos/services por tipo de servicio */
  const filterByTipoServicio = useCallback(<T extends { servicio_nombre?: string | null }>(
    items: T[],
    tipoServicio: string
  ): T[] => {
    if (!tipoServicio || tipoServicio === 'all') return items;
    const tipoUpper = tipoServicio.toUpperCase();
    // "PEDIDOS" agrupa URGENTE + NOCTURNO
    if (tipoUpper === 'PEDIDOS') {
      return items.filter(item => {
        const svc = item.servicio_nombre?.toUpperCase();
        return svc === 'URGENTE' || svc === 'NOCTURNO';
      });
    }
    return items.filter(item =>
      item.servicio_nombre && item.servicio_nombre.toUpperCase() === tipoUpper
    );
  }, []);

  /** Aplicar filtros avanzados de estado a los móviles */
  const applyAdvancedFilters = useCallback((moviles: MovilData[]): MovilData[] => {
    if (movilesFilters.estado.length === 0) return moviles;
    return moviles.filter(movil => {
      const tamanoLote = movil.tamanoLote || 6;
      const pedidosAsignados = movil.pedidosAsignados || 0;
      const capacidadRestante = tamanoLote - pedidosAsignados;
      return movilesFilters.estado.some(estado => {
        switch (estado) {
          case 'no_reporta_gps': return !movil.currentPosition || movil.isInactive;
          case 'baja_momentanea': return movil.estadoNro === 4;
          case 'con_capacidad': return capacidadRestante > 0;
          case 'sin_capacidad': return capacidadRestante === 0;
          default: return true;
        }
      });
    });
  }, [movilesFilters.estado]);

  /** Filtrar por estado de actividad (activo / no_activo / baja_momentanea) */
  const applyActivityFilter = useCallback((moviles: MovilData[]): MovilData[] => {
    if (movilesFilters.actividad === 'todos') return moviles;
    return moviles.filter(movil => {
      const estadoNro = movil.estadoNro;
      const esActivo = isMovilActiveForUI(estadoNro);
      switch (movilesFilters.actividad) {
        case 'activo': return esActivo;
        case 'no_activo': return estadoNro === 3;
        case 'baja_momentanea': return estadoNro === 4;
        default: return true;
      }
    });
  }, [movilesFilters.actividad]);

  /** Eliminar móviles duplicados */
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

  /** Marcar móviles inactivos según preferencias del usuario */
  const markInactiveMoviles = useCallback((moviles: MovilData[]): MovilData[] => {
    return moviles.map(movil => {
      if (!movil.currentPosition) {
        return { ...movil, isInactive: preferences.showActiveMovilesOnly };
      }
      const coordDate = new Date(movil.currentPosition.fechaInsLog);
      const now = new Date();
      const minutesDiff = (now.getTime() - coordDate.getTime()) / (1000 * 60);
      if (minutesDiff > preferences.maxCoordinateDelayMinutes) {
        return { ...movil, isInactive: true };
      }
      return { ...movil, isInactive: false };
    });
  }, [preferences.showActiveMovilesOnly, preferences.maxCoordinateDelayMinutes]);

  /** Calcular color del móvil según porcentaje de ocupación */
  const getMovilColorByOccupancy = useCallback((pedidosAsignados: number, capacidad: number): string => {
    if (!capacidad || capacidad === 0) return '#3B82F6';
    const occupancyPercentage = (pedidosAsignados / capacidad) * 100;
    if (occupancyPercentage >= 100) return '#000000';  // Negro - Lote lleno
    if (occupancyPercentage >= 67) return '#EAB308';   // Amarillo - Casi lleno
    return '#22C55E';                                   // Verde - Disponible
  }, []);

  return {
    isInUruguay,
    filterByDelay,
    filterByTipoServicio,
    applyAdvancedFilters,
    applyActivityFilter,
    removeDuplicateMoviles,
    markInactiveMoviles,
    getMovilColorByOccupancy,
  };
}
