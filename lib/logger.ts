/**
 * Logger del endpoint de import de móviles.
 *
 * Cuando `process.env.LOG_FILTER` está seteado (ej. `LOG_FILTER=IMPORT-MOVILES`),
 * `instrumentation.ts` monkey-patchea `console.*` y solo deja pasar líneas
 * cuyo primer argumento string matchee el patrón. Estas funciones siempre
 * prefijan `[IMPORT-MOVILES]`, así que pasan el filtro automáticamente.
 *
 * Sin filtro activo, los logs salen igual que antes — el prefijo es solo
 * visual.
 *
 * Para activar logs verbose adicionales (paso-a-paso de cada movil del lote,
 * shapes intermedios, queries Supabase): setear `IMPORT_VERBOSE=1`.
 */

const PREFIX = '[IMPORT-MOVILES]';
const VERBOSE = process.env.IMPORT_VERBOSE === '1';

export const importLog = (...args: unknown[]): void => {
  console.log(PREFIX, ...args);
};

export const importWarn = (...args: unknown[]): void => {
  console.warn(PREFIX, ...args);
};

export const importError = (...args: unknown[]): void => {
  console.error(PREFIX, ...args);
};

/** Solo emite si IMPORT_VERBOSE=1. Útil para paso-a-paso ruidoso. */
export const importDebug = (...args: unknown[]): void => {
  if (VERBOSE) console.log(PREFIX, '[DEBUG]', ...args);
};
