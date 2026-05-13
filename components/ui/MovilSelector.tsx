'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { MovilData, MovilFilters, ServiceFilters, PedidoFilters, PedidoSupabase, ServiceSupabase, CustomMarker, EmpresaFleteraSupabase } from '@/types';
import { computeDelayMinutes, getDelayInfo } from '@/utils/pedidoDelay';
import { getEstadoDescripcion, isPedidoEntregado, isServiceEntregado } from '@/utils/estadoPedido';
import { isMovilActiveForUI } from '@/lib/moviles/visibility';
import clsx from 'clsx';
import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import FilterBar from './FilterBar';
import { VirtualList } from './VirtualList';
import MapGuideModal from './MapGuideModal';
import RealtimeDriftIndicator from '@/components/dashboard/RealtimeDriftIndicator';
import type { LastSyncState } from '@/lib/realtime-drift';
import { isWithinSaWindow } from '@/lib/sa-window-filter';

interface MovilSelectorProps {
  moviles: MovilData[];
  /** IDs de móviles "ocultos-pero-operativos" — se excluyen del colapsable de
   *  móviles y contadores, pero sus pedidos/services siguen visibles. */
  hiddenMovilIds?: Set<number>;
  selectedMoviles: number[];
  onToggleMovil: (movilId: number) => void;
  onSelectAll: () => void;
  onClearAll: () => void;
  pedidos?: PedidoSupabase[]; // Nueva prop para pedidos
  services?: ServiceSupabase[]; // Nueva prop para services
  onPedidoClick?: (pedidoId: number) => void; // Callback para click en pedido
  onServiceClick?: (serviceId: number) => void; // Callback para click en service
  puntosInteres?: CustomMarker[]; // Nueva prop para puntos de interés
  onPuntoInteresClick?: (puntoId: string) => void; // Callback para click en punto
  onFiltersChange?: (filters: MovilFilters) => void; // 🆕 Callback para comunicar filtros activos
  onOpenPedidosTable?: () => void; // Abrir modal de vista extendida de pedidos
  onOpenServicesTable?: () => void; // Abrir modal de vista extendida de services
  movilesHidden?: boolean; // Si los indicadores de móviles están ocultos en el mapa
  onToggleMovilesHidden?: () => void; // Toggle visibilidad de móviles en el mapa
  pedidosHidden?: boolean; // Si los indicadores de pedidos están ocultos en el mapa
  onTogglePedidosHidden?: () => void; // Toggle visibilidad de pedidos en el mapa
  servicesHidden?: boolean; // Si los indicadores de services están ocultos en el mapa
  onToggleServicesHidden?: () => void; // Toggle visibilidad de services en el mapa
  poisHidden?: boolean; // Si los POIs están ocultos en el mapa
  onTogglePoisHidden?: () => void; // Toggle visibilidad global de POIs
  hiddenPoiCategories?: Set<string>; // Categorías de POI ocultas
  onTogglePoiCategory?: (category: string) => void; // Toggle visibilidad de una categoría de POI
  selectedPois?: Set<string>; // IDs de POIs seleccionados (visibles en mapa)
  onTogglePoi?: (id: string) => void; // Toggle individual de un POI
  onSelectCategoryPois?: (ids: string[]) => void; // Seleccionar todos los POIs de una categoría
  onClearCategoryPois?: (ids: string[]) => void; // Deseleccionar todos los POIs de una categoría
  pedidosFilters?: PedidoFilters; // Filtros de pedidos (lifted)
  onPedidosFiltersChange?: (filters: PedidoFilters) => void; // Callback para cambios en filtros de pedidos
  servicesFilters?: ServiceFilters; // Filtros de services (lifted)
  onServicesFiltersChange?: (filters: ServiceFilters) => void; // Callback para cambios en filtros de services
  tiposServicio?: string[]; // Tipos de servicio dinámicos desde moviles_zonas
  onOpenRanking?: () => void; // Abrir modal de ranking de móviles
  onOpenTracking?: () => void; // Abrir modal de ver recorrido de un móvil
  // Empresa fletera props
  empresas?: EmpresaFleteraSupabase[];
  selectedEmpresas?: number[];
  onEmpresasChange?: (ids: number[]) => void;
  showEmpresaSelector?: boolean;
  /** Si true, se ocultan los pedidos/services sin móvil asignado en el
   *  colapsable de pedidos. Calculado por el parent en base al perfil del
   *  usuario (no-root con restricción) + filtro manual de empresas. */
  hideUnassigned?: boolean;
  /** True si el usuario tiene `allowedEmpresas` (no-root, no-despacho). En ese
   *  caso el badge de empresas NUNCA dice "Todas" — siempre lista los nombres
   *  de las empresas asignadas, igual que cuando un root/despacho filtra
   *  manualmente. "Todas" implicaría el set global de empresas y eso no es
   *  lo que un user restringido ve. */
  isRestrictedUser?: boolean;
  /** True para usuarios root / despacho / supervisor / dashboards: se les
   *  muestran tambien los pedidos sin movil y los de moviles fuera del panel
   *  aunque el filtro de empresas sea parcial. */
  privilegedUser?: boolean;
  /** Instrumentacion de drift: true si user?.isRoot === 'S'. Gating estricto — comparacion literal. */
  isRootUser?: boolean;
  /** Estado del ultimo sync de posiciones (null si nunca sincronizo). Solo visible si isRootUser. */
  lastSync?: LastSyncState | null;
  /** Callback para el boton Resync ahora (llama fetchPositions directamente). */
  onResync?: () => void;
  /** Hora del servidor (sincronizada). Usada para el filtro de ventana SA. */
  serverNow?: Date;
  /** Minutos antes del FchHoraPara en que un SA es visible. null = sin filtro. */
  minutosAntesSa?: number | null;
  /** Segundos de polling configurados (para calcular umbrales 🟢🟡🔴). Default 60. */
  pollingSeconds?: number;
}

// Definir las categorías del árbol
type CategoryKey = 'empresas' | 'moviles' | 'pedidos' | 'services' | 'pois';

interface Category {
  key: CategoryKey;
  title: string;
  icon: string;
  count: number;
}

