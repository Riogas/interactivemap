/**
 * Tests del cierre de /api/db/* del SecuritySuite (todas las operaciones pasan a
 * exigir JWT con firma verificada) desde el lado del CONSUMIDOR.
 *
 * El día que se setea el secreto de firma en el SecuritySuite, TODOS los tokens
 * vigentes se invalidan de golpe. Lo que se cubre acá es que ese deslogueo
 * masivo termine en un "volvé a entrar" y no en un callejón sin salida:
 *
 * 1. lib/permisos-securitysuite.ts — fetchPermisos distingue sesión muerta (401)
 *    de servicio sin configurar (503 permanente) de guard caído (503 transitorio)
 *    de error de red, y NO colapsa todo a un Set vacío (que es indistinguible de
 *    "este usuario no tiene permisos").
 * 1.b lib/securitysuite-guard.ts — el código del rechazo se lee del HEADER
 *    `x-auth-guard`, nunca del body: secapi manda prosa para humanos en `error`.
 * 2. lib/session-notice.ts — el motivo del deslogueo sobrevive la navegación a
 *    /login y es one-shot.
 * 3. lib/api-auth-gates.ts — requireAuthorizationHeader corta antes de proxiar
 *    cuando no hay credencial usable, y describirErrorUpstream traduce los
 *    códigos internos del SecuritySuite.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

import { fetchPermisos } from '../lib/permisos-securitysuite';
import {
  SESSION_NOTICE_KEY,
  AVISO_SESION_RECHAZADA,
  setSessionNotice,
  takeSessionNotice,
} from '../lib/session-notice';
import {
  describirErrorUpstream,
  requireAuthorizationHeader,
} from '../lib/api-auth-gates';
import { es503Permanente, leerCodigoGuard } from '../lib/securitysuite-guard';

// ─────────────────────────────────────────────────────────────────────────────
// fetchPermisos
// ─────────────────────────────────────────────────────────────────────────────

function jsonResponse(status: number, body: unknown, headers?: Record<string, string>): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: new Headers(headers ?? {}),
    json: async () => body,
  } as unknown as Response;
}

/**
 * Respuesta como la manda secapi de verdad: el body trae PROSA para humanos y el
 * código del guard viaja en el header `x-auth-guard`. Mockear el código en el
 * body es modelar algo que el servidor nunca emite (y hacía que la rama del
 * código fuera inalcanzable en producción).
 */
function respuestaGuard(status: number, codigo: string, mensaje = 'Error de autenticación'): Response {
  return jsonResponse(status, { success: false, error: mensaje }, { 'x-auth-guard': codigo });
}

describe('fetchPermisos — distinguir sesión muerta de error de red', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('200 con resultados GRANTED → estado ok con las acciones otorgadas', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        resultados: [
          { accionKey: 'stats', permitido: 'GRANTED' },
          { accionKey: 'ranking', permitido: 'DENIED' },
        ],
      }),
    ) as unknown as typeof fetch;

    const r = await fetchPermisos('tok');
    expect(r.estado).toBe('ok');
    if (r.estado !== 'ok') return;
    expect([...r.permisos]).toEqual(['stats']);
  });

  it('200 sin ninguna acción otorgada → estado ok con Set vacío (NO es sesión muerta)', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { resultados: [] })) as unknown as typeof fetch;

    const r = await fetchPermisos('tok');
    expect(r.estado).toBe('ok');
    if (r.estado !== 'ok') return;
    expect(r.permisos.size).toBe(0);
  });

  it('401 → sesion_invalida (token rechazado por el SecuritySuite)', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(respuestaGuard(401, 'TOKEN_INVALIDO')) as unknown as typeof fetch;

    expect((await fetchPermisos('tok')).estado).toBe('sesion_invalida');
  });

  it('503 con x-auth-guard SECRETO_NO_CONFIGURADO → servicio_no_configurado (permanente)', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(respuestaGuard(503, 'SECRETO_NO_CONFIGURADO')) as unknown as typeof fetch;

    expect((await fetchPermisos('tok')).estado).toBe('servicio_no_configurado');
  });

  it('503 con x-auth-guard ERROR_GUARD → servicio_caido (transitorio, se reintenta)', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(respuestaGuard(503, 'ERROR_GUARD')) as unknown as typeof fetch;

    expect((await fetchPermisos('tok')).estado).toBe('servicio_caido');
  });

  it('503 sin header cae en transitorio, NO en permanente (equivocarse hacia permanente deja a todos afuera)', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse(503, { error: 'Service Unavailable' })) as unknown as typeof fetch;

    expect((await fetchPermisos('tok')).estado).toBe('servicio_caido');
  });

  it('el CÓDIGO en el body (sin header) NO alcanza: secapi nunca lo manda ahí', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(503, { error: 'SECRETO_NO_CONFIGURADO' }),
      ) as unknown as typeof fetch;

    // Documenta el defecto que motivó el cambio: mirar el body era código muerto.
    expect((await fetchPermisos('tok')).estado).toBe('servicio_caido');
  });

  it('fetch que tira (red caída) → error_red, nunca sesion_invalida', async () => {
    global.fetch = vi
      .fn()
      .mockRejectedValue(new TypeError('Failed to fetch')) as unknown as typeof fetch;

    expect((await fetchPermisos('tok')).estado).toBe('error_red');
  });

  it('502 del proxy (upstream inalcanzable) → error_red, no cierra la sesión', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(502, { code: 'UPSTREAM_UNREACHABLE' }),
      ) as unknown as typeof fetch;

    expect((await fetchPermisos('tok')).estado).toBe('error_red');
  });

  it('200 con body ilegible → error_red (no sabemos qué otorgó, pero la sesión vive)', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => {
        throw new SyntaxError('Unexpected token <');
      },
    } as unknown as Response) as unknown as typeof fetch;

    expect((await fetchPermisos('tok')).estado).toBe('error_red');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// session-notice
