/**
 * Tests del logger central (lib/logger.ts).
 *
 * Cubre:
 *  - redacción de keys sensibles (exact match + substring)
 *  - case-insensitive
 *  - objetos anidados profundos
 *  - arrays de objetos
 *  - truncado de strings >500 chars
 *  - truncado de arrays >20 items
 *  - guard de referencias cíclicas
 *  - filtrado por LOG_LEVEL
 *  - verbose() gateado por LOG_VERBOSE=1
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { redact, logger, verbose } from '../lib/logger';

// ─────────────────────────────────────────────────────────────────────────────
// redact()
// ─────────────────────────────────────────────────────────────────────────────
describe('redact', () => {
  it('redacta keys sensibles con match exacto', () => {
    const out = redact({
      authorization: 'Bearer xyz',
      cookie: 'sid=abc',
      something: 'public',
    });
    expect(out).toEqual({
      authorization: '[REDACTED]',
      cookie: '[REDACTED]',
      something: 'public',
    });
  });

  it('es case-insensitive (Authorization, AUTH_TOKEN, X-API-KEY)', () => {
    const out = redact({
      Authorization: 'x',
      AUTH_TOKEN: 'y',
      'X-API-KEY': 'z',
      visible: 'ok',
    });
    expect(out).toEqual({
      Authorization: '[REDACTED]',
      AUTH_TOKEN: '[REDACTED]',
      'X-API-KEY': '[REDACTED]',
      visible: 'ok',
    });
  });

  it('redacta en objetos anidados (3+ niveles)', () => {
    const out = redact({
      level1: {
        level2: {
          level3: {
            password: 'p4ss',
            ok: 'visible',
          },
        },
      },
    });
    expect(out).toEqual({
      level1: {
        level2: {
          level3: {
            password: '[REDACTED]',
            ok: 'visible',
          },
        },
      },
    });
  });

  it('redacta en arrays de objetos', () => {
    const out = redact([
      { token: 'a', name: 'n1' },
      { token: 'b', name: 'n2' },
    ]);
    expect(out).toEqual([
      { token: '[REDACTED]', name: 'n1' },
      { token: '[REDACTED]', name: 'n2' },
    ]);
  });

  it('redacta keys que CONTIENEN "token" como substring (userToken, tokenizer)', () => {
    // Decisión documentada: preferimos falsos positivos a leaks. tokenizer
    // también termina redactado, lo cual es aceptable.
    const out = redact({
      userToken: 'xxx',
      tokenizer: 'algo',
      tok: 'visible',
    });
    expect(out).toEqual({
      userToken: '[REDACTED]',
      tokenizer: '[REDACTED]',
      tok: 'visible',
    });
  });

  it('trunca strings >500 chars', () => {
    const long = 'a'.repeat(600);
    const out = redact({ data: long }) as { data: string };
    expect(out.data.length).toBeLessThan(long.length);
    expect(out.data.endsWith('...[truncated]')).toBe(true);
  });

  it('trunca arrays >20 items', () => {
    const arr = Array.from({ length: 30 }, (_, i) => i);
    const out = redact(arr) as unknown[];
    expect(out.length).toBe(21); // 20 items + marker
    expect(out[20]).toBe('...[10 more items]');
  });

  it('maneja referencias cíclicas sin stack overflow', () => {
    const obj: Record<string, unknown> = { name: 'root' };
    obj.self = obj;
    expect(() => redact(obj)).not.toThrow();
    const out = redact(obj) as Record<string, unknown>;
    expect(out.name).toBe('root');
    expect(out.self).toBe('[Circular]');
  });

  it('detiene la recursión al alcanzar MAX_DEPTH (5)', () => {
    // 7 niveles de profundidad. El nivel 5 debería renderizarse como string.
    const deep: Record<string, unknown> = {};
    let cur = deep;
    for (let i = 0; i < 7; i++) {
      const next: Record<string, unknown> = {};
      cur.next = next;
      cur = next;
    }
    cur.password = 'leak';
    expect(() => redact(deep)).not.toThrow();
  });

  it('preserva primitivos no sensibles', () => {
    expect(redact(42)).toBe(42);
    expect(redact('hello')).toBe('hello');
    expect(redact(true)).toBe(true);
    expect(redact(null)).toBeNull();
    expect(redact(undefined)).toBeUndefined();
  });

  it('serializa Error con mensaje', () => {
    const err = new Error('boom');
    const out = redact(err) as { name: string; message: string };
    expect(out.name).toBe('Error');
    expect(out.message).toBe('boom');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// logger niveles
// ─────────────────────────────────────────────────────────────────────────────
describe('logger niveles', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let debugSpy: ReturnType<typeof vi.spyOn>;
  const originalLevel = process.env.LOG_LEVEL;
  const originalVerbose = process.env.LOG_VERBOSE;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
    debugSpy.mockRestore();
    if (originalLevel === undefined) delete process.env.LOG_LEVEL;
    else process.env.LOG_LEVEL = originalLevel;
    if (originalVerbose === undefined) delete process.env.LOG_VERBOSE;
    else process.env.LOG_VERBOSE = originalVerbose;
  });

  it('con LOG_LEVEL=error solo loguea errors', () => {
    process.env.LOG_LEVEL = 'error';
    logger.error('e');
    logger.warn('w');
    logger.info('i');
    logger.debug('d');
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
    expect(debugSpy).not.toHaveBeenCalled();
  });

  it('con LOG_LEVEL=info loguea error+warn+info pero no debug', () => {
    process.env.LOG_LEVEL = 'info';
    logger.error('e');
    logger.warn('w');
    logger.info('i');
    logger.debug('d');
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(debugSpy).not.toHaveBeenCalled();
  });

  it('con LOG_LEVEL=debug loguea todos los niveles', () => {
    process.env.LOG_LEVEL = 'debug';
    logger.error('e');
    logger.warn('w');
    logger.info('i');
    logger.debug('d');
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(debugSpy).toHaveBeenCalledTimes(1);
  });

  it('redacta Authorization en argumentos', () => {
    process.env.LOG_LEVEL = 'info';
    logger.info('req', { Authorization: 'Bearer leakme' });
    expect(logSpy).toHaveBeenCalledTimes(1);
    const args = logSpy.mock.calls[0];
    const payload = args[1] as Record<string, string>;
    expect(payload.Authorization).toBe('[REDACTED]');
  });

  it('verbose() solo loguea con LOG_VERBOSE=1', () => {
    process.env.LOG_LEVEL = 'debug';
    process.env.LOG_VERBOSE = '0';
    verbose('detalle', { foo: 'bar' });
    expect(logSpy).not.toHaveBeenCalled();

    process.env.LOG_VERBOSE = '1';
    verbose('detalle', { foo: 'bar' });
    expect(logSpy).toHaveBeenCalledTimes(1);
  });
});
