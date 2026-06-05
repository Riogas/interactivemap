import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { EmpresaFleteraSupabase } from '@/types';
import { determineServicePeriod } from '@/lib/horario-servicio';
import { supabase } from '@/lib/supabase';

// ─── Circuit breaker para escenario_settings ────────────────────────────────
// Cuando NEXT_PUBLIC_SUPABASE_PROXY_URL está mal configurado en el servidor de
// dev (apunta a prod), cada tick del smart polling falla por CORS y spamea la
// consola. Después de 3 fallos consecutivos, abrimos el circuito por 5 min:
// se salta la query y se va directo al fetch pesado (que sí funciona porque
// es via Next.js API routes server-side). Tras la ventana de cooldown se
// reintenta una vez (half-open) y si vuelve a fallar, se reabre.
// Vive a nivel de módulo para sobrevivir re-mounts del hook.
const BREAKER_THRESHOLD = 3;
const BREAKER_COOLDOWN_MS = 5 * 60 * 1000;
const escenarioSettingsBreaker = {
  consecutiveFailures: 0,
  openedAt: null as number | null,
  loggedOnce: false,
};
function isBreakerOpen(): boolean {
  if (escenarioSettingsBreaker.openedAt === null) return false;
  const elapsed = Date.now() - escenarioSettingsBreaker.openedAt;
  if (elapsed >= BREAKER_COOLDOWN_MS) {
    // Half-open: permitir un retry. openedAt se mantiene; se resetea solo en success.
    return false;
  }
  return true;
}
function recordBreakerFailure(reason: unknown): void {
  escenarioSettingsBreaker.consecutiveFailures += 1;
  if (
    escenarioSettingsBreaker.consecutiveFailures >= BREAKER_THRESHOLD &&
    escenarioSettingsBreaker.openedAt === null
  ) {
    escenarioSettingsBreaker.openedAt = Date.now();
    if (!escenarioSettingsBreaker.loggedOnce) {
      console.warn(
        `[smart-polling] escenario_settings inaccesible tras ${BREAKER_THRESHOLD} intentos. ` +
        `Probablemente NEXT_PUBLIC_SUPABASE_PROXY_URL apunta al host equivocado en .env.local del servidor. ` +
        `Activando circuit breaker: fallback a fetch pesado por ${BREAKER_COOLDOWN_MS / 60000} min.`,
        reason,
      );
      escenarioSettingsBreaker.loggedOnce = true;
    }
  }
}
function recordBreakerSuccess(): void {
  if (escenarioSettingsBreaker.openedAt !== null || escenarioSettingsBreaker.consecutiveFailures > 0) {
    if (escenarioSettingsBreaker.openedAt !== null) {
      console.info('[smart-polling] escenario_settings disponible nuevamente — circuit closed.');
    }
    escenarioSettingsBreaker.consecutiveFailures = 0;
    escenarioSettingsBreaker.openedAt = null;
    escenarioSettingsBreaker.loggedOnce = false;
  }
}

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
  /**
   * true si la fecha seleccionada es hoy.
   * En fechas históricas se omite el tick de visibilitychange (no tiene sentido
   * recargar datos de ayer/anteayer al volver a la pestaña).
   * Default true (conservativo).
   */
  isToday?: boolean;
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
  isToday = true,
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

  // Smart polling: timestamps del ultimo fetch exitoso, por dataset.
  // useRef (no state) para no causar re-renders al actualizar.
  // Se persiste en localStorage para sobrevivir reloads de pestaña.
  const lastFetchedAt = useRef<{ demoras: Date | null; moviles_zonas: Date | null }>({
    demoras: null,
    moviles_zonas: null,
  });

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

  // Leer lastFetchedAt desde localStorage al conocer el escenario primario.
  // Se ejecuta una sola vez cuando uniqueEscenariosKey cambia (mount o cambio de escenario).
  const primaryEscenarioId = uniqueEscenarios[0] ?? null;
  useEffect(() => {
    if (primaryEscenarioId === null) return;
    try {
      const raw = localStorage.getItem(`smart-polling-last-fetch-${primaryEscenarioId}`);
      if (raw) {
        const parsed = JSON.parse(raw) as { demoras?: string; moviles_zonas?: string };
        lastFetchedAt.current = {
          demoras: parsed.demoras ? new Date(parsed.demoras) : null,
          moviles_zonas: parsed.moviles_zonas ? new Date(parsed.moviles_zonas) : null,
        };
      }
    } catch {
      // localStorage no disponible o JSON corrupto — arrancar con null (fetch siempre en primer tick)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [primaryEscenarioId]);

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

    // Fetch pesado de demoras (sin guard de timestamp — se llama cuando se sabe que hay cambios)
    const fetchDemoras = async () => {
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
    };

    // Fetch pesado de moviles-zonas (sin guard de timestamp)
    const fetchMovilesZonas = async () => {
      const mzRes = await fetch(`/api/moviles-zonas${empresaIdsParam}`);
      const mzResult = await mzRes.json();
      if (mzResult.success && mzResult.data) {
        const mzFiltered = scopedZonaIds == null
          ? mzResult.data
          : mzResult.data.filter((r: any) => scopedZonaIds.has(r.zona_id));
        setMovilesZonasData(mzFiltered);
      }
    };

    // Persiste lastFetchedAt en localStorage tras un fetch exitoso
    const persistLastFetch = (escId: number) => {
      try {
        localStorage.setItem(
          `smart-polling-last-fetch-${escId}`,
          JSON.stringify({
            demoras: lastFetchedAt.current.demoras?.toISOString() ?? null,
            moviles_zonas: lastFetchedAt.current.moviles_zonas?.toISOString() ?? null,
          })
        );
      } catch {
        // localStorage no disponible — ignorar silenciosamente
      }
    };

    // Tick del polling: query minima a escenario_settings (1 fila, 2 columnas).
    // Si la marca del servidor es mas nueva que el ultimo fetch local → fetch pesado.
    // Si la query falla → fallback al fetch pesado directamente (no romper el polling).
    // Se comparten ambas marcas en una sola query por tick.
    const loadDataView = async (forceAll = false) => {
      // Skip cuando el tab está oculto — evita fetches innecesarios. El handler de
      // visibilitychange existente ya re-dispara al volver visible.
      if (typeof document !== 'undefined' && document.hidden) return;
      console.log(`Tick polling "${dataViewMode}" para escenarios [${uniqueEscenarios.join(', ')}]...`);

      const escId = uniqueEscenarios[0] ?? null;

      const needsDemoras = dataViewMode !== 'distribucion';
      const needsMovilesZonas = dataViewMode === 'moviles-zonas' || dataViewMode === 'saturacion';

      // Si no necesitamos ninguna de las dos capas en esta vista, salir
      if (!needsDemoras && !needsMovilesZonas) return;

      // Query minima para obtener ambas marcas de timestamp del servidor
      let serverDemoras: Date | null = null;
      let serverMovilesZonas: Date | null = null;
      let queryFailed = false;

      if (escId !== null && !forceAll) {
        if (isBreakerOpen()) {
          // Circuit abierto — saltar query directamente a fetch pesado, sin loguear.
          queryFailed = true;
        } else {
          try {
            // Las columnas demoras_last_api_update y moviles_zonas_last_api_update
            // se agregaron en Phase 1 pero los tipos generados aun no las incluyen.
            // Casteamos a unknown para saltear la validacion de la DB typedef.
            const { data: settingsData, error: settingsError } = await (supabase
              .from('escenario_settings')
              .select('demoras_last_api_update, moviles_zonas_last_api_update')
              .eq('escenario_id', escId)
              .single() as unknown as Promise<{
                data: { demoras_last_api_update: string | null; moviles_zonas_last_api_update: string | null } | null;
                error: unknown;
              }>);

            if (settingsError || !settingsData) {
              recordBreakerFailure(settingsError);
              queryFailed = true;
            } else {
              recordBreakerSuccess();
              serverDemoras = settingsData.demoras_last_api_update
                ? new Date(settingsData.demoras_last_api_update)
                : null;
              serverMovilesZonas = settingsData.moviles_zonas_last_api_update
                ? new Date(settingsData.moviles_zonas_last_api_update)
                : null;
            }
          } catch (err) {
            recordBreakerFailure(err);
            queryFailed = true;
          }
        }
      }

      try {
        // Demoras: requerido por TODAS las capas que muestran zonas inactivas
        // como transparente+punteado (todas excepto 'distribucion'). Sin esto,
        // al pasar de normal → saturacion las zonas inactivas se ven rellenas.
        if (needsDemoras) {
          const localDemoras = lastFetchedAt.current.demoras;
          const shouldFetchDemoras =
            queryFailed ||               // si fallo la query minima, fetch siempre (fallback)
            localDemoras === null ||      // primer tick: siempre fetchear
            serverDemoras === null ||     // columna aun sin valor → fetch por las dudas
            serverDemoras > localDemoras; // dato del servidor es mas nuevo que lo local

          if (shouldFetchDemoras) {
            console.log('Smart polling: demoras — hay cambios o primer fetch, fetching...');
            await fetchDemoras();
            lastFetchedAt.current.demoras = serverDemoras ?? new Date();
            if (escId !== null) persistLastFetch(escId);
          } else {
            console.log('Smart polling: demoras — sin cambios, skip');
          }
        }

        // Moviles en Zonas o Saturacion
        if (needsMovilesZonas) {
          const localMovilesZonas = lastFetchedAt.current.moviles_zonas;
          const shouldFetchMovilesZonas =
            queryFailed ||
            localMovilesZonas === null ||
            serverMovilesZonas === null ||
            serverMovilesZonas > localMovilesZonas;

          if (shouldFetchMovilesZonas) {
            console.log('Smart polling: moviles_zonas — hay cambios o primer fetch, fetching...');
            await fetchMovilesZonas();
            lastFetchedAt.current.moviles_zonas = serverMovilesZonas ?? new Date();
            if (escId !== null) persistLastFetch(escId);
          } else {
            console.log('Smart polling: moviles_zonas — sin cambios, skip');
          }
        }
      } catch (err) {
        console.error('Error loading data view:', err);
      }
    };

    // Carga inicial inmediata: en mount siempre fetchea (forceAll evita la query minima
    // cuando lastFetchedAt ya viene de localStorage con un valor reciente — no queremos
    // saltear el primer fetch aunque los timestamps parezcan iguales, porque el estado
    // React del componente esta vacio al montar).
    loadDataView(true);

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

    // Reactivar polling al volver al foco (evita que RD/tab en segundo plano lo suspenda).
    // Al volver visible, se hace un tick inmediato con smart polling (no forceAll):
    // si la data no cambio mientras estaba en segundo plano, no se hace fetch pesado.
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        if (!isToday) return; // fecha histórica — no tiene sentido recargar al volver al tab
        console.log('Tab visible — tick inmediato y reinicio de polling');
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