// ─────────────────────────────────────────────────────────────────────────────

describe('session-notice — el motivo del deslogueo llega al login', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal('window', {
      sessionStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('guarda el motivo y lo devuelve una sola vez', () => {
    setSessionNotice(AVISO_SESION_RECHAZADA);
    expect(window.sessionStorage.getItem(SESSION_NOTICE_KEY)).toBe(AVISO_SESION_RECHAZADA);

    expect(takeSessionNotice()).toBe(AVISO_SESION_RECHAZADA);
    // One-shot: el próximo login no debe volver a ver el cartel.
    expect(takeSessionNotice()).toBeNull();
  });

  it('sin aviso guardado devuelve null', () => {
    expect(takeSessionNotice()).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// requireAuthorizationHeader / describirErrorUpstream
// ─────────────────────────────────────────────────────────────────────────────

function reqConHeaders(headers: Record<string, string>): NextRequest {
  return new NextRequest(new Request('http://localhost/x', { headers: new Headers(headers) }));
}

describe('requireAuthorizationHeader', () => {
  it('devuelve el header cuando trae credencial', () => {
    expect(requireAuthorizationHeader(reqConHeaders({ Authorization: 'Bearer abc.def' }))).toBe(
      'Bearer abc.def',
    );
  });

  it('sin header → 401 SIN_SESION', async () => {
    const r = requireAuthorizationHeader(reqConHeaders({}));
    expect(typeof r).not.toBe('string');
    if (typeof r === 'string') return;
    expect(r.status).toBe(401);
    expect((await r.json()).code).toBe('SIN_SESION');
  });

  it.each(['Bearer ', 'Bearer', 'Bearer null', 'Bearer undefined', '   '])(
    'header sin credencial usable (%j) → 401 SIN_SESION',
    async (valor) => {
      const r = requireAuthorizationHeader(reqConHeaders({ Authorization: valor }));
      expect(typeof r).not.toBe('string');
      if (typeof r === 'string') return;
      expect(r.status).toBe(401);
      expect((await r.json()).code).toBe('SIN_SESION');
    },
  );
});

describe('describirErrorUpstream', () => {
  it('401 → mensaje de sesión y oculta el detalle crudo del upstream', () => {
    const d = describirErrorUpstream(401);
    expect(d.code).toBe('SESION_INVALIDA');
    expect(d.error).toMatch(/sesión/i);
    // El cliente prioriza detail.error sobre error: dejar el detalle volvería a
    // mostrar "TOKEN_INVALIDO" en pantalla.
    expect(d.ocultarDetalle).toBe(true);
  });

  it('503 sin código → transitorio (mensaje de servicio no disponible, distinto del de sesión)', () => {
    const d = describirErrorUpstream(503);
    expect(d.code).toBe('UPSTREAM_NO_DISPONIBLE');
    expect(d.error).not.toMatch(/volvé a iniciar sesión/i);
  });

  it('503 SECRETO_NO_CONFIGURADO → permanente y con otro mensaje que el transitorio', () => {
    const permanente = describirErrorUpstream(503, 'SECRETO_NO_CONFIGURADO');
    const transitorio = describirErrorUpstream(503, 'ERROR_GUARD');
    expect(permanente.code).toBe('UPSTREAM_NO_CONFIGURADO');
    expect(transitorio.code).toBe('UPSTREAM_NO_DISPONIBLE');
    expect(permanente.error).not.toBe(transitorio.error);
  });

  it('403 conserva el detalle (sirve para diagnosticar el permiso faltante)', () => {
    const d = describirErrorUpstream(403);
    expect(d.code).toBe('SIN_PERMISO_UPSTREAM');
    expect(d.ocultarDetalle).toBe(false);
  });

  it('403 SIN_POLITICA no acusa al usuario: es un problema de configuración', () => {
    const d = describirErrorUpstream(403, 'SIN_POLITICA');
    expect(d.code).toBe('CONFIG_UPSTREAM');
    expect(d.error).toMatch(/configuración/i);
    expect(d.error).not.toMatch(/no tenés permisos/i);
  });

  it('otros status caen al genérico', () => {
    expect(describirErrorUpstream(500).code).toBe('UPSTREAM_ERROR');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// es503Permanente / leerCodigoGuard
// ─────────────────────────────────────────────────────────────────────────────

describe('es503Permanente — separar los DOS 503 de secapi', () => {
  it('SECRETO_NO_CONFIGURADO es permanente (ni reintentar ni re-loguearse sirven)', () => {
    expect(es503Permanente('SECRETO_NO_CONFIGURADO')).toBe(true);
    // Tolerante a espacios/caso: el header lo escribe otro servicio.
    expect(es503Permanente('  secreto_no_configurado ')).toBe(true);
  });

  it('ERROR_GUARD es transitorio (un hipo de Postgres no puede dejar a todos afuera)', () => {
    expect(es503Permanente('ERROR_GUARD')).toBe(false);
  });

  it.each([null, undefined, ''])('sin código (%j) cae en transitorio, nunca en permanente', (v) => {
    expect(es503Permanente(v)).toBe(false);
  });
});

describe('leerCodigoGuard', () => {
  it('lee x-auth-guard cuando está', () => {
    const res = { headers: new Headers({ 'x-auth-guard': 'TOKEN_VENCIDO' }) };
    expect(leerCodigoGuard(res)).toBe('TOKEN_VENCIDO');
  });

  it('no explota si la respuesta no tiene headers (mocks viejos, respuestas armadas a mano)', () => {
    expect(leerCodigoGuard({} as { headers?: Headers })).toBeNull();
  });
});
