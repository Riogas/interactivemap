/**
 * 🔐 Logger central con redacción automática de secretos
 *
 * Wrapper sobre `console` que:
 *  - Filtra por nivel (`LOG_LEVEL`: error | warn | info | debug)
 *  - Redacta automáticamente keys sensibles (Authorization, Cookie, tokens, etc.)
 *  - Trunca strings largos y arrays gigantes para no inundar PM2
 *  - Maneja referencias cíclicas sin caer en stack overflow
 *  - Expone `verbose()` adicional gateado por `LOG_VERBOSE=1` para detalles
 *    ruidosos (headers/bodies completos del proxy, etc.)
 *
 * Uso típico (drop-in para console):
 *
 *   import { logger, verbose } from '@/lib/logger';
 *
 *   logger.info('proxy request', { method, url, hasAuth: !!authHeader });
 *   verbose('proxy detail', { headers, body }); // solo si LOG_VERBOSE=1
 *   logger.error('upload falló', err);
 */

type LogLevel = 'error' | 'warn' | 'info' | 'debug';

const LEVEL_ORDER: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

const SENSITIVE_KEYS_LOWER = new Set<string>([
  'authorization',
  'cookie',
  'token',
  'password',
  'apikey',
  'api-key',
  'api_key',
  'secret',
  'x-api-key',
  'bearer',
  'service_role_key',
  'service-role-key',
  'gps_tracking_token',
  'internal_api_key',
  'db_password',
  'set-cookie',
]);

const REDACTED = '[REDACTED]';
const CIRCULAR = '[Circular]';
const MAX_DEPTH = 5;
const MAX_STRING_LEN = 500;
const MAX_ARRAY_ITEMS = 20;

/**
 * Decide si una key debe ser redactada.
 *
 * Regla: la key (lowercased) debe coincidir EXACTAMENTE con un nombre sensible
 * conocido, O contener uno de los tokens canónicos (`token`, `password`,
 * `secret`, `bearer`, `apikey`) como substring. Esto cubre variantes como
 * `userToken`, `AUTH_TOKEN`, `dbPassword`, etc., al precio de redactar también
 * cosas como `tokenizer` (decisión consciente: preferimos falsos positivos a
 * leaks accidentales).
 */
function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  if (SENSITIVE_KEYS_LOWER.has(lower)) return true;
  return (
    lower.includes('token') ||
    lower.includes('password') ||
    lower.includes('secret') ||
    lower.includes('bearer') ||
    lower.includes('apikey') ||
    lower.includes('api_key') ||
    lower.includes('api-key')
  );
}

function truncateString(s: string): string {
  if (s.length <= MAX_STRING_LEN) return s;
  return s.slice(0, MAX_STRING_LEN) + '...[truncated]';
}

function redactInternal(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (value === null || value === undefined) return value;

  const t = typeof value;
  if (t === 'string') return truncateString(value as string);
  if (t === 'number' || t === 'boolean' || t === 'bigint') return value;
  if (t === 'function') return `[Function: ${(value as { name?: string }).name || 'anonymous'}]`;
  if (t === 'symbol') return (value as symbol).toString();

  if (depth >= MAX_DEPTH) return '[MaxDepth]';

  if (value instanceof Error) {
    return {
      name: value.name,
      message: truncateString(value.message),
      stack: value.stack ? truncateString(value.stack) : undefined,
    };
  }

  if (value instanceof Date) return value.toISOString();

  if (Array.isArray(value)) {
    if (seen.has(value)) return CIRCULAR;
    seen.add(value);
    const limited = value.slice(0, MAX_ARRAY_ITEMS).map((v) => redactInternal(v, depth + 1, seen));
    if (value.length > MAX_ARRAY_ITEMS) {
      limited.push(`...[${value.length - MAX_ARRAY_ITEMS} more items]`);
    }
    return limited;
  }

  if (t === 'object') {
    const obj = value as Record<string, unknown>;
    if (seen.has(obj)) return CIRCULAR;
    seen.add(obj);
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj)) {
      if (isSensitiveKey(key)) {
        out[key] = REDACTED;
      } else {
        out[key] = redactInternal(obj[key], depth + 1, seen);
      }
    }
    return out;
  }

  return value;
}

/**
 * Aplica redacción + truncado a un objeto cualquiera. Exportado por si algún
 * caller necesita preparar payloads antes de loguearlos por otra vía.
 */
export function redact<T>(obj: T): T {
  return redactInternal(obj, 0, new WeakSet()) as T;
}

function getCurrentLevel(): LogLevel {
  const raw = (process.env.LOG_LEVEL || '').toLowerCase();
  if (raw === 'error' || raw === 'warn' || raw === 'info' || raw === 'debug') {
    return raw;
  }
  return process.env.NODE_ENV === 'production' ? 'info' : 'debug';
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] <= LEVEL_ORDER[getCurrentLevel()];
}

function formatPrefix(level: LogLevel): string {
  return `[${level.toUpperCase()}] [${new Date().toISOString()}]`;
}

function emit(level: LogLevel, msg: string, args: unknown[]): void {
  if (!shouldLog(level)) return;
  const safeArgs = args.map((a) => redact(a));
  const prefix = formatPrefix(level);
  // Mapeo a console.* preservando los niveles de DevTools.
  const sink =
    level === 'error' ? console.error
    : level === 'warn' ? console.warn
    : level === 'debug' ? console.debug
    : console.log;
  if (safeArgs.length === 0) {
    sink(`${prefix} ${msg}`);
  } else {
    sink(`${prefix} ${msg}`, ...safeArgs);
  }
}

export const logger = {
  error: (msg: string, ...args: unknown[]): void => emit('error', msg, args),
  warn: (msg: string, ...args: unknown[]): void => emit('warn', msg, args),
  info: (msg: string, ...args: unknown[]): void => emit('info', msg, args),
  debug: (msg: string, ...args: unknown[]): void => emit('debug', msg, args),
};

/**
 * Log verbose, gateado por `LOG_VERBOSE=1`. Independiente del LOG_LEVEL.
 * Pensado para ruido high-frequency (proxy headers, bodies, traces de
 * desarrollo) que NO queremos en producción ni siquiera con `LOG_LEVEL=debug`.
 */
export function verbose(msg: string, ...args: unknown[]): void {
  if (process.env.LOG_VERBOSE !== '1') return;
  const safeArgs = args.map((a) => redact(a));
  const prefix = `[VERBOSE] [${new Date().toISOString()}]`;
  if (safeArgs.length === 0) {
    console.log(`${prefix} ${msg}`);
  } else {
    console.log(`${prefix} ${msg}`, ...safeArgs);
  }
}
