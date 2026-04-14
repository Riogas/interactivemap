import { useState, useEffect, useCallback, useMemo } from 'react';
import { EmpresaFleteraSupabase } from '@/types';

interface MapDataViewOptions {
  dataViewMode: string;
  selectedEmpresas: number[];
  empresas: EmpresaFleteraSupabase[];
  demorasPollingSeconds: number;
  movilesZonasPollingSeconds: number;
  updatePreference: (key: any, value: any) => void;
}

/**
 * Hook que maneja la vista de datos del mapa (Normal / Demoras / Móviles en Zonas / Zonas Activas).
 * Incluye: estado de zonas, demoras, móviles-zonas, polling automático de datos.
 */
export function useMapDataView({
  dataViewMode,
  selectedEmpresas,
  empresas,
  demorasPollingSeconds,
  movilesZonasPollingSeconds,
  updatePreference,
}: MapDataViewOptions) {
  const [showZonas, setShowZonas] = useState(false);
  const [zonasData, setZonasData] = useState<any[]>([]);
  const [allZonasData, setAllZonasData] = useState<any[]>([]);
  const [demorasData, setDemorasData] = useState<Map<number, { minutos: number; activa: boolean }>>(new Map());
  const [movilesZonasData, setMovilesZonasData] = useState<any[]>([]);
  const [movilesZonasServiceFilter, setMovilesZonasServiceFilter] = useState<string>('URGENTE');

  // Escenarios únicos derivados de las empresas seleccionadas
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

  // Handler para cambios de vista de datos
  const handleDataViewChange = useCallback((mode: 'normal' | 'distribucion' | 'demoras' | 'moviles-zonas' | 'zonas-activas') => {
    updatePreference('dataViewMode', mode);
    if (mode !== 'normal') {
      setShowZonas(true);
    } else {
      setShowZonas(false);
    }
    // En moviles-zonas, ocultar pedidos y servicios para mostrar solo móviles
    if (mode === 'moviles-zonas') {
      updatePreference('pedidosVisible', false);
      updatePreference('servicesVisible', false);
    } else {
      updatePreference('pedidosVisible', true);
      updatePreference('servicesVisible', true);
    }
  }, [updatePreference]);

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

    const loadZonas = async () => {
      try {
        const response = await fetch('/api/zonas');
        const result = await response.json();
        if (result.success && result.data) {
          const zonasFiltradas = result.data.filter(
            (z: any) => z.activa !== false && uniqueEscenarios.includes(z.escenario_id)
          );
          console.log(`🗺️ ${zonasFiltradas.length} zonas activas para escenarios [${uniqueEscenarios.join(', ')}]`);
          setZonasData(zonasFiltradas);
        }
      } catch (err) {
        console.error('❌ Error loading zonas:', err);
      }
    };
    loadZonas();
  }, [showZonas, uniqueEscenarios]);

  // Clave estable basada en el contenido de escenarios (evita resets del intervalo por nueva referencia de array)
  const uniqueEscenariosKey = uniqueEscenarios.join(',');

  // Cargar datos de vista (demoras / móviles en zonas) con polling automático
  useEffect(() => {
    if (dataViewMode === 'normal') {
      setAllZonasData([]);
      setDemorasData(new Map());
      setMovilesZonasData([]);
      return;
    }

    if (uniqueEscenarios.length === 0) return;

    const loadDataView = async () => {
      try {
        console.log(`📊 Cargando vista "${dataViewMode}" para escenarios [${uniqueEscenarios.join(', ')}]...`);

        // 1) Cargar todas las zonas con geojson
        const zonasRes = await fetch('/api/zonas');
        const zonasResult = await zonasRes.json();
        if (zonasResult.success && zonasResult.data) {
          const zonasFiltradas = zonasResult.data.filter(
            (z: any) => uniqueEscenarios.includes(z.escenario_id) && z.geojson
          );
          console.log(`📊 ${zonasFiltradas.length} zonas con geojson (de ${zonasResult.data.length} total)`);
          setAllZonasData(zonasFiltradas);
        }

        // 2) Si es vista Demoras o Zonas Activas, cargar demoras
        if (dataViewMode === 'demoras' || dataViewMode === 'zonas-activas') {
          const demorasRes = await fetch('/api/demoras');
          const demorasResult = await demorasRes.json();
          if (demorasResult.success && demorasResult.data) {
            const dMap = new Map<number, { minutos: number; activa: boolean }>();
            for (const d of demorasResult.data) {
              if (uniqueEscenarios.includes(d.escenario_id)) {
                const existing = dMap.get(d.zona_id);
                if (!existing || d.minutos > existing.minutos) {
                  dMap.set(d.zona_id, { minutos: d.minutos, activa: d.activa });
                }
              }
            }
            console.log(`📊 ${dMap.size} demoras cargadas`);
            setDemorasData(dMap);
          }
        }

        // 3) Si es vista Móviles en Zonas, cargar datos crudos
        if (dataViewMode === 'moviles-zonas') {
          const mzRes = await fetch('/api/moviles-zonas');
          const mzResult = await mzRes.json();
          if (mzResult.success && mzResult.data) {
            setMovilesZonasData(mzResult.data);
          }
        }
      } catch (err) {
        console.error('❌ Error loading data view:', err);
      }
    };

    // Carga inicial inmediata
    loadDataView();

    // Polling: intervalo según vista activa
    let intervalMs = 0;
    if (dataViewMode === 'demoras' || dataViewMode === 'zonas-activas') {
      intervalMs = demorasPollingSeconds * 1000;
    } else if (dataViewMode === 'moviles-zonas') {
      intervalMs = movilesZonasPollingSeconds * 1000;
    }

    let intervalId: ReturnType<typeof setInterval> | null = null;
    if (intervalMs > 0) {
      console.log(`🔄 Polling activado para "${dataViewMode}" cada ${intervalMs / 1000}s`);
      intervalId = setInterval(loadDataView, intervalMs);
    }

    return () => {
      if (intervalId) {
        console.log(`🔄 Polling desactivado para "${dataViewMode}"`);
        clearInterval(intervalId);
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataViewMode, uniqueEscenariosKey, demorasPollingSeconds, movilesZonasPollingSeconds]);

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
