/**
 * Lógica pura del handoff de sesión entre pestañas (ver
 * docs/superpowers/specs/2026-06-30-handoff-sesion-pestanas-design.md).
 *
 * No importa nada del proyecto: solo arma/parsea los mensajes que viajan por el
 * BroadcastChannel y junta/aplica las keys de auth desde/hacia un storage abstracto.
 * El wiring del canal vive en contexts/AuthContext.tsx.
 */

/** Nombre del BroadcastChannel usado para el handoff. */
export const HANDOFF_CHANNEL = 'trackmovil-auth';

/**
 * Cuánto espera una pestaña nueva una respuesta del handoff antes de caer al
 * login. El round-trip por BroadcastChannel entre pestañas del mismo navegador
 * es sincrónico (<10ms desde una hermana activa), así que esta ventana es breve
 * a propósito: en una carga sin sesión (ej. kiosko de perfil nuevo, sin hermanas)
 * es tiempo de spinner muerto antes del login. 200ms deja ~20x de margen para el
 * handoff real (caso "Abrir mapa") y a la vez queda por debajo del umbral en que
 * el ojo percibe un "cargando".
 */
export const HANDOFF_TIMEOUT_MS = 200;

/**
 * Keys de auth que viven en sessionStorage (las que maneja authStorage).
 * `trackmovil_user` y `trackmovil_token` son obligatorias para que haya sesión.
 */
export const AUTH_KEYS = [
  'trackmovil_user',
  'trackmovil_token',
  'trackmovil_allowed_empresas',
  'trackmovil_allowed_escenarios',
  'trackmovil_escenario_id',
  'trackmovil_permisos',
  'trackmovil_last_activity',
] as const;

export type HandoffRequest = { type: 'REQUEST_SESSION'; nonce: string };
export type HandoffResponse = { type: 'SESSION_RESPONSE'; nonce: string; payload: Record<string, string> };
export type HandoffMessage = HandoffRequest | HandoffResponse;

/**
 * Junta de un storage las AUTH_KEYS presentes. Devuelve null si falta user o token
 * (no hay sesión transferible).
 */
export function collectSession(read: (k: string) => string | null): Record<string, string> | null {
  const user = read('trackmovil_user');
  const token = read('trackmovil_token');
  if (!user || !token) return null;

  const payload: Record<string, string> = {};
  for (const k of AUTH_KEYS) {
    const v = read(k);
    if (v !== null && v !== undefined) payload[k] = v;
  }
  return payload;
}

/** Escribe en el storage destino solo las AUTH_KEYS presentes en el payload. */
export function applySession(payload: Record<string, string>, write: (k: string, v: string) => void): void {
  for (const k of AUTH_KEYS) {
    const v = payload[k];
    if (typeof v === 'string') write(k, v);
  }
}

export function buildRequest(nonce: string): HandoffRequest {
  return { type: 'REQUEST_SESSION', nonce };
}

export function buildResponse(nonce: string, payload: Record<string, string>): HandoffResponse {
  return { type: 'SESSION_RESPONSE', nonce, payload };
}

export function isRequest(msg: unknown): msg is HandoffRequest {
  return (
    typeof msg === 'object' && msg !== null &&
    (msg as { type?: unknown }).type === 'REQUEST_SESSION' &&
    typeof (msg as { nonce?: unknown }).nonce === 'string'
  );
}

export function matchesResponse(msg: unknown, nonce: string): msg is HandoffResponse {
  return (
    typeof msg === 'object' && msg !== null &&
    (msg as { type?: unknown }).type === 'SESSION_RESPONSE' &&
    (msg as { nonce?: unknown }).nonce === nonce &&
    typeof (msg as { payload?: unknown }).payload === 'object' &&
    (msg as { payload?: unknown }).payload !== null
  );
}