export default function MovilSelector({
  moviles,
  hiddenMovilIds,
  selectedMoviles,
  onToggleMovil,
  onSelectAll,
  onClearAll,
  pedidos = [],
  services = [],
  onPedidoClick,
  onServiceClick,
  puntosInteres = [],
  onPuntoInteresClick,
  onFiltersChange, // 🆕 Recibir el callback
  onOpenPedidosTable,
  onOpenServicesTable,
  movilesHidden = false,
  onToggleMovilesHidden,
  pedidosHidden = false,
  onTogglePedidosHidden,
  servicesHidden = false,
  onToggleServicesHidden,
  poisHidden = false,
  onTogglePoisHidden,
  hiddenPoiCategories = new Set(),
  onTogglePoiCategory,
  selectedPois,
  onTogglePoi,
  onSelectCategoryPois,
  onClearCategoryPois,
  pedidosFilters: pedidosFiltersProp,
  onPedidosFiltersChange,
  servicesFilters: servicesFiltersProp,
  onServicesFiltersChange,
  tiposServicio = [],
  onOpenRanking,
  onOpenTracking,
  empresas = [],
  selectedEmpresas = [],
  onEmpresasChange,
  showEmpresaSelector = false,
  hideUnassigned = false,
  isRestrictedUser = false,
  privilegedUser = false,
  isRootUser = false,
  lastSync = null,
  onResync,
  serverNow = new Date(),
  minutosAntesSa = null,
  pollingSeconds = 60,
}: MovilSelectorProps) {
  const [expandedCategories, setExpandedCategories] = useState<Set<CategoryKey>>(new Set(['moviles']));
  const [guideCategory, setGuideCategory] = useState<CategoryKey | null>(null);
  
  // Ref para calcular altura del contenedor virtual  
  const listContainerRef = useRef<HTMLDivElement>(null);
  
  // Estados de búsqueda por categoría
  const [movilesSearch, setMovilesSearch] = useState('');
  const [pedidosSearch, setPedidosSearch] = useState('');
  const [servicesSearch, setServicesSearch] = useState('');
  const [poisSearch, setPoisSearch] = useState('');

  // Estado para sub-categorías expandidas dentro de POIs
  const [expandedPoiCategories, setExpandedPoiCategories] = useState<Set<string>>(new Set());

  // Agrupar POIs por campo categoria (con fallback a prefijo [Label] en observacion)
  const poiByCategory = useMemo(() => {
    const groups: Record<string, { label: string; icono: string; items: CustomMarker[] }> = {};
    const uncategorized: CustomMarker[] = [];
    for (const poi of puntosInteres) {
      // Primero intentar campo categoria, luego prefijo [Cat] en observacion
      const cat = poi.categoria?.trim()
        || poi.observacion?.match(/^\[([^\]]+)\]/)?.[1]
        || null;
      if (cat) {
        if (!groups[cat]) groups[cat] = { label: cat, icono: poi.icono, items: [] };
        groups[cat].items.push(poi);
      } else {
        uncategorized.push(poi);
      }
    }
    // Ordenar categorías alfabéticamente
    const sorted = Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
    if (uncategorized.length > 0) {
      sorted.push(['_sin_categoria', { label: 'Mis Puntos', icono: '📌', items: uncategorized }]);
    }
    return sorted;
  }, [puntosInteres]);

  const togglePoiSubCategory = useCallback((cat: string) => {
    setExpandedPoiCategories(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat); else next.add(cat);
      return next;
    });
  }, []);
  
  // Estados de filtros por categoría
  const [movilesFilters, setMovilesFilters] = useState<MovilFilters>({ 
    capacidad: 'all',
    estado: [], // Inicialmente ningún filtro de estado activo
    actividad: 'activo', // Por defecto mostrar solo activos
  });
  // Filtros de pedidos/services: usar props si vienen del padre, si no estado local (fallback)
  const [localServicesFilters, setLocalServicesFilters] = useState<ServiceFilters>({ atraso: [], tipoServicio: 'all', vista: 'pendientes', search: '', zona: null, movil: null, defecto: null, asignacion: 'todos', entrega: 'todos', soloSinCoords: false });
  const [localPedidosFilters, setLocalPedidosFilters] = useState<PedidoFilters>({ 
    atraso: [], 
    tipoServicio: [],
    vista: 'pendientes',
    search: '',
    zona: null,
    movil: null,
    producto: null,
    asignacion: 'todos',
    entrega: 'todos',
    soloSinCoords: false,
  });
  const servicesFilters = servicesFiltersProp ?? localServicesFilters;
  const pedidosFilters = pedidosFiltersProp ?? localPedidosFilters;
  const setServicesFilters = useCallback((updater: ServiceFilters | ((prev: ServiceFilters) => ServiceFilters)) => {
    const next = typeof updater === 'function' ? updater(servicesFilters) : updater;
    if (onServicesFiltersChange) onServicesFiltersChange(next);
    else setLocalServicesFilters(next);
  }, [servicesFilters, onServicesFiltersChange]);
  const setPedidosFilters = useCallback((updater: PedidoFilters | ((prev: PedidoFilters) => PedidoFilters)) => {
    const next = typeof updater === 'function' ? updater(pedidosFilters) : updater;
    if (onPedidosFiltersChange) onPedidosFiltersChange(next);
    else setLocalPedidosFilters(next);
  }, [pedidosFilters, onPedidosFiltersChange]);

  // 🆕 Notificar al padre cuando cambien los filtros de móviles
  useEffect(() => {
    if (onFiltersChange) {
      onFiltersChange(movilesFilters);
    }
  }, [movilesFilters, onFiltersChange]);

  // Filtrar y ordenar móviles
  const filteredMoviles = useMemo(() => {
    let result = [...moviles];
    
    // Filtrar por búsqueda
    if (movilesSearch.trim()) {
      const searchLower = movilesSearch.toLowerCase();
      result = result.filter(movil => 
        movil.id.toString().includes(searchLower) ||
        movil.name.toLowerCase().includes(searchLower) ||
        (movil.matricula && movil.matricula.toLowerCase().includes(searchLower))
      );
    }
    
    // 🔥 Filtrar por capacidad (tamano_lote)
    if (movilesFilters.capacidad !== 'all') {
      result = result.filter(movil => {
        const capacidad = movil.tamanoLote || 0;
        switch (movilesFilters.capacidad) {
          case '1-3': return capacidad >= 1 && capacidad <= 3;
          case '4-6': return capacidad >= 4 && capacidad <= 6;
          case '7-10': return capacidad >= 7 && capacidad <= 10;
          case '10+': return capacidad > 10;
          default: return true;
        }
      });
    }
    
    // 🆕 Filtrar por actividad (estado_nro: 0,1,2=ACTIVO | 3=NO ACTIVO)
    {
      result = result.filter(movil => {
        const estadoNro = movil.estadoNro;
        const esActivo = isMovilActiveForUI(estadoNro);
        if (movilesFilters.actividad === 'activo') return esActivo;
        if (movilesFilters.actividad === 'no_activo') return estadoNro === 3;
        return true;
      });
    }

    // Excluir móviles "ocultos pero operativos" del colapsable de móviles
    if (hiddenMovilIds && hiddenMovilIds.size > 0) {
      result = result.filter(movil => !hiddenMovilIds.has(movil.id));
    }
    
    // 🆕 Filtrar por estado (multi-selección)
    if (movilesFilters.estado.length > 0) {
      result = result.filter(movil => {
        const tamanoLote = movil.tamanoLote || 6;
        const capacidad = movil.capacidad ?? 0;
        
        // Verificar cada estado seleccionado
        return movilesFilters.estado.some(estado => {
          switch (estado) {
            case 'no_reporta_gps':
              // Móviles sin posición o inactivos
              return !movil.currentPosition || movil.isInactive;
            
            case 'baja_momentanea':
              // Móviles con baja momentánea (estado_nro 4)
              return movil.estadoNro === 4;
            
            case 'con_capacidad':
              // Móviles con capacidad disponible (> 0%) — usa capacidad de la DB
              return tamanoLote > 0 && capacidad < tamanoLote;
            
            case 'sin_capacidad':
              // Móviles sin capacidad: lote completo (4/4) o sobrepasado (6/4).
              // Mismo criterio que loteCompleto en el item del colapsable y el
              // color negro del marker en el mapa.
              return (movil.tamanoLote ?? 0) > 0 && (movil.capacidad ?? 0) >= (movil.tamanoLote ?? 0);
            
            default:
              return true;
          }
        });
      });
    }
    
    // Ordenar por número de móvil (ascendente)
    return result.sort((a, b) => a.id - b.id);
  }, [moviles, movilesSearch, movilesFilters, hiddenMovilIds]);

  // allSelected (alcance "colapsable"): se usa para el botón "Seleccionar/
  // Deseleccionar todos" del panel y refleja si todos los visibles del filtro
  // local (search + filtros del colapsable) están marcados.
  const allSelected = filteredMoviles.length > 0 && filteredMoviles.every(m => selectedMoviles.includes(m.id));

  // allEmpresasSelected: true cuando el usuario tiene seleccionadas todas las
  // empresas disponibles (o cuando no tiene multi-empresa selector — caso
  // distribuidor con 1 sola empresa). Si el usuario tiene multi-empresa pero
  // deseleccionó algunas, esto es false → "Todos" no aplica aunque marque
  // todos los móviles visibles, porque hay empresas excluidas.
  const allEmpresasSelected = !showEmpresaSelector
    || !empresas
    || empresas.length === 0
    || (selectedEmpresas?.length ?? 0) === empresas.length;

  // allMovilesSelected (semántica estricta — guard de canSeeUnassigned y huérfanos):
  // true SOLO cuando (a) todas las empresas del universo están seleccionadas Y
  // (b) todos los móviles operativos están en selectedMoviles. Si hay filtro parcial
  // de empresa, retorna false aun cuando el usuario haya tildado todo lo visible —
  // porque los huérfanos podrían corresponder a empresas excluidas y no se deben mostrar.
  // Usado para: canSeeUnassigned (filteredPedidos + filteredServices).
  const allMovilesSelected = useMemo(() => {
    if (!allEmpresasSelected) return false;
    const operativos = hiddenMovilIds && hiddenMovilIds.size > 0
      ? moviles.filter(m => !hiddenMovilIds.has(m.id))
      : moviles;
    return operativos.length > 0 && operativos.every(m => selectedMoviles.includes(m.id));
  }, [moviles, selectedMoviles, hiddenMovilIds, allEmpresasSelected]);

  // allVisibleOperativosSelected (semántica relajada — label del badge):
  // true cuando todos los móviles operativos VISIBLES (post filtro de empresa) están
  // en selectedMoviles. Usado SOLO para el label "Móviles: Todos" del badge — refleja
  // lo que el usuario ve y operó. NO tiene impacto en canSeeUnassigned ni en visibilidad
  // de huérfanos. No depende de allEmpresasSelected.
  const allVisibleOperativosSelected = useMemo(() => {
    // Usar filteredMoviles (lista visible del colapsable, post activity+capacity+
    // advanced filters + hidden) en vez de moviles raw. Esto asegura que "Todos"
    // refleje SOLO los items visibles, no inactivos/filtrados-out que el usuario
    // no ve.
    return filteredMoviles.length > 0 && filteredMoviles.every(m => selectedMoviles.includes(m.id));
  }, [filteredMoviles, selectedMoviles]);

  // Filtrar y ordenar pedidos (pendientes o finalizados según vista)
  const filteredPedidos = useMemo(() => {
    let result = [...pedidos];
    
    // Filtrar según vista: pendientes (estado 1, asignados + sin asignar), finalizados (estado 2)
    if (pedidosFilters.vista === 'finalizados') {
      result = result.filter(pedido => Number(pedido.estado_nro) === 2);
    } else {
      // pendientes: todos estado 1
      result = result.filter(pedido => Number(pedido.estado_nro) === 1);
    }
    
    // Usar el flag que baja del parent. Incluye (a) user no-root con restricción
    // de empresas y (b) filtro manual parcial de empresas.
    const isPartialEmpresa = hideUnassigned;

    // Los sin asignar y los de móviles ocultos-pero-operativos solo son
    // visibles para usuarios privilegiados cuando TODOS los móviles operativos
    // del universo están seleccionados Y todas las empresas están seleccionadas
    // (alcance global, no del colapsable). Si el usuario filtró a un subset de
    // empresas, los sin asignar no aplican porque podrían corresponder a
    // empresas excluidas.
    const canSeeUnassigned = privilegedUser && allMovilesSelected;

    // FILTRO: Si hay móviles seleccionados, mostrar solo pedidos de esos móviles
    if (selectedMoviles.length > 0) {
      result = result.filter(pedido => {
        if (!pedido.movil || Number(pedido.movil) === 0) return canSeeUnassigned;
        // Cuando todos los móviles del colapsable están seleccionados y el usuario
        // es privilegiado, también pasan los pedidos de móviles ocultos (no activos
        // pero con operativa). Si solo hay un subset seleccionado, NO pasan.
        if (canSeeUnassigned && hiddenMovilIds && hiddenMovilIds.has(Number(pedido.movil))) return true;
        return selectedMoviles.some(id => Number(id) === Number(pedido.movil));
      });
    } else if (privilegedUser && !isPartialEmpresa) {
      // Privilegiado SIN móviles seleccionados (handleClearAll) y empresas
      // completas: vista "solo sin asignar". Mostramos exclusivamente pedidos
      // sin móvil — los asignados quedan ocultos hasta que el usuario seleccione.
      result = result.filter(pedido => !pedido.movil || Number(pedido.movil) === 0);
    } else if (isPartialEmpresa && !privilegedUser) {
      // Sin móviles seleccionados pero empresa parcial: ocultar sin asignar
      // y también los pedidos (incl. entregados) que NO pertenezcan a los
      // móviles de las empresas del usuario. `moviles` ya viene filtrado
      // por empresa desde el dashboard. Incluir también los IDs ocultos-pero-
      // operativos: sus pedidos igual se ven.
      // Nota: usuarios privilegiados (root/despacho/supervisor/dashboards) omiten
      // este bloque y ven todos los pedidos incluyendo sin asignar.
      const validMovilIds = new Set(moviles.map(m => Number(m.id)));
      if (hiddenMovilIds) hiddenMovilIds.forEach(id => validMovilIds.add(id));
      result = result.filter(pedido => {
        if (!pedido.movil || Number(pedido.movil) === 0) return false;
        return validMovilIds.has(Number(pedido.movil));
      });
    }
    
    // Filtrar por búsqueda
    if (pedidosSearch.trim()) {
      const searchLower = pedidosSearch.toLowerCase();
      result = result.filter(pedido => 
        pedido.id.toString().includes(searchLower) ||
        (pedido.servicio_nombre && pedido.servicio_nombre.toLowerCase().includes(searchLower)) ||
        (pedido.cliente_tel && pedido.cliente_tel.includes(searchLower))
      );
    }
    
    // Filtrar por tipo de servicio (solo para pendientes y sin_asignar)
    if (pedidosFilters.vista !== 'finalizados' && pedidosFilters.tipoServicio.length > 0) {
      result = result.filter(pedido =>
        pedido.servicio_nombre && pedidosFilters.tipoServicio.includes(pedido.servicio_nombre)
      );
    }
    
    // Filtrar por atraso (solo para pendientes y sin_asignar)
    if (pedidosFilters.vista !== 'finalizados' && pedidosFilters.atraso.length > 0) {
      result = result.filter(pedido => {
        const delayMins = computeDelayMinutes(pedido.fch_hora_max_ent_comp);
        const info = getDelayInfo(delayMins);
        const categoryMap: Record<string, string> = {
          'En Hora': 'en_hora',
          'Hora Límite Cercana': 'limite_cercana',
          'Atrasado': 'atrasado',
          'Muy Atrasado': 'muy_atrasado',
          'Sin hora': 'sin_hora',
        };
        const category = categoryMap[info.label] || 'sin_hora';
        return pedidosFilters.atraso.includes(category);
      });
    }

    // Filtros del modal extendido
    if (pedidosFilters.zona !== null) {
      result = result.filter(pedido => pedido.zona_nro === pedidosFilters.zona);
    }
    if (pedidosFilters.movil !== null) {
      result = result.filter(pedido => Number(pedido.movil) === pedidosFilters.movil);
    }
    if (pedidosFilters.producto !== null) {
      result = result.filter(pedido => pedido.producto_nom === pedidosFilters.producto);
    }
    if (pedidosFilters.asignacion === 'con_movil') {
      result = result.filter(pedido => pedido.movil && Number(pedido.movil) !== 0);
    } else if (pedidosFilters.asignacion === 'sin_movil') {
      result = result.filter(pedido => !pedido.movil || Number(pedido.movil) === 0);
    }
    if (pedidosFilters.entrega === 'entregados') {
      result = result.filter(pedido => isPedidoEntregado(pedido));
    } else if (pedidosFilters.entrega === 'no_entregados') {
      result = result.filter(pedido => !isPedidoEntregado(pedido));
    }
    if (pedidosFilters.soloSinCoords) {
      result = result.filter(pedido => !pedido.latitud || !pedido.longitud);
    }
    if (pedidosFilters.search) {
      const sq = pedidosFilters.search.toLowerCase();
      result = result.filter(pedido =>
        pedido.id.toString().includes(sq) ||
        (pedido.servicio_nombre && pedido.servicio_nombre.toLowerCase().includes(sq)) ||
        (pedido.cliente_tel && pedido.cliente_tel.includes(sq))
      );
    }
    
    // Aplicar ventana temporal SA (solo para pendientes, no finalizados)
    if (pedidosFilters.vista !== "finalizados") {
      result = result.filter(p =>
        (p.movil && Number(p.movil) !== 0) ||
        isWithinSaWindow(p.fch_hora_para, serverNow, minutosAntesSa)
      );
    }

    // Ordenar: pendientes/sin_asignar por mayor atraso primero, finalizados por id desc
    if (pedidosFilters.vista !== 'finalizados') {
      result.sort((a, b) => {
        const delayA = computeDelayMinutes(a.fch_hora_max_ent_comp);
        const delayB = computeDelayMinutes(b.fch_hora_max_ent_comp);
        if (delayA === null && delayB === null) return 0;
        if (delayA === null) return 1;
        if (delayB === null) return -1;
        return delayA - delayB;
      });
    } else {
      result.sort((a, b) => Number(b.id) - Number(a.id));
    }

    return result;
}, [pedidos, pedidosSearch, pedidosFilters, selectedMoviles, moviles, selectedEmpresas, empresas, hiddenMovilIds, hideUnassigned, privilegedUser, allMovilesSelected, serverNow, minutosAntesSa]);

  // Filtrar y ordenar services (pendientes o finalizados según vista)
  const filteredServices = useMemo(() => {
    let result = [...services];
    
    // Filtrar según vista: pendientes (estado 1, asignados + sin asignar), finalizados (estado 2)
    if (servicesFilters.vista === 'finalizados') {
      result = result.filter(service => Number(service.estado_nro) === 2);
    } else {
      // pendientes: todos estado 1
      result = result.filter(service => Number(service.estado_nro) === 1);
    }
    
    // Si el filtro de empresa es parcial (no todas y no ninguna), ocultar sin asignar
    // Mismo criterio que para pedidos: el parent calcula y baja el flag.
    const isPartialEmpresaSvc = hideUnassigned;

    // Sin asignar y de móviles ocultos solo visibles para privilegiados cuando
    // todas las empresas + todos los móviles están seleccionados. Mismo
    // criterio que en filteredPedidos: usa allMovilesSelected (incluye gating
    // por empresa).
    const canSeeUnassignedSvc = privilegedUser && allMovilesSelected;

    if (selectedMoviles.length > 0) {
      result = result.filter(service => {
        if (!service.movil || Number(service.movil) === 0) return canSeeUnassignedSvc;
        // Mismo criterio que pedidos: móviles ocultos pasan cuando todos seleccionados y usuario privilegiado
        if (canSeeUnassignedSvc && hiddenMovilIds && hiddenMovilIds.has(Number(service.movil))) return true;
        return selectedMoviles.some(id => Number(id) === Number(service.movil));
      });
    } else if (privilegedUser && !isPartialEmpresaSvc) {
      // Privilegiado SIN móviles seleccionados y empresas completas: vista
      // "solo sin asignar". Mostramos exclusivamente services sin móvil.
      result = result.filter(service => !service.movil || Number(service.movil) === 0);
    } else if (isPartialEmpresaSvc && !privilegedUser) {
      // Sin móviles seleccionados pero empresa parcial: restringir también a los
      // services (incl. finalizados) cuyos móviles estén dentro del set del user.
      // Incluir también los IDs ocultos-pero-operativos.
      // Nota: usuarios privilegiados omiten este bloque.
      const validMovilIds = new Set(moviles.map(m => Number(m.id)));
      if (hiddenMovilIds) hiddenMovilIds.forEach(id => validMovilIds.add(id));
      result = result.filter(service => {
        if (!service.movil || Number(service.movil) === 0) return false;
        return validMovilIds.has(Number(service.movil));
      });
    }
    
    // Filtrar por búsqueda
    if (servicesSearch.trim()) {
      const searchLower = servicesSearch.toLowerCase();
      result = result.filter(service => 
        service.id.toString().includes(searchLower) ||
        (service.defecto && service.defecto.toLowerCase().includes(searchLower)) ||
        (service.cliente_nombre && service.cliente_nombre.toLowerCase().includes(searchLower)) ||
        (service.cliente_tel && service.cliente_tel.includes(searchLower))
      );
    }
    
    // Filtrar por tipo de servicio (solo para pendientes y sin_asignar)
    if (servicesFilters.vista !== 'finalizados' && servicesFilters.tipoServicio && servicesFilters.tipoServicio !== 'all') {
      const tipoUpper = servicesFilters.tipoServicio.toUpperCase();
      result = result.filter(service => 
        service.servicio_nombre && service.servicio_nombre.toUpperCase() === tipoUpper
      );
    }
    
    // Filtrar por atraso (solo para pendientes y sin_asignar)
    if (servicesFilters.vista !== 'finalizados' && servicesFilters.atraso.length > 0) {
      result = result.filter(service => {
        const delayMins = computeDelayMinutes(service.fch_hora_max_ent_comp);
        const info = getDelayInfo(delayMins);
        const categoryMap: Record<string, string> = {
          'En Hora': 'en_hora',
          'Hora Límite Cercana': 'limite_cercana',
          'Atrasado': 'atrasado',
          'Muy Atrasado': 'muy_atrasado',
          'Sin hora': 'sin_hora',
        };
        const category = categoryMap[info.label] || 'sin_hora';
        return servicesFilters.atraso.includes(category);
      });
    }

    // Filtros del modal extendido
    if (servicesFilters.zona !== null) {
      result = result.filter(service => service.zona_nro === servicesFilters.zona);
    }
    if (servicesFilters.movil !== null) {
      result = result.filter(service => Number(service.movil) === servicesFilters.movil);
    }
    if (servicesFilters.defecto !== null) {
      result = result.filter(service => service.defecto === servicesFilters.defecto);
    }
    if (servicesFilters.asignacion === 'con_movil') {
      result = result.filter(service => service.movil && Number(service.movil) !== 0);
    } else if (servicesFilters.asignacion === 'sin_movil') {
      result = result.filter(service => !service.movil || Number(service.movil) === 0);
    }
    if (servicesFilters.entrega === 'entregados') {
      result = result.filter(service => isServiceEntregado(service));
    } else if (servicesFilters.entrega === 'no_entregados') {
      result = result.filter(service => !isServiceEntregado(service));
    }
    if (servicesFilters.soloSinCoords) {
      result = result.filter(service => !service.latitud || !service.longitud);
    }
    if (servicesFilters.search) {
      const sq = servicesFilters.search.toLowerCase();
      result = result.filter(service =>
        service.id.toString().includes(sq) ||
        (service.defecto && service.defecto.toLowerCase().includes(sq)) ||
        (service.cliente_nombre && service.cliente_nombre.toLowerCase().includes(sq)) ||
        (service.cliente_tel && service.cliente_tel.includes(sq))
      );
    }
    
    // Aplicar ventana temporal SA (solo para pendientes, no finalizados)
    if (servicesFilters.vista !== "finalizados") {
      result = result.filter(s =>
        (s.movil && Number(s.movil) !== 0) ||
        isWithinSaWindow(s.fch_hora_para, serverNow, minutosAntesSa)
      );
    }

    // Ordenar: pendientes/sin_asignar por delay, finalizados por id desc
    if (servicesFilters.vista !== 'finalizados') {
      result.sort((a, b) => {
        const delayA = computeDelayMinutes(a.fch_hora_max_ent_comp);
        const delayB = computeDelayMinutes(b.fch_hora_max_ent_comp);
        if (delayA === null && delayB === null) return 0;
        if (delayA === null) return 1;
        if (delayB === null) return -1;
        return delayA - delayB;
      });
    } else {
      result.sort((a, b) => Number(b.id) - Number(a.id));
    }

    return result;
}, [services, servicesSearch, servicesFilters, selectedMoviles, moviles, selectedEmpresas, empresas, hiddenMovilIds, hideUnassigned, privilegedUser, allMovilesSelected, serverNow, minutosAntesSa]);

  // Estado de búsqueda para empresas
  const [empresaSearch, setEmpresaSearch] = useState('');
  const filteredEmpresas = useMemo(() => {
    if (!empresaSearch.trim()) return empresas;
    const q = empresaSearch.toLowerCase();
    return empresas.filter(e => e.nombre.toLowerCase().includes(q));
  }, [empresas, empresaSearch]);

  // Categorías disponibles
  const categories: Category[] = [
    ...(showEmpresaSelector ? [{ key: 'empresas' as CategoryKey, title: 'Empresa Fletera', icon: '🏢', count: selectedEmpresas.length }] : []),
    { key: 'moviles', title: 'Móviles', icon: '🚗', count: filteredMoviles.length },
    { key: 'pedidos', title: 'Pedidos', icon: '📦', count: filteredPedidos.length },
    { key: 'services', title: 'Services', icon: '🔧', count: filteredServices.length },
    { key: 'pois', title: 'Puntos de Interés', icon: '📍', count: puntosInteres.length },
  ];

  const toggleCategory = (categoryKey: CategoryKey) => {
    // Si la categoría ya está abierta, cerrarla (toggle)
    if (expandedCategories.has(categoryKey)) {
      setExpandedCategories(new Set()); // Cerrar todas
    } else {
      setExpandedCategories(new Set([categoryKey])); // Abrir solo esta categoría
    }
  };

  // Determinar qué categoría está activa (puede ser null si todas están cerradas)
  const activeCategory = Array.from(expandedCategories)[0] || null;

  // Obtener filtros contextuales según la categoría activa
  const getContextualFilters = () => {
    switch (activeCategory) {
      case 'moviles':
        return {
          searchValue: movilesSearch,
          onSearchChange: setMovilesSearch,
          searchPlaceholder: 'Buscar móvil por número...',
          filters: [], // ✅ Quitamos el filtro de capacidad
          onFilterChange: () => {}, // No hay filtros normales
        };

      case 'services':
        return {
          searchValue: servicesSearch,
          onSearchChange: setServicesSearch,
          searchPlaceholder: 'Buscar service...',
          filters: [],
          multiSelectFilters: [],
          onFilterChange: () => {},
          onMultiSelectFilterChange: () => {},
        };

      case 'pedidos':
        return {
          searchValue: pedidosSearch,
          onSearchChange: setPedidosSearch,
          searchPlaceholder: 'Buscar pedido...',
          filters: [],
          multiSelectFilters: [],
          onFilterChange: () => {},
          onMultiSelectFilterChange: () => {},
        };

      case 'pois':
        return {
          searchValue: poisSearch,
          onSearchChange: setPoisSearch,
          searchPlaceholder: 'Buscar punto de interés...',
          filters: [],
          onFilterChange: () => {}
        };

      default:
        return {
          searchValue: '',
          onSearchChange: () => {},
          searchPlaceholder: 'Buscar...',
          filters: [],
          onFilterChange: () => {}
        };
    }
  };

  const contextualFilters = getContextualFilters();

  return (
    <div className="bg-white rounded-xl shadow-lg p-6 h-full flex flex-col">

      {/* Badges de filtros activos - siempre visibles */}
      {(() => {
        const badges: { label: string; color?: string; onClear?: () => void }[] = [];

        // Badge de estado de actividad (solo cuando NO es el default 'activo')
        if (movilesFilters.actividad && movilesFilters.actividad !== 'activo') {
          const actividadLabels: Record<string, { label: string; icon: string; color: string }> = {
            'no_activo': { label: 'No Activos', icon: '🔴', color: 'bg-red-100 text-red-700' },
          };
          const actInfo = actividadLabels[movilesFilters.actividad];
          if (actInfo) badges.push({
            label: `${actInfo.icon} Estado: ${actInfo.label}`,
            color: actInfo.color,
            onClear: () => setMovilesFilters(prev => ({ ...prev, actividad: 'activo' })),
          });
        }

        // Badge de móviles seleccionados.
        // "Todos" cuando todos los móviles operativos VISIBLES están seleccionados —
        // usa `allVisibleOperativosSelected` (semántica relajada: no requiere todas
        // las empresas, solo refleja lo que el usuario ve en el colapsable).
        // La lista de IDs mostrada y el contador +N se calculan SOLO sobre la
        // intersección con `filteredMoviles` (lista visible del colapsable post
        // activity/capacity/advanced/hidden filters). selectedMoviles puede
        // contener IDs de móviles que se filtraron out (ej. inactivos cuando
        // `actividad='activo'`, o móviles residuales de una empresa anterior) que
        // el usuario no ve — esos no deben aparecer en el badge.
        {
          const visibleSet = new Set(filteredMoviles.map(m => m.id));
          const visibleSelectedIds = selectedMoviles.filter(id => visibleSet.has(id));
          const noneSelected = visibleSelectedIds.length === 0;
          const VISIBLE_IDS = 5;
          badges.push({
            label: allVisibleOperativosSelected
              ? '🚗 Móviles: Todos'
              : noneSelected
              ? '🚗 Móviles: Ninguno'
              : `🚗 Móviles: ${visibleSelectedIds.length <= VISIBLE_IDS
                  ? visibleSelectedIds.join(', ')
                  : `${visibleSelectedIds.slice(0, VISIBLE_IDS).join(', ')} +${visibleSelectedIds.length - VISIBLE_IDS}`}`,
            color: 'bg-indigo-100 text-indigo-700',
            onClear: allVisibleOperativosSelected ? undefined : onSelectAll,
          });
        }

        // Badge de empresas fleteras seleccionadas
        if (showEmpresaSelector && empresas.length > 0) {
          if (selectedEmpresas.length === 0) {
            // Ninguna empresa seleccionada — badge explícito "Empresas: Ninguna"
            badges.push({
              label: '🏢 Empresas: Ninguna',
              color: 'bg-amber-100 text-amber-700',
              // X dispara seleccionar todas (equivalente al click "Todas")
              onClear: onEmpresasChange
                ? () => onEmpresasChange(empresas.map(e => e.empresa_fletera_id))
                : undefined,
            });
          } else {
            const allSelected = selectedEmpresas.length === empresas.length;
            const selectedNames = empresas
              .filter(e => selectedEmpresas.includes(e.empresa_fletera_id))
              .map(e => e.nombre);
            // Para users restringidos (no-root/no-despacho con allowedEmpresas),
            // "Todas" sería engañoso porque el set ya viene pre-filtrado a sus
            // empresas asignadas — siempre listamos los nombres como cuando un
            // root/despacho filtra manualmente.
            const showNamesAlways = isRestrictedUser;
            const namesLabel = `🏢 Empresas: ${selectedNames.length <= 2 ? selectedNames.join(', ') : `${selectedNames.slice(0, 2).join(', ')} +${selectedNames.length - 2}`}`;
            badges.push({
              label: allSelected && !showNamesAlways
                ? '🏢 Empresas: Todas'
                : namesLabel,
              color: 'bg-amber-100 text-amber-700',
              onClear: !allSelected && onEmpresasChange
                ? () => onEmpresasChange(empresas.map(e => e.empresa_fletera_id))
                : undefined,
            });
          }
        }
        
        // Badge de filtros activos en PEDIDOS
        {
          const pCount = (pedidosFilters.vista !== 'pendientes' ? 1 : 0)
            + pedidosFilters.tipoServicio.length
            + pedidosFilters.atraso.length
            + (pedidosFilters.search ? 1 : 0)
            + (pedidosFilters.zona !== null ? 1 : 0)
            + (pedidosFilters.movil !== null ? 1 : 0)
            + (pedidosFilters.producto !== null ? 1 : 0)
            + (pedidosFilters.asignacion !== 'todos' ? 1 : 0)
            + (pedidosFilters.entrega !== 'todos' ? 1 : 0)
            + (pedidosFilters.soloSinCoords ? 1 : 0);
          badges.push({
            label: pCount === 0 ? '📦 Pedidos: Todos' : `📦 Pedidos: ${pCount} Filtro${pCount !== 1 ? 's' : ''}`,
            color: pCount === 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700 animate-pulse',
            onClear: pCount > 0 ? () => setPedidosFilters({ atraso: [], tipoServicio: [], vista: 'pendientes', search: '', zona: null, movil: null, producto: null, asignacion: 'todos', entrega: 'todos', soloSinCoords: false }) : undefined,
          });
        }

        // Badge de filtros activos en SERVICES
        {
          const sCount = (servicesFilters.vista !== 'pendientes' ? 1 : 0)
            + (servicesFilters.tipoServicio !== 'all' ? 1 : 0)
            + servicesFilters.atraso.length
            + (servicesFilters.search ? 1 : 0)
            + (servicesFilters.zona !== null ? 1 : 0)
            + (servicesFilters.movil !== null ? 1 : 0)
            + (servicesFilters.defecto !== null ? 1 : 0)
            + (servicesFilters.asignacion !== 'todos' ? 1 : 0)
            + (servicesFilters.entrega !== 'todos' ? 1 : 0)
            + (servicesFilters.soloSinCoords ? 1 : 0);
          badges.push({
            label: sCount === 0 ? '🔧 Services: Todos' : `🔧 Services: ${sCount} Filtro${sCount !== 1 ? 's' : ''}`,
            color: sCount === 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700 animate-pulse',
            onClear: sCount > 0 ? () => setServicesFilters({ atraso: [], tipoServicio: 'all', vista: 'pendientes', search: '', zona: null, movil: null, defecto: null, asignacion: 'todos', entrega: 'todos', soloSinCoords: false }) : undefined,
          });
        }

        // Badge de filtros de atraso de pedidos (ya incluido arriba en el count)
        // Badge de filtros de atraso de services (ya incluido arriba en el count)
        
        if (badges.length === 0) return null;
        
        return (
          <div className="flex flex-wrap gap-1 mb-3">
            {badges.map((badge, i) => (
              <span key={i} className={`text-xs px-2 py-1 rounded-full flex items-center gap-1 ${badge.color || 'bg-gray-100 text-gray-700'}`}>
                {badge.label}
                {badge.onClear && (
                  <button onClick={badge.onClear} className="ml-0.5 hover:opacity-70">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </span>
            ))}
          </div>
        );
      })()}
      
      {/* Buscador y Filtros Contextuales - Cambian según la categoría activa */}
      <AnimatePresence mode="wait">
        {expandedCategories.size > 0 && (
          <motion.div
            key={activeCategory}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="mb-4 overflow-hidden"
            id="tour-sidebar-filters"
          >
            {/* Barra de filtros con filtros avanzados integrados */}
            <FilterBar
              searchValue={contextualFilters.searchValue}
              onSearchChange={contextualFilters.onSearchChange}
              searchPlaceholder={contextualFilters.searchPlaceholder}
              filters={contextualFilters.filters}
              multiSelectFilters={(contextualFilters as any).multiSelectFilters}
              onFilterChange={contextualFilters.onFilterChange}
              onMultiSelectFilterChange={(contextualFilters as any).onMultiSelectFilterChange}
              customFilters={
                activeCategory === 'moviles' ? (
                  <div className="mt-3 pt-3 border-t border-gray-300">
                    {/* Combo "Estado de Actividad" removido — el filtro queda forzado al
                        default 'activo' en el state (ver useState `movilesFilters`). El
                        usuario decide que la UI no expone más ese toggle. */}

                    <h5 className="text-xs font-semibold text-gray-700 mb-2 flex items-center gap-2">
                      <svg className="w-4 h-4 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M3 3a1 1 0 011-1h12a1 1 0 011 1v3a1 1 0 01-.293.707L12 11.414V15a1 1 0 01-.293.707l-2 2A1 1 0 018 17v-5.586L3.293 6.707A1 1 0 013 6V3z" />
                      </svg>
                      Filtros Avanzados
                    </h5>
                    <div className="space-y-1">
                      {[
                        { value: 'no_reporta_gps', label: 'No reporta GPS', icon: '📡', color: 'text-red-600' },
                        { value: 'baja_momentanea', label: 'Baja Momentánea', icon: '⏸️', color: 'text-violet-600' },
                        { value: 'con_capacidad', label: 'Con Capacidad de Entrega', icon: '🟢', color: 'text-green-600' },
                        { value: 'sin_capacidad', label: 'Sin Capacidad de Entrega', icon: '⚫', color: 'text-gray-700' },
                      ].map((opcion) => {
                        const isChecked = movilesFilters.estado.includes(opcion.value);
                        return (
                          <label
                            key={opcion.value}
                            className={clsx(
                              "flex items-center gap-2 px-2 py-1 rounded-md cursor-pointer transition-all text-sm",
                              isChecked
                                ? "bg-blue-50 border border-blue-300"
                                : "hover:bg-gray-50"
                            )}
                          >
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={(e) => {
                                const newChecked = e.target.checked;
                                setMovilesFilters(prev => ({
                                  ...prev,
                                  estado: newChecked
                                    ? [...prev.estado, opcion.value]
                                    : prev.estado.filter(v => v !== opcion.value)
                                }));
                              }}
                              className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                            />
                            <span className="text-base">{opcion.icon}</span>
                            <span className={clsx("text-sm font-medium flex-1", opcion.color)}>
                              {opcion.label}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                    {(movilesFilters.estado.length > 0 || movilesFilters.actividad !== 'activo') && (
                      <button
                        onClick={() => setMovilesFilters(prev => ({ ...prev, estado: [], actividad: 'activo' }))}
                        className="mt-2 text-xs text-blue-600 hover:text-blue-800 font-medium"
                      >
                        Limpiar filtros avanzados
                      </button>
                    )}
                  </div>
                ) : undefined
              }
            />
            
            {activeCategory === 'moviles' && contextualFilters.searchValue && (
              <p className="text-xs text-gray-500 mt-2">
                {filteredMoviles.length} móvil(es) encontrado(s)
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
      
      {/* Estructura de árbol con categorías colapsables */}
      <div className="flex-1 overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-gray-100">
        <div className="space-y-2">
          {categories.map((category) => (
            <div key={category.key} id={`tour-category-${category.key}`} className="border border-gray-200 rounded-lg overflow-hidden">
              {/* Header de la categoría */}
              <button
                onClick={() => toggleCategory(category.key)}
                className="w-full flex items-center justify-between p-3 bg-gray-50 hover:bg-gray-100 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span className="text-lg">{category.icon}</span>
                  <span className="font-semibold text-gray-700">{category.title}</span>
                  {category.count > 0 && (
                    <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">
                      {category.count}
                    </span>
                  )}
                  {/* Indicador de drift de realtime — solo para usuarios root */}
                  {category.key === 'moviles' && isRootUser && (
                    <RealtimeDriftIndicator
                      lastSync={lastSync}
                      pollingSeconds={pollingSeconds}
                      onResync={onResync ?? (() => {})}
                    />
                  )}
                </div>
                <div className="flex items-center gap-1">
                  {/* Botón de vista extendida (pedidos) */}
                  {category.key === 'pedidos' && onOpenPedidosTable && (
                    <span
                      id="tour-pedidos-table-btn"
                      role="button"
                      tabIndex={0}
                      onClick={(e) => { e.stopPropagation(); onOpenPedidosTable(); }}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); onOpenPedidosTable(); } }}
                      className="p-1 rounded-full hover:bg-orange-100 transition-colors group"
                      title="Vista extendida de pedidos"
                    >
                      <svg className="w-4 h-4 text-gray-400 group-hover:text-orange-600 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M3 6h18M3 14h18M3 18h18" />
                      </svg>
                    </span>
                  )}

                  {/* Botón de vista extendida (services) */}
                  {category.key === 'services' && onOpenServicesTable && (
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => { e.stopPropagation(); onOpenServicesTable(); }}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); onOpenServicesTable(); } }}
                      className="p-1 rounded-full hover:bg-violet-100 transition-colors group"
                      title="Vista extendida de services"
                    >
                      <svg className="w-4 h-4 text-gray-400 group-hover:text-violet-600 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M3 6h18M3 14h18M3 18h18" />
                      </svg>
                    </span>
                  )}

                  {/* Botón de ver recorrido de un móvil */}
                  {category.key === 'moviles' && onOpenTracking && (
                    <span
                      id="tour-fab-tracking"
                      role="button"
                      tabIndex={0}
                      onClick={(e) => { e.stopPropagation(); onOpenTracking(); }}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); onOpenTracking(); } }}
                      className="p-1 rounded-full hover:bg-purple-100 transition-colors group"
                      title="Ver recorrido de un móvil"
                    >
                      <svg className="w-4 h-4 text-gray-400 group-hover:text-purple-600 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                      </svg>
                    </span>
                  )}

                  {/* Botón de ocultar/mostrar móviles en el mapa */}
                  {category.key === 'moviles' && onToggleMovilesHidden && (
                    <span
                      id="tour-eye-toggle"
                      role="button"
                      tabIndex={0}
                      onClick={(e) => { e.stopPropagation(); onToggleMovilesHidden(); }}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); onToggleMovilesHidden(); } }}
                      className={clsx(
                        'p-1 rounded-full transition-colors group',
                        movilesHidden ? 'hover:bg-green-100 bg-red-50' : 'hover:bg-blue-100'
                      )}
                      title={movilesHidden ? 'Mostrar móviles en el mapa' : 'Ocultar móviles del mapa'}
                    >
                      {movilesHidden ? (
                        <svg className="w-4 h-4 text-red-400 group-hover:text-green-600 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L3 3m6.878 6.878L21 21" />
                        </svg>
                      ) : (
                        <svg className="w-4 h-4 text-gray-400 group-hover:text-blue-600 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                        </svg>
                      )}
                    </span>
                  )}

                  {/* Botón de ocultar/mostrar pedidos en el mapa */}
                  {category.key === 'pedidos' && onTogglePedidosHidden && (
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => { e.stopPropagation(); onTogglePedidosHidden(); }}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); onTogglePedidosHidden(); } }}
                      className={clsx(
                        'p-1 rounded-full transition-colors group',
                        pedidosHidden ? 'hover:bg-green-100 bg-red-50' : 'hover:bg-blue-100'
                      )}
                      title={pedidosHidden ? 'Mostrar pedidos en el mapa' : 'Ocultar pedidos del mapa'}
                    >
                      {pedidosHidden ? (
                        <svg className="w-4 h-4 text-red-400 group-hover:text-green-600 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L3 3m6.878 6.878L21 21" />
                        </svg>
                      ) : (
                        <svg className="w-4 h-4 text-gray-400 group-hover:text-blue-600 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                        </svg>
                      )}
                    </span>
                  )}

                  {/* Botón de ocultar/mostrar services en el mapa */}
                  {category.key === 'services' && onToggleServicesHidden && (
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => { e.stopPropagation(); onToggleServicesHidden(); }}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); onToggleServicesHidden(); } }}
                      className={clsx(
                        'p-1 rounded-full transition-colors group',
                        servicesHidden ? 'hover:bg-green-100 bg-red-50' : 'hover:bg-blue-100'
                      )}
                      title={servicesHidden ? 'Mostrar services en el mapa' : 'Ocultar services del mapa'}
                    >
                      {servicesHidden ? (
                        <svg className="w-4 h-4 text-red-400 group-hover:text-green-600 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L3 3m6.878 6.878L21 21" />
                        </svg>
                      ) : (
                        <svg className="w-4 h-4 text-gray-400 group-hover:text-blue-600 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                        </svg>
                      )}
                    </span>
                  )}

                  {/* Botón de ocultar/mostrar POIs en el mapa */}
                  {category.key === 'pois' && onTogglePoisHidden && (
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => { e.stopPropagation(); onTogglePoisHidden(); }}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); onTogglePoisHidden(); } }}
                      className={clsx(
                        'p-1 rounded-full transition-colors group',
                        poisHidden ? 'hover:bg-green-100 bg-red-50' : 'hover:bg-blue-100'
                      )}
                      title={poisHidden ? 'Mostrar POIs en el mapa' : 'Ocultar POIs del mapa'}
                    >
                      {poisHidden ? (
                        <svg className="w-4 h-4 text-red-400 group-hover:text-green-600 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L3 3m6.878 6.878L21 21" />
                        </svg>
                      ) : (
                        <svg className="w-4 h-4 text-gray-400 group-hover:text-blue-600 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                        </svg>
                      )}
                    </span>
                  )}

                  {/* Botón de ayuda */}
                  {(category.key === 'moviles' || category.key === 'pedidos' || category.key === 'services') && (
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation();
                        setGuideCategory(category.key);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.stopPropagation();
                          setGuideCategory(category.key);
                        }
                      }}
                      className="p-1 rounded-full hover:bg-blue-100 transition-colors group"
                      title="Ver guía de indicadores"
                    >
                      <svg className="w-4 h-4 text-gray-400 group-hover:text-blue-600 transition-colors" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                      </svg>
                    </span>
                  )}
                  <svg
                    className={clsx(
                      'w-5 h-5 text-gray-500 transition-transform duration-200',
                      expandedCategories.has(category.key) && 'rotate-180'
                    )}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </button>

              {/* Contenido de la categoría */}
              <AnimatePresence>
                {expandedCategories.has(category.key) && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="p-3 bg-white border-t border-gray-200">
                      {/* Contenido según la categoría */}
                      {category.key === 'empresas' && onEmpresasChange && (
                        <div className="space-y-2">
                          {/* Barra de acciones */}
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-gray-600">{selectedEmpresas.length} de {empresas.length}</span>
                            <div className="flex gap-2">
                              <button onClick={() => onEmpresasChange(empresas.map(e => e.empresa_fletera_id))} className="text-xs text-blue-600 hover:text-blue-800 font-medium">Todas</button>
                              <button onClick={() => onEmpresasChange([])} className="text-xs text-gray-600 hover:text-gray-800 font-medium">Ninguna</button>
                            </div>
                          </div>
                          {/* Buscador */}
                          {empresas.length > 5 && (
                            <div className="relative">
                              <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                              </svg>
                              <input
                                type="text"
                                value={empresaSearch}
                                onChange={(e) => setEmpresaSearch(e.target.value)}
                                placeholder="Buscar empresa..."
                                className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-400"
                              />
                            </div>
                          )}
                          {/* Lista de empresas */}
                          <div className="max-h-56 overflow-y-auto space-y-0.5">
                            {filteredEmpresas.map((empresa) => (
                              <label
                                key={empresa.empresa_fletera_id}
                                className={clsx(
                                  'flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer text-sm transition-colors',
                                  selectedEmpresas.includes(empresa.empresa_fletera_id) ? 'bg-blue-50 border border-blue-200' : 'hover:bg-gray-50'
                                )}
                              >
                                <input
                                  type="checkbox"
                                  checked={selectedEmpresas.includes(empresa.empresa_fletera_id)}
                                  onChange={() => {
                                    if (selectedEmpresas.includes(empresa.empresa_fletera_id)) {
                                      onEmpresasChange(selectedEmpresas.filter(id => id !== empresa.empresa_fletera_id));
                                    } else {
                                      onEmpresasChange([...selectedEmpresas, empresa.empresa_fletera_id]);
                                    }
                                  }}
                                  className="w-4 h-4 rounded text-blue-600 flex-shrink-0"
                                />
                                <span className="font-medium text-gray-800 truncate">{empresa.nombre}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                      )}
                      {category.key === 'moviles' && (
                        <div className="space-y-2">
                          {/* Botón Seleccionar Todos */}
                          <button
                            onClick={allSelected ? onClearAll : onSelectAll}
                            className="w-full flex items-center gap-3 p-3 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors border border-blue-200"
                          >
                            <div className={clsx(
                              'flex items-center justify-center w-5 h-5 border-2 rounded transition-colors',
                              allSelected
                                ? 'bg-blue-500 border-blue-500'
                                : 'border-gray-300 bg-white'
                            )}>
                              {allSelected && (
                                <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
                                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                </svg>
                              )}
                            </div>
                            <span className="font-medium text-gray-700">
                              {allSelected ? 'Deseleccionar Todos' : 'Seleccionar Todos'}
                            </span>
                          </button>

                          {/* Lista de móviles */}
                          {filteredMoviles.map((movil) => {
                            const isSelected = selectedMoviles.includes(movil.id);
                            const isInactive = movil.isInactive;
                            const isNoActivo = movil.estadoNro === 3;
                            const isBajaMomentanea = movil.estadoNro === 4;
                            const loteCompleto = !isNoActivo && !isBajaMomentanea && (movil.tamanoLote ?? 0) > 0 && (movil.capacidad ?? 0) >= (movil.tamanoLote ?? 0);
                            // 🎨 Mismo cálculo de color que getMovilColor en MapView
                            const loteColor = (() => {
                              if (loteCompleto) return '#1F2937'; // Negro — lote lleno
                              const tam = movil.tamanoLote || 6;
                              const ped = movil.capacidad || 0;
                              const pct = ((tam - ped) / tam) * 100;
                              if (pct < 50) return '#F59E0B'; // Amarillo — < 50%
                              return movil.color; // Color fletera — >= 50%
                            })();
                            
                            return (
                              <motion.button
                                key={movil.id}
                                whileHover={{ scale: 1.02 }}
                                whileTap={{ scale: 0.98 }}
                                onClick={() => onToggleMovil(movil.id)}
                                className={clsx(
                                  'w-full py-2 px-3 rounded-lg font-medium transition-all duration-200 border-2',
                                  isSelected
                                    ? 'text-white shadow-md border-transparent'
                                    : 'bg-white text-gray-700 hover:bg-gray-50 border-gray-200',
                                  isInactive && !isSelected && 'bg-red-50 border-red-200',
                                  isInactive && !isNoActivo && !isBajaMomentanea && 'animate-pulse-slow',
                                  isNoActivo && !isSelected && 'bg-gray-50 border-gray-300 opacity-75',
                                  isBajaMomentanea && !isSelected && 'bg-violet-50 border-violet-300 opacity-85'
                                )}
                                style={{
                                  backgroundColor: isSelected ? (isInactive ? '#DC2626' : isNoActivo ? '#9CA3AF' : isBajaMomentanea ? '#8B5CF6' : loteColor) : undefined,
                                }}
                              >
                                <span className="flex items-center justify-between">
                                  <span className="flex items-center gap-2">
                                    {/* Checkbox visual */}
                                    <div className={clsx(
                                      "w-5 h-5 rounded flex items-center justify-center border-2 transition-all",
                                      isSelected 
                                        ? "bg-white border-white" 
                                        : "bg-white border-gray-300"
                                    )}>
                                      {isSelected && (
                                        <svg className="w-3 h-3" style={{ color: isInactive ? '#DC2626' : isNoActivo ? '#6B7280' : isBajaMomentanea ? '#7C3AED' : loteColor }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                        </svg>
                                      )}
                                    </div>
                                    
                                    {isNoActivo ? (
                                      <span className="relative inline-block">
                                        <svg 
                                          className="w-5 h-5 text-gray-400" 
                                          fill="currentColor" 
                                          viewBox="0 0 24 24"
                                        >
                                          <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                                        </svg>
                                      </span>
                                    ) : isBajaMomentanea ? (
                                      <span className="relative inline-block">
                                        <svg 
                                          className="w-5 h-5 text-violet-500" 
                                          fill="currentColor" 
                                          viewBox="0 0 24 24"
                                        >
                                          <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
                                        </svg>
                                      </span>
                                    ) : isInactive ? (
                                      <span className="relative inline-block">
                                        <svg 
                                          className="w-5 h-5 text-red-600 animate-pulse" 
                                          fill="currentColor" 
                                          viewBox="0 0 24 24"
                                        >
                                          <path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.89 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z"/>
                                        </svg>
                                        <span className="absolute -top-1 -right-1 flex h-2 w-2">
                                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                                          <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                                        </span>
                                      </span>
                                    ) : (
                                      <div
                                        className="w-4 h-4 rounded-full"
                                        style={{ backgroundColor: loteColor }}
                                      />
                                    )}
                                    {/* 🔥 Formato compacto: NroMovil – PedAsignados/Capacidad */}
                                    <span className={clsx("text-sm font-medium leading-tight", !isSelected && (isNoActivo ? "text-gray-400" : isBajaMomentanea ? "text-violet-600" : loteCompleto ? "text-gray-900 font-semibold" : ""))}>
                                      {movil.id}
                                      {' – '}
                                      {movil.capacidad ?? 0}/{movil.tamanoLote ?? 0}
                                      {isNoActivo && (
                                        <span className="ml-1.5 text-[9px] bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded-full font-semibold uppercase">
                                          No activo
                                        </span>
                                      )}
                                      {isBajaMomentanea && (
                                        <span className="ml-1.5 text-[9px] bg-violet-200 text-violet-700 px-1.5 py-0.5 rounded-full font-semibold uppercase">
                                          Baja mom.
                                        </span>
                                      )}
                                    </span>
                                  </span>
                                  {movil.currentPosition && (
                                    <div className="flex flex-col items-end">
                                      <span className={clsx("text-[11px]", isInactive ? "text-red-100 font-semibold" : isSelected ? "opacity-90" : "text-gray-600")}>
                                        {new Date(movil.currentPosition.fechaInsLog).toLocaleTimeString('es-PY', {
                                          hour: '2-digit',
                                          minute: '2-digit',
                                        })}
                                      </span>
                                      {(() => {
                                        const now = Date.now();
                                        const coordDate = new Date(movil.currentPosition.fechaInsLog).getTime();
                                        const minutesDiff = Math.floor((now - coordDate) / (1000 * 60));
                                        
                                        if (minutesDiff < 1) {
                                          return <span className={clsx("text-[10px] font-medium", isSelected ? "text-green-200" : "text-green-600")}>Ahora</span>;
                                        } else if (minutesDiff < 5) {
                                          return <span className={clsx("text-[10px]", isSelected ? "text-green-200" : "text-green-500")}>{minutesDiff}m</span>;
                                        } else if (minutesDiff < 15) {
                                          return <span className={clsx("text-[10px]", isSelected ? "text-yellow-200" : "text-yellow-600")}>{minutesDiff}m</span>;
                                        } else if (minutesDiff < 30) {
                                          return <span className={clsx("text-[10px]", isSelected ? "text-orange-200" : "text-orange-600")}>{minutesDiff}m</span>;
                                        } else {
                                          return <span className={clsx("text-[10px] font-semibold", isSelected ? "text-red-200" : "text-red-600")}>{minutesDiff}m ⚠️</span>;
                                        }
                                      })()}
                                    </div>
                                  )}
                                </span>
                              </motion.button>
                            );
                          })}
                        </div>
                      )}

                      {/* Contenido de Pedidos - 🚀 VIRTUALIZADO para 600+ pedidos */}
                      {category.key === 'pedidos' && (
                        <div ref={listContainerRef}>
                          {filteredPedidos.length === 0 ? (
                            <div className="text-center py-4 text-gray-500 text-sm">
                              <p>{pedidosFilters.vista === 'finalizados' ? '✅ Sin pedidos finalizados' : '📦 Sin pedidos'}</p>
                              <p className="text-xs mt-1">No hay pedidos para mostrar</p>
                            </div>
                          ) : (
                            <VirtualList
                              items={filteredPedidos}
                              height={Math.min(filteredPedidos.length * 38, Math.max(300, (typeof window !== 'undefined' ? window.innerHeight : 600) - 350))}
                              itemHeight={38}
                              overscanCount={8}
                              renderItem={(pedido, _index) => {
                                if (!pedido) return null;
                                const isFinalizados = pedidosFilters.vista === 'finalizados';
                                const isSinAsignar = !pedido.movil || Number(pedido.movil) === 0;
                                const delayMins = !isFinalizados ? computeDelayMinutes(pedido.fch_hora_max_ent_comp) : null;
                                const delayInfo = !isFinalizados ? getDelayInfo(delayMins) : null;
                                const esEntregado = isFinalizados && isPedidoEntregado(pedido);

                                return (
                                  <button
                                    key={pedido.id}
                                    onClick={() => onPedidoClick && onPedidoClick(pedido.id)}
                                    className={clsx(
                                      'w-full text-left px-2.5 py-1.5 rounded-lg transition-colors duration-100 border mb-1',
                                      isFinalizados 
                                        ? esEntregado
                                          ? 'bg-green-50 border-green-200 hover:bg-green-100'
                                          : 'bg-red-50 border-red-200 hover:bg-red-100'
                                        : isSinAsignar
                                          ? 'bg-gray-100 border-gray-300 hover:bg-gray-200'
                                          : delayInfo?.bgClass
                                    )}
                                  >
                                    <div className="flex items-center gap-2 text-xs">
                                      <span className="font-bold text-gray-900">#{pedido.id}</span>
                                      {(!pedido.latitud || !pedido.longitud) && (
                                        <span className="text-[10px] bg-amber-500 text-white px-1 py-0.5 rounded" title="Sin coordenadas">
                                          📍❌
                                        </span>
                                      )}
                                      {isSinAsignar ? (
                                        <span className="text-[10px] font-bold text-gray-500 bg-gray-200 px-1.5 py-0.5 rounded">Sin asignar</span>
                                      ) : (
                                        <span className="text-gray-700">🚗{pedido.movil}</span>
                                      )}
                                      {pedido.servicio_nombre && (
                                        <span className="text-gray-600 truncate flex-1">📋{pedido.servicio_nombre}</span>
                                      )}
                                      {isFinalizados ? (
                                        <span 
                                          className={clsx(
                                            'text-[10px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap',
                                            esEntregado ? 'text-green-700' : 'text-red-700'
                                          )}
                                          style={{ backgroundColor: esEntregado ? '#22c55e22' : '#ef444422' }}
                                          title={esEntregado ? 'Entregado' : 'No Entregado'}
                                        >
                                          {esEntregado ? '✔ Entregado' : '✗ No Entregado'}
                                        </span>
                                      ) : (
                                        <span 
                                          className={clsx(
                                            'text-[10px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap',
                                            isSinAsignar ? 'text-gray-500' : delayInfo?.textColor
                                          )}
                                          style={{ backgroundColor: isSinAsignar ? '#9CA3AF22' : `${delayInfo?.color}22` }}
                                          title={isSinAsignar ? 'Sin asignar' : delayInfo?.label}
                                        >
                                          ⏱{delayInfo?.badgeText}
                                        </span>
                                      )}
                                    </div>
                                  </button>
                                );
                              }}
                            />
                          )}
                        </div>
                      )}

                      {category.key === 'services' && (
                        <div>
                          {filteredServices.length === 0 ? (
                            <div className="text-center py-4 text-gray-500 text-sm">
                              <p>{servicesFilters.vista === 'finalizados' ? '✅ Sin services finalizados' : '🔧 Sin services pendientes'}</p>
                              <p className="text-xs mt-1">No hay services para mostrar</p>
                            </div>
                          ) : (
                            <VirtualList
                              items={filteredServices}
                              height={Math.min(filteredServices.length * 38, Math.max(300, (typeof window !== 'undefined' ? window.innerHeight : 600) - 350))}
                              itemHeight={38}
                              overscanCount={8}
                              renderItem={(service, _index) => {
                                if (!service) return null;
                                const isFinalizados = servicesFilters.vista === 'finalizados';
                                const isSinAsignar = !service.movil || Number(service.movil) === 0;
                                const delayMins = !isFinalizados ? computeDelayMinutes(service.fch_hora_max_ent_comp) : null;
                                const delayInfo = !isFinalizados ? getDelayInfo(delayMins) : null;

                                return (
                                  <button
                                    key={service.id}
                                    onClick={() => onServiceClick && onServiceClick(service.id)}
                                    className={clsx(
                                      'w-full text-left px-2.5 py-1.5 rounded-lg transition-colors duration-100 border mb-1',
                                      isFinalizados
                                        ? 'bg-green-50 border-green-200 hover:bg-green-100'
                                        : isSinAsignar
                                          ? 'bg-gray-100 border-gray-300 hover:bg-gray-200'
                                          : delayInfo?.bgClass
                                    )}
                                  >
                                    <div className="flex items-center gap-2 text-xs">
                                      <span className="font-bold text-gray-900">#{service.id}</span>
                                      {(!service.latitud || !service.longitud) && (
                                        <span className="text-[10px] bg-amber-500 text-white px-1 py-0.5 rounded" title="Sin coordenadas">
                                          📍❌
                                        </span>
                                      )}
                                      {isSinAsignar ? (
                                        <span className="text-[10px] font-bold text-gray-500 bg-gray-200 px-1.5 py-0.5 rounded">Sin asignar</span>
                                      ) : (
                                        <span className="text-gray-700">🚗{service.movil}</span>
                                      )}
                                      {service.defecto && (
                                        <span className="text-gray-600 truncate flex-1">🔧{service.defecto}</span>
                                      )}
                                      {isFinalizados ? (
                                        <span
                                          className="text-[10px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap text-green-700"
                                          style={{ backgroundColor: '#22c55e22' }}
                                          title="Finalizado"
                                        >
                                          ✔ Finalizado
                                        </span>
                                      ) : (
                                        <span
                                          className={clsx(
                                            'text-[10px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap',
                                            isSinAsignar ? 'text-gray-500' : delayInfo?.textColor
                                          )}
                                          style={{ backgroundColor: isSinAsignar ? '#9CA3AF22' : `${delayInfo?.color}22` }}
                                          title={isSinAsignar ? 'Sin asignar' : delayInfo?.label}
                                        >
                                          ⏱{delayInfo?.badgeText}
                                        </span>
                                      )}
                                    </div>
                                  </button>
                                );
                              }}
                            />
                          )}
                        </div>
                      )}

                      {category.key === 'pois' && (
                        <div className="space-y-1">
                          {puntosInteres.length === 0 ? (
                            <div className="text-center py-4 text-gray-500 text-sm">
                              <p>📍 Sin puntos de interés</p>
                              <p className="text-xs mt-1">Crea uno haciendo clic en el botón verde del header</p>
                            </div>
                          ) : poiByCategory.length === 0 ? (
                            /* Sin categorías, mostrar lista plana */
                            puntosInteres.map((punto) => (
                              <motion.button
                                key={punto.id}
                                onClick={() => onPuntoInteresClick?.(punto.id)}
                                className="w-full text-left px-3 py-2 rounded-lg bg-gradient-to-r from-cyan-400 to-blue-400 dark:from-cyan-600 dark:to-blue-600 hover:from-cyan-500 hover:to-blue-500 border border-cyan-300 dark:border-cyan-500 transition-all duration-200 group shadow-sm hover:shadow-md"
                                whileHover={{ scale: 1.01, x: 2 }}
                                whileTap={{ scale: 0.98 }}
                              >
                                <div className="flex items-center gap-2">
                                  <span className="text-base">{punto.icono}</span>
                                  <span className="font-semibold text-white text-sm truncate">{punto.nombre}</span>
                                </div>
                              </motion.button>
                            ))
                          ) : (
                            /* Categorías agrupadas con sub-collapsibles */
                            poiByCategory.map(([catKey, group]) => {
                              const isCatHidden = hiddenPoiCategories.has(group.label);
                              const isCatExpanded = expandedPoiCategories.has(catKey);
                              return (
                                <div key={catKey} className="rounded-lg overflow-hidden border border-gray-200/50 dark:border-gray-600/50">
                                  {/* Header de categoría */}
                                  <button
                                    onClick={() => togglePoiSubCategory(catKey)}
                                    className={clsx(
                                      'w-full flex items-center gap-2 px-2.5 py-1.5 text-left transition-colors',
                                      isCatExpanded
                                        ? 'bg-cyan-50 dark:bg-cyan-900/30'
                                        : 'bg-gray-50 dark:bg-gray-700/50 hover:bg-gray-100 dark:hover:bg-gray-700'
                                    )}
                                  >
                                    {/* Flecha expandir/colapsar */}
                                    <svg
                                      className={clsx('w-3.5 h-3.5 text-gray-400 transition-transform flex-shrink-0', isCatExpanded && 'rotate-90')}
                                      fill="none" stroke="currentColor" viewBox="0 0 24 24"
                                    >
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                    </svg>
                                    <span className="text-sm flex-shrink-0">
                                      {group.label.toLowerCase() === 'punto de venta'
                                        ? <img src="/images/iconoptoventa.png" style={{ width: 16, height: 16, objectFit: 'contain' }} alt="Punto de Venta" />
                                        : group.icono}
                                    </span>
                                    <span className="text-xs font-semibold text-gray-700 dark:text-gray-200 truncate flex-1">
                                      {group.label}
                                    </span>
                                    <span className="text-[10px] text-gray-400 dark:text-gray-500 font-mono flex-shrink-0">
                                      {group.items.length}
                                    </span>
                                    {/* Eye toggle por categoría */}
                                    {onTogglePoiCategory && (
                                      <span
                                        role="button"
                                        tabIndex={0}
                                        onClick={(e) => { e.stopPropagation(); onTogglePoiCategory(group.label); }}
                                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); onTogglePoiCategory(group.label); } }}
                                        className={clsx(
                                          'p-0.5 rounded-full transition-colors flex-shrink-0',
                                          isCatHidden ? 'hover:bg-green-100 bg-red-50 dark:bg-red-900/30' : 'hover:bg-blue-100 dark:hover:bg-blue-900/30'
                                        )}
                                        title={isCatHidden ? `Mostrar ${group.label}` : `Ocultar ${group.label}`}
                                      >
                                        {isCatHidden ? (
                                          <svg className="w-3.5 h-3.5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L3 3m6.878 6.878L21 21" />
                                          </svg>
                                        ) : (
                                          <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                          </svg>
                                        )}
                                      </span>
                                    )}
                                    {/* Seleccionar todos/ninguno por categoría */}
                                    {(onSelectCategoryPois || onClearCategoryPois) && (
                                      <span
                                        role="button"
                                        tabIndex={0}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          const ids = group.items.map(p => p.id);
                                          const allSel = ids.every(id => selectedPois?.has(id));
                                          if (allSel) onClearCategoryPois?.(ids);
                                          else onSelectCategoryPois?.(ids);
                                        }}
                                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') e.currentTarget.click(); }}
                                        className="px-1 py-0.5 text-[9px] font-semibold rounded transition-colors flex-shrink-0 bg-blue-50 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-800 cursor-pointer"
                                        title={group.items.every(p => selectedPois?.has(p.id)) ? 'Deseleccionar todos' : 'Seleccionar todos'}
                                      >
                                        {group.items.every(p => selectedPois?.has(p.id)) ? 'Ninguno' : 'Todos'}
                                      </span>
                                    )}
                                  </button>
                                  {/* Lista de POIs de esta categoría */}
                                  <AnimatePresence>
                                    {isCatExpanded && (
                                      <motion.div
                                        initial={{ height: 0, opacity: 0 }}
                                        animate={{ height: 'auto', opacity: 1 }}
                                        exit={{ height: 0, opacity: 0 }}
                                        transition={{ duration: 0.2 }}
                                        className="overflow-hidden"
                                      >
                                        <div className="p-1 space-y-0.5 max-h-48 overflow-y-auto">
                                          {group.items.map((punto) => {
                                            // Quitar prefijo [Category] de observacion para mostrar limpio
                                            const cleanObs = punto.observacion?.replace(/^\[[^\]]+\]\s*/, '') || '';
                                            const isPoiSelected = !selectedPois || selectedPois.has(punto.id);
                                            return (
                                              <motion.button
                                                key={punto.id}
                                                onClick={() => onPuntoInteresClick?.(punto.id)}
                                                className={clsx(
                                                  'w-full text-left px-2 py-1.5 rounded-md transition-all duration-150 text-xs',
                                                  isCatHidden
                                                    ? 'bg-gray-100 dark:bg-gray-700 opacity-50'
                                                    : !isPoiSelected
                                                      ? 'bg-gray-50 dark:bg-gray-700/50 opacity-50 border border-dashed border-gray-300 dark:border-gray-600'
                                                      : 'bg-white dark:bg-gray-700 hover:bg-cyan-50 dark:hover:bg-cyan-900/20 border border-transparent hover:border-cyan-200 dark:hover:border-cyan-700'
                                                )}
                                                whileHover={{ x: 2 }}
                                                whileTap={{ scale: 0.98 }}
                                              >
                                                <div className="flex items-center gap-1.5">
                                                  <span
                                                    role="button"
                                                    tabIndex={0}
                                                    onClick={(e) => { e.stopPropagation(); onTogglePoi?.(punto.id); }}
                                                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); onTogglePoi?.(punto.id); } }}
                                                    className="text-sm flex-shrink-0 cursor-pointer"
                                                    title={isPoiSelected ? 'Ocultar en mapa' : 'Mostrar en mapa'}
                                                  >
                                                    {isPoiSelected
                                                      ? ((punto.categoria || '').toLowerCase() === 'punto de venta'
                                                          ? <img src="/images/iconoptoventa.png" style={{ width: 16, height: 16, objectFit: 'contain' }} alt="PV" />
                                                          : punto.icono)
                                                      : (
                                                      <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L3 3m6.878 6.878L21 21" />
                                                      </svg>
                                                    )}
                                                  </span>
                                                  <div className="flex-1 min-w-0">
                                                    <span className="font-medium text-gray-800 dark:text-gray-200 truncate block">
                                                      {punto.nombre}
                                                    </span>
                                                    {cleanObs && (
                                                      <span className="text-[10px] text-gray-500 dark:text-gray-400 truncate block">
                                                        {cleanObs}
                                                      </span>
                                                    )}
                                                  </div>
                                                </div>
                                              </motion.button>
                                            );
                                          })}
                                        </div>
                                      </motion.div>
                                    )}
                                  </AnimatePresence>
                                </div>
                              );
                            })
                          )}
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))}
        </div>
      </div>

      {/* Modal de guía del mapa */}
      <MapGuideModal
        isOpen={guideCategory !== null}
        onClose={() => setGuideCategory(null)}
        category={guideCategory || 'moviles'}
      />
    </div>
  );
}
