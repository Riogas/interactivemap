import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { EmpresaFleteraSupabase } from '@/types';
import { determineServicePeriod } from '@/lib/horario-servicio';

interface MapDataViewOptions {
  dataViewMode: string;
  selectedEmpresas: number[];
  empresas: EmpresaFleteraSupabase[];
  demorasPollingSeconds: number;
  movilesZonasPollingSeconds: number;
  updatePreference: (key: any, value: any) => void;
  /** Si null → sin scope (root/despacho). Si Set → solo se mantienen zonas de ese set. */
  scopedZonaIds?: Set<number> | null;
  /** Si null → sin scope. Si array → se pasa como ?empresaIds=... a las APIs. */
  scopedEmpresas?: number[] | null;
  /**
   * Hora actual del servidor (de useServerTime).
   * Se usa para calcular el periodo diurno/nocturno activo y detectar transiciones.
   */
  serverNow: Date;
  /**
   * Si el escenario cubre servicio nocturno.
   * false = movilesZonasServiceFilter siempre arranca y se mantiene en 'URGENTE'.
   * true = cambia automaticamente segun horario (default conservativo).
   */
  aplicaNocturno: boolean;
}

/**
 * Hook que maneja la Capas de Informacion del mapa (Normal / Demoras / Moviles en Zonas / Zonas Activas).
 * Incluye: estado de zonas, demoras, moviles-zonas, polling automatico de datos,
 * y calculo automatico del periodo de servicio activo segun horario del servidor.
 */
