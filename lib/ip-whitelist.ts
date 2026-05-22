/**
 * Validacion y matching de patrones de IP con asteriscos como wildcard por octeto.
 *
 * Formato de patron:
 *   - 4 octetos separados por punto
 *   - Cada octeto es '*' o un numero 0-255
 *
 * Ejemplos validos:  '192.168.*.*', '10.0.0.*', '*.*.*.*', '127.0.0.1'
 * Ejemplos invalidos: '192.168.1', '192.168.*.256', 'abc', '192.*.*.*.5', ''
 */

// ==============================================================================
// VALIDACION DE PATRON
// ==============================================================================

/**
 * Valida si `pattern` es un patron de IP con asteriscos valido.
 * - 4 octetos separados por punto
 * - Cada octeto es '*' o un numero entero 0-255
 */
export function isValidIpPattern(pattern: string): boolean {
  if (!pattern || typeof pattern !== 'string') return false;

  const parts = pattern.split('.');
  if (parts.length !== 4) return false;

  for (const part of parts) {
    if (part === '*') continue;
    // Debe ser un entero 0-255 sin ceros a la izquierda (ej: '007' se rechaza)
    if (!/^\d+$/.test(part)) return false;
    const n = Number(part);
    if (n < 0 || n > 255) return false;
    // Rechazar ceros a la izquierda ('007', '01', etc.)
    if (String(n) !== part) return false;
  }

  return true;
}

// ==============================================================================
// CONVERSION A REGEXP
// ==============================================================================

/**
 * Convierte un patron con asteriscos a una RegExp anclada que valida:
 * - Que la IP matchea el patron de octetos
 * - Que cada octeto numerico (no wildcard) esta en rango 0-255
 *
 * Ejemplos:
 *   '192.168.*.*' → /^192\.168\.(\d|[1-9]\d|1\d\d|2[0-4]\d|25[0-5])\.(\d|...)$/
 *
 * NOTA: el regex para octetos wilcard valida 0-255 estrictamente.
 *
 * Precondicion: `pattern` debe pasar `isValidIpPattern`. Si no, el comportamiento
 * es indefinido (llamar solo con patterns validados).
 */
export function ipPatternToRegex(pattern: string): RegExp {
  // Regex para un octeto valido 0-255
  const OCTET_RE = '(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]\\d|\\d)';

  const parts = pattern.split('.');
  const regexParts = parts.map(part => {
    if (part === '*') return OCTET_RE;
    // Octeto fijo: escapar el numero literalmente
    return part.replace(/\./g, '\\.');
  });

  return new RegExp(`^${regexParts.join('\\.')}$`);
}

// ==============================================================================
// MATCHING
// ==============================================================================

/**
 * Retorna `true` si `ip` matchea al menos uno de los `patterns`.
 *
 * - Patterns invalidos son ignorados silenciosamente (defensa ante config corrupta).
 * - Array vacio siempre retorna `false`.
 * - `ip` debe ser una IP v4 normalizada (sin prefijo ::ffff:).
 */
export function ipMatchesAnyPattern(ip: string, patterns: string[]): boolean {
  if (!patterns || patterns.length === 0) return false;
  if (!ip || typeof ip !== 'string') return false;

  for (const pattern of patterns) {
    // Skip patterns invalidos — defensa ante config corrupta
    if (!isValidIpPattern(pattern)) continue;

    try {
      const regex = ipPatternToRegex(pattern);
      if (regex.test(ip)) return true;
    } catch {
      // Skip si por alguna razon el regex falla
      continue;
    }
  }

  return false;
}
