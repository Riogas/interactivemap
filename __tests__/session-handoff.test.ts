/**
 * Tests unitarios para lib/session-handoff.ts (lógica pura del handoff de sesión
 * entre pestañas). El wiring de BroadcastChannel se valida manualmente.
 */
import { describe, it, expect } from 'vitest';
import {
  AUTH_KEYS,
  collectSession,
  applySession,
  buildRequest,
  buildResponse,
  isRequest,
  matchesResponse,
} from '@/lib/session-handoff';

/** Crea un read/write sobre un objeto plano simulando un storage. */
function fakeStore(initial: Record<string, string> = {}) {
  const data: Record<string, string> = { ...initial };
  return {
    data,
    read: (k: string): string | null => (k in data ? data[k] : null),
    write: (k: string, v: string): void => { data[k] = v; },
  };
}

const FULL = {
  trackmovil_user: '{"id":"835","username":"supervisor"}',
  trackmovil_token: 'tok-abc',
  trackmovil_allowed_empresas: '[1,2]',
  trackmovil_allowed_escenarios: '[1000]',
  trackmovil_escenario_id: '1000',
  trackmovil_permisos: '["stats"]',
  trackmovil_last_activity: '1782828973000',
};

describe('collectSession()', () => {
  it('junta todas las AUTH_KEYS presentes', () => {
    const { read } = fakeStore(FULL);
    expect(collectSession(read)).toEqual(FULL);
  });

  it('devuelve null si falta el token', () => {
    const { trackmovil_token, ...rest } = FULL;
    const { read } = fakeStore(rest);
    expect(collectSession(read)).toBeNull();
  });

  it('devuelve null si falta el user', () => {
    const { trackmovil_user, ...rest } = FULL;
    const { read } = fakeStore(rest);
    expect(collectSession(read)).toBeNull();
  });

  it('ignora keys opcionales ausentes', () => {
    const min = { trackmovil_user: FULL.trackmovil_user, trackmovil_token: FULL.trackmovil_token };
    const { read } = fakeStore(min);
    expect(collectSession(read)).toEqual(min);
  });

  it('solo considera AUTH_KEYS (ignora keys ajenas)', () => {
    const { read } = fakeStore({ ...FULL, otra_cosa: 'x' });
    const result = collectSession(read);
    expect(result).not.toBeNull();
    expect(Object.keys(result!).every((k) => AUTH_KEYS.includes(k as any))).toBe(true);
  });
});

describe('applySession()', () => {
  it('escribe las keys del payload y el roundtrip preserva', () => {
    const dst = fakeStore();
    applySession(FULL, dst.write);
    expect(collectSession(dst.read)).toEqual(FULL);
  });

  it('escribe solo las AUTH_KEYS del payload (ignora ajenas)', () => {
    const dst = fakeStore();
    applySession({ ...FULL, hack: 'no' }, dst.write);
    expect('hack' in dst.data).toBe(false);
  });
});

describe('protocolo de mensajes', () => {
  it('buildRequest / isRequest', () => {
    const req = buildRequest('n1');
    expect(req).toEqual({ type: 'REQUEST_SESSION', nonce: 'n1' });
    expect(isRequest(req)).toBe(true);
    expect(isRequest(buildResponse('n1', FULL))).toBe(false);
    expect(isRequest(null)).toBe(false);
    expect(isRequest({ type: 'REQUEST_SESSION' })).toBe(false);
  });

  it('buildResponse / matchesResponse exige type + nonce correctos', () => {
    const res = buildResponse('n1', FULL);
    expect(res).toEqual({ type: 'SESSION_RESPONSE', nonce: 'n1', payload: FULL });
    expect(matchesResponse(res, 'n1')).toBe(true);
    expect(matchesResponse(res, 'otro')).toBe(false);
    expect(matchesResponse(buildRequest('n1'), 'n1')).toBe(false);
    expect(matchesResponse({ type: 'SESSION_RESPONSE', nonce: 'n1' }, 'n1')).toBe(false);
    expect(matchesResponse(null, 'n1')).toBe(false);
  });
});