export function useMapDataView({
  dataViewMode,
  selectedEmpresas,
  empresas,
  demorasPollingSeconds,
  movilesZonasPollingSeconds,
  updatePreference,
  scopedZonaIds = null,
  scopedEmpresas = null,
  serverNow,
  aplicaNocturno,
}: MapDataViewOptions) {
  const [showZonas, setShowZonas] = useState(false);
  const [zonasData, setZonasData] = useState<any[]>([]);
  const [allZonasData, setAllZonasData] = useState<any[]>([]);
  const [demorasData, setDemorasData] = useState<Map<number, { minutos: number; activa: boolean }>>(new Map());
  const [movilesZonasData, setMovilesZonasData] = useState<any[]>([]);

  // Inicializacion lazy: calcula el periodo correcto desde el primer render
  // usando serverNow y aplicaNocturno (evita flicker de URGENTE -> NOCTURNO).
  const [movilesZonasServiceFilter, setMovilesZonasServiceFilter] = useState<string>(() =>
    determineServicePeriod(serverNow, aplicaNocturno)
  );

  // Ref para trackear el ultimo periodo conocido sin causar re-renders.
  // Se inicializa con el mismo valor que el estado para consistencia.
  const lastKnownPeriodRef = useRef<string>(determineServicePeriod(serverNow, aplicaNocturno));

  // Refs para leer los valores de polling sin reiniciar el intervalo cuando cambian
  const demorasPollingRef = useRef(demorasPollingSeconds);
  const movilesZonasPollingRef = useRef(movilesZonasPollingSeconds);
  useEffect(() => { demorasPollingRef.current = demorasPollingSeconds; }, [demorasPollingSeconds]);
  useEffect(() => { movilesZonasPollingRef.current = movilesZonasPollingSeconds; }, [movilesZonasPollingSeconds]);

  // Deteccion de transicion horaria.
  // Corre cada vez que serverNow cambia (tick 1s de useServerTime).
  // Solo actua cuando el periodo activo es diferente al ultimo conocido.
  // La seleccion manual del usuario (ej: 'SERVICE') se respeta dentro del mismo periodo
  // y se pisa al cruzar la transicion.
  useEffect(() => {
    if (!aplicaNocturno) return; // escenario sin nocturno — nada que detectar
    const currentPeriod = determineServicePeriod(serverNow, aplicaNocturno);
    if (currentPeriod !== lastKnownPeriodRef.current) {
      lastKnownPeriodRef.current = currentPeriod;
      setMovilesZonasServiceFilter(currentPeriod);
    }
  }, [serverNow, aplicaNocturno]);

  // Escenarios unicos derivados de las empresas seleccionadas
  const uniqueEscenarios = useMemo(() => {
    return [...new Set(
      empresas
        .filter(e => selectedEmpresas.includes(e.empresa_fletera_id))
        .map(e => e.escenario_id)
    )];
  }, [selectedEmpresas, empresas]);

  // Sync showZonas con dataViewMode
  useEffect(() => {
    if (dataViewMode !== 'normal') {
      setShowZonas(true);
    }
  }, [dataViewMode]);

  // Handler para cambios de Capas de Informacion
  const handleDataViewChange = useCallback((mode: 'normal' | 'distribucion' | 'demoras' | 'moviles-zonas' | 'zonas-activas' | 'pedidos-zona' | 'saturacion') => {
    updatePreference('dataViewMode', mode);
    if (mode !== 'normal') {
      setShowZonas(true);
    } else {
      setShowZonas(false);
    }
    // En moviles-zonas, ocultar pedidos y servicios para mostrar solo moviles
    if (mode === 'moviles-zonas') {
      updatePreference('pedidosVisible', false);
      updatePreference('servicesVisible', false);
    } else {
      updatePreference('pedidosVisible', true);
      updatePreference('servicesVisible', true);
    }
  }, [updatePreference]);

  // Stable keys derivados del scope (evita resetear effects por nueva referencia)
  const scopedEmpresasKey = scopedEmpresas ? scopedEmpresas.join(',') : '__noscope__';
  const scopeZonasKey = scopedZonaIds ? Array.from(scopedZonaIds).sort((a, b) => a - b).join(',') : '__nozonascope__';

  // Cargar zonas cuando se activa showZonas, filtradas por escenario_id
  useEffect(() => {
    if (!showZonas) {
      setZonasData([]);
      return;
    }
    if (uniqueEscenarios.length === 0) {
      setZonasData([]);
      return;
    }
    // Fail-closed: si hay scope con set vacio, no cargar nada
    if (scopedZonaIds && scopedZonaIds.size === 0) {
      setZonasData([]);
      return;
    }

    const loadZonas = async () => {
      try {
        const url = scopedEmpresas && scopedEmpresas.length > 0
          ? `/api/zonas?empresaIds=${scopedEmpresas.join(',')}`
          : '/api/zonas';
        const response = await fetch(url);
        const result = await response.json();
        if (result.success && result.data) {
          const zonasFiltradas = result.data.filter(
            (z: any) =>
              z.activa !== false &&
              uniqueEscenarios.includes(z.escenario_id) &&
              (scopedZonaIds == null || scopedZonaIds.has(z.zona_id))
          );
          console.log(`${zonasFiltradas.length} zonas activas para escenarios [${uniqueEscenarios.join(', ')}]`);
          setZonasData(zonasFiltradas);
        }
      } catch (err) {
        console.error('Error loading zonas:', err);
      }
    };
    loadZonas();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showZonas, uniqueEscenarios, scopedEmpresasKey, scopeZonasKey]);

  // Clave estable basada en el contenido de escenarios (evita resets del intervalo por nueva referencia de array)
  const uniqueEscenariosKey = uniqueEscenarios.join(',');

  // Cargar datos de vista (demoras / moviles en zonas) con polling automatico.
  // Los valores de polling se leen via ref para no reiniciar el intervalo cuando el usuario
  // ajusta los segundos en Preferencias.
  useEffect(() => {
    if (dataViewMode === 'normal') {
      setAllZonasData([]);
      setDemorasData(new Map());
      setMovilesZonasData([]);
      return;
    }

    if (uniqueEscenarios.length === 0) return;

    // Fail-closed: si hay scope con set vacio, no cargar nada de la vista activa
    if (scopedZonaIds && scopedZonaIds.size === 0) {
      setAllZonasData([]);
      setDemorasData(new Map());
      setMovilesZonasData([]);
      return;
    }

    const empresaIdsParam = scopedEmpresas && scopedEmpresas.length > 0
      ? `?empresaIds=${scopedEmpresas.join(',')}`
      : '';

    // Zonas GeoJSON se carga una sola vez al entrar a la vista (no en cada tick de polling)
    // porque el GeoJSON de zonas casi nunca cambia en el dia.
    const loadZonasGeojson = async () => {
      try {
        const zonasRes = await fetch(`/api/zonas${empresaIdsParam}`);
        const zonasResult = await zonasRes.json();
        if (zonasResult.success && zonasResult.data) {
          const zonasFiltradas = zonasResult.data.filter(
            (z: any) =>
              uniqueEscenarios.includes(z.escenario_id) &&
              z.geojson &&
              (scopedZonaIds == null || scopedZonaIds.has(z.zona_id))
          );
          console.log(`${zonasFiltradas.length} zonas con geojson cargadas (una vez)`);
          setAllZonasData(zonasFiltradas);
        }
      } catch (err) {
        console.error('Error loading zonas geojson:', err);
      }
    };
    loadZonasGeojson();

    // Solo los datos dinamicos (demoras / moviles-zonas) se recargan en cada tick
    const loadDataView = async () => {
      try {
        console.log(`Polling "${dataViewMode}" para escenarios [${uniqueEscenarios.join(', ')}]...`);

        // Demoras: requerido por TODAS las capas que muestran zonas inactivas
        // como transparente+punteado (todas excepto 'distribucion'). Sin esto,
        // al pasar de normal → saturacion las zonas inactivas se ven rellenas.
        if (dataViewMode !== 'distribucion') {
          const demorasRes = await fetch(`/api/demoras${empresaIdsParam}`);
          const demorasResult = await demorasRes.json();
          if (demorasResult.success && demorasResult.data) {
            const dMap = new Map<number, { minutos: number; activa: boolean }>();
            for (const d of demorasResult.data) {
              if (!uniqueEscenarios.includes(d.escenario_id)) continue;
              if (scopedZonaIds != null && !scopedZonaIds.has(d.zona_id)) continue;
              const existing = dMap.get(d.zona_id);
              if (!existing || d.minutos > existing.minutos) {
                dMap.set(d.zona_id, { minutos: d.minutos, activa: d.activa });
              }
            }
            console.log(`${dMap.size} demoras actualizadas`);
            setDemorasData(dMap);
          }
        }

        // Moviles en Zonas o Saturacion
        if (dataViewMode === 'moviles-zonas' || dataViewMode === 'saturacion') {
          const mzRes = await fetch(`/api/moviles-zonas${empresaIdsParam}`);
          const mzResult = await mzRes.json();
          if (mzResult.success && mzResult.data) {
            const mzFiltered = scopedZonaIds == null
              ? mzResult.data
              : mzResult.data.filter((r: any) => scopedZonaIds.has(r.zona_id));
            setMovilesZonasData(mzFiltered);
          }
        }
      } catch (err) {
        console.error('Error loading data view:', err);
      }
    };

    // Carga inicial inmediata
    loadDataView();

    // Polling: intervalo segun vista activa, leido desde ref para no reiniciar si cambian las prefs
    const getIntervalMs = () => {
      if (dataViewMode === 'demoras' || dataViewMode === 'zonas-activas') {
        return demorasPollingRef.current * 1000;
      }
      if (dataViewMode === 'moviles-zonas' || dataViewMode === 'saturacion') {
        return movilesZonasPollingRef.current * 1000;
      }
      return 0; // pedidos-zona: sin polling propio
    };

    const intervalMs = getIntervalMs();
    let intervalId: ReturnType<typeof setInterval> | null = null;

    if (intervalMs > 0) {
      console.log(`Polling activado para "${dataViewMode}" cada ${intervalMs / 1000}s`);
      intervalId = setInterval(loadDataView, intervalMs);
    }

    // Reactivar polling al volver al foco (evita que RD/tab en segundo plano lo suspenda)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        console.log('Tab visible — refetch inmediato y reinicio de polling');
        loadDataView();
        if (intervalId) clearInterval(intervalId);
        const ms = getIntervalMs();
        if (ms > 0) intervalId = setInterval(loadDataView, ms);
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      if (intervalId) {
        console.log(`Polling desactivado para "${dataViewMode}"`);
        clearInterval(intervalId);
      }
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataViewMode, uniqueEscenariosKey, scopedEmpresasKey, scopeZonasKey]);

  return {
    showZonas,
    setShowZonas,
    zonasData,
    allZonasData,
    demorasData,
    movilesZonasData,
    movilesZonasServiceFilter,
    setMovilesZonasServiceFilter,
    handleDataViewChange,
  };
}
