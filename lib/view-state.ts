/**
 * view-state.ts — Persistencia ephemeral del estado visual del dashboard.
 *
 * Diseño:
 * - Snapshot en sessionStorage bajo una key versionada.
 * - TTL 10 minutos. Si el snapshot es más viejo, se descarta.
 * - Activación condicional via flag `RELOAD_FLAG_KEY`: solo se hidrata
 *   si el flag está presente (puesto por realtime-health antes del reload).
 * - F5 manual NO setea el flag → la hidratación no ocurre → comportamiento default.
 * - Sin imports de React ni globals de browser en el top-level del módulo.
 */

export const VIEW_STATE_VERSION = 'v1';
export const VIEW_STATE_KEY = 'tm:view-state:v1';
export const RELOAD_FLAG_KEY = 'tm:view-state:caused-by-realtime-reload';
const TTL_MS = 10 * 60 * 1000; // 10 minutos

// ---------------------------------------------------------------------------
// Tipos públicos
// ---------------------------------------------------------------------------

export interface MapState {
  center: [number, number];
  zoom: number;
  /** Bounds en formato [[sw_lat, sw_lng], [ne_lat, ne_lng]] */
  bounds?: [[number, number], [number, number]];
}

export type ModalSnapshot =
  | { type: 'saturacion'; entityId: number }
  | { type: 'pedidoPopup'; entityId: number }
  | { type: 'servicePopup'; entityId: number }
  | { type: 'movilPopup'; entityId: number }
  | { type: 'pedidosTable' }
  | { type: 'servicesTable' }
  | { type: 'zonaEstadisticas' }
  | { type: 'zonaView'; entityId: number | null }
  | { type: 'tracking' }
  | { type: 'leaderboard' }
  | { type: 'fleterasZonas' }
  | { type: 'zonasSinMovil' }
  | { type: 'movilesSinReportar' }
  | { type: 'zonasNoActivas' }
  | null;

export interface PanelScrolls {
  pedidos: number;
  moviles: number;
  empresas: number;
}

export interface ViewState {
  version: string;
  savedAt: number;
  map: MapState | null;
  selectedMoviles: number[];
  selectedEmpresas: number[];
  showPendientes: boolean;
  showCompletados: boolean;
  pedidosZonaFilter: 'pendientes' | 'sin_asignar' | 'atrasados';
  movilesZonasServiceFilter: string;
  modal: ModalSnapshot;
  panelScrolls: PanelScrolls;
}

// ---------------------------------------------------------------------------
// Helpers internos — defensivos contra ambientes sin window/sessionStorage
// ---------------------------------------------------------------------------

function getStorage(): Storage | null {
  try {
    if (typeof sessionStorage !== 'undefined') return sessionStorage;
  } catch {
    // En algunos entornos (SSR, test) sessionStorage puede lanzar
  }
  return null;
}

// ---------------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------------

/**
 * Persiste el snapshot en sessionStorage.
 * Silencia cualquier error (quota exceeded, etc.).
 */
export function saveViewState(state: ViewState): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(VIEW_STATE_KEY, JSON.stringify(state));
  } catch {
    // Quota exceeded u otro error — ignorar silenciosamente
  }
}

/**
 * Lee y valida el snapshot.
 * Retorna null si:
 * - No existe
 * - No es JSON válido
 * - La versión no coincide con VIEW_STATE_VERSION
 * - Expiró el TTL (>10 min)
 */
export function loadViewState(): ViewState | null {
  const storage = getStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(VIEW_STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ViewState>;
    // Validar versión
    if (parsed.version !== VIEW_STATE_VERSION) return null;
    // Validar TTL
    const savedAt = parsed.savedAt;
    if (typeof savedAt !== 'number' || Date.now() - savedAt > TTL_MS) return null;
    // Retornar con defaults para campos opcionales (forward-compat para snapshot parcial)
    return {
      version: parsed.version,
      savedAt: savedAt,
      map: parsed.map ?? null,
      selectedMoviles: Array.isArray(parsed.selectedMoviles) ? parsed.selectedMoviles : [],
      selectedEmpresas: Array.isArray(parsed.selectedEmpresas) ? parsed.selectedEmpresas : [],
      showPendientes: parsed.showPendientes ?? false,
      showCompletados: parsed.showCompletados ?? false,
      pedidosZonaFilter: parsed.pedidosZonaFilter ?? 'pendientes',
      movilesZonasServiceFilter: parsed.movilesZonasServiceFilter ?? 'URGENTE',
      modal: parsed.modal ?? null,
      panelScrolls: parsed.panelScrolls ?? { pedidos: 0, moviles: 0, empresas: 0 },
    };
  } catch {
    return null;
  }
}

/**
 * Elimina el snapshot del sessionStorage.
 */
export function clearViewState(): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.removeItem(VIEW_STATE_KEY);
  } catch {}
}

/**
 * Setea el flag que indica que el siguiente reload fue provocado por realtime-health.
 * Llamar ANTES de `window.location.reload()`.
 */
export function setReloadFlag(): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(RELOAD_FLAG_KEY, '1');
  } catch {}
}

/**
 * Retorna true si el flag de auto-reload está presente en sessionStorage.
 * No consume el flag — usar `consumeReloadFlag()` para eso.
 */
export function isRealtimeReload(): boolean {
  const storage = getStorage();
  if (!storage) return false;
  try {
    return storage.getItem(RELOAD_FLAG_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Consume (borra) el flag. Llamar una sola vez al hidratar.
 */
export function consumeReloadFlag(): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.removeItem(RELOAD_FLAG_KEY);
  } catch {}
}
