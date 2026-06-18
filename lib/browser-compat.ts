/**
 * Deteccion de navegadores / sistemas operativos "legacy" que no renderizan
 * bien la app moderna (Tailwind v4 usa colores oklch() no soportados por
 * Chrome < 111, tipico en equipos con Windows 7 y navegadores viejos).
 *
 * Funciones puras (reciben el userAgent como parametro) para poder testearlas.
 * El wiring real lee `navigator.userAgent`.
 *
 * Nota: el FIX visual (fallbacks de color) se hace en globals.css con
 * `@supports not (color: oklch(...))`, que aplica automaticamente solo en los
 * navegadores afectados. Esta deteccion se usa para MOSTRAR un aviso amigable.
 */

/** Version minima de Chrome que soporta oklch() (Chrome 111, marzo 2023). */
export const MIN_CHROME_VERSION = 111;

export interface BrowserCompatInfo {
  /** Version mayor de Chrome/Chromium detectada, o null si no es Chrome. */
  chromeVersion: number | null;
  /** Version de Windows NT detectada (ej. 6.1 = Win7, 10.0 = Win10/11), o null. */
  windowsNtVersion: number | null;
  /** true si el SO es Windows anterior a 10 (NT < 10.0). */
  isOldWindows: boolean;
  /** true si es Chrome/Chromium por debajo de MIN_CHROME_VERSION. */
  isOldChrome: boolean;
  /** true si conviene mostrar el aviso (SO viejo o Chrome viejo). */
  isLegacy: boolean;
}

/** Extrae la version mayor de Chrome/Chromium del userAgent (null si no aplica). */
export function parseChromeVersion(ua: string): number | null {
  if (!ua) return null;
  // Edge legacy (EdgeHTML) y otros no-Chromium no matchean "Chrome/".
  const m = ua.match(/Chrom(?:e|ium)\/(\d+)/);
  if (!m) return null;
  const v = parseInt(m[1], 10);
  return Number.isFinite(v) ? v : null;
}

/** Extrae la version de Windows NT del userAgent (ej. 6.1, 10.0), null si no es Windows. */
export function parseWindowsNtVersion(ua: string): number | null {
  if (!ua) return null;
  const m = ua.match(/Windows NT (\d+(?:\.\d+)?)/);
  if (!m) return null;
  const v = parseFloat(m[1]);
  return Number.isFinite(v) ? v : null;
}

/**
 * Evalua compatibilidad a partir de un userAgent.
 *
 * Legacy si:
 *   - Windows NT < 10.0 (Windows 8.1 o anterior), o
 *   - Chrome/Chromium < MIN_CHROME_VERSION (sin soporte oklch → estilos rotos).
 */
export function getBrowserCompatInfo(ua: string): BrowserCompatInfo {
  const chromeVersion = parseChromeVersion(ua);
  const windowsNtVersion = parseWindowsNtVersion(ua);
  const isOldWindows = windowsNtVersion != null && windowsNtVersion < 10.0;
  const isOldChrome = chromeVersion != null && chromeVersion < MIN_CHROME_VERSION;
  return {
    chromeVersion,
    windowsNtVersion,
    isOldWindows,
    isOldChrome,
    isLegacy: isOldWindows || isOldChrome,
  };
}

/** Conveniencia: detecta legacy desde el navigator actual (SSR-safe → false). */
export function detectLegacyBrowser(): BrowserCompatInfo {
  if (typeof navigator === 'undefined') {
    return {
      chromeVersion: null,
      windowsNtVersion: null,
      isOldWindows: false,
      isOldChrome: false,
      isLegacy: false,
    };
  }
  return getBrowserCompatInfo(navigator.userAgent || '');
}
