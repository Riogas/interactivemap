/**
 * Intenta recuperar texto con mojibake (Latin-1 guardado como UTF-8 mal decodificado).
 *
 * Caso más común con GeneXus/AS400:
 *   - El dato original es UTF-8: "ñ" = bytes [0xC3, 0xB1]
 *   - Fue leído como Latin-1, así cada byte se convirtió en un char individual
 *   - Quedó guardado como "Ã±" (U+00C3 + U+00B1) en lugar de "ñ"
 *
 * Esta función revierte ese proceso: toma los code points como bytes y
 * los decodifica como UTF-8.
 *
 * Si el resultado contiene U+FFFD (caracteres irrecuperables), devuelve
 * el string original para no empeorar la situación.
 */
export function fixEncoding(str: string | null | undefined): string {
  if (!str) return str ?? '';

  // Chequeo rápido: si todos los chars son ASCII, no hay nada que corregir
  if (!/[^\x00-\x7F]/.test(str)) return str;

  try {
    // Tomar los code points como bytes (funciona para chars en rango 0x00–0xFF)
    const bytes = new Uint8Array([...str].map(c => c.charCodeAt(0) & 0xFF));
    const decoded = new TextDecoder('utf-8', { fatal: false }).decode(bytes);

    // Solo usar el resultado si no introdujo replacement chars (U+FFFD)
    // y si hay al menos un char que mejoró (algún char > 0xFF pasó a ser legible)
    if (!decoded.includes('\uFFFD') && decoded !== str) {
      return decoded;
    }
  } catch {
    // Fallback silencioso
  }

  // Si no se pudo recuperar, al menos limpiar el replacement char visualmente
  return str.replace(/\uFFFD/g, '?');
}

/**
 * Aplica fixEncoding a un objeto: corrige todos los valores string recursivamente.
 * Útil para limpiar toda una respuesta de API de una sola vez.
 */
export function fixObjectEncoding<T extends Record<string, unknown>>(obj: T): T {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      result[key] = fixEncoding(value);
    } else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = fixObjectEncoding(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }
  return result as T;
}
