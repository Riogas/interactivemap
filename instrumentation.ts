/**
 * Next.js instrumentation hook — corre una vez al startup del proceso server.
 *
 * Si `process.env.LOG_FILTER` está seteada (ej. `LOG_FILTER=IMPORT-MOVILES`),
 * monkey-patchea `console.*` para que SOLO emita líneas cuyo primer argumento
 * string matchee el patrón (regex case-insensitive). El resto se silencia.
 *
 * Uso típico:
 *   LOG_FILTER=IMPORT-MOVILES   → solo logs prefijados [IMPORT-MOVILES]
 *   LOG_FILTER=IMPORT-MOVILES|FATAL → también líneas que digan FATAL
 *   (sin la var)                → comportamiento normal, todos los logs pasan
 *
 * El filtro NO depende de NODE_ENV: si está seteada, aplica siempre.
 *
 * Trade-off: console.error también queda filtrado. Si hay un crash que loguea
 * stack trace sin el prefijo, no lo verás. Para debug de crash, quitá la var
 * y reiniciá el proceso.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const filter = process.env.LOG_FILTER;
  if (!filter) return;

  let pattern: RegExp;
  try {
    pattern = new RegExp(filter, 'i');
  } catch {
    console.log(`[LOG-FILTER] Patrón inválido "${filter}", filtro deshabilitado`);
    return;
  }

  const origLog = console.log.bind(console);
  const origInfo = console.info.bind(console);
  const origWarn = console.warn.bind(console);
  const origError = console.error.bind(console);
  const origDebug = console.debug.bind(console);

  const wrap = (orig: (...args: unknown[]) => void) =>
    (...args: unknown[]) => {
      const first = args.length > 0 ? String(args[0]) : '';
      if (pattern.test(first)) orig(...args);
    };

  console.log = wrap(origLog);
  console.info = wrap(origInfo);
  console.warn = wrap(origWarn);
  console.error = wrap(origError);
  console.debug = wrap(origDebug);

  // Mensaje de bienvenida que sí pasa el filtro (auto-prefijado para que matchee
  // patrones como IMPORT-MOVILES, FATAL, etc. — usamos LOG-FILTER que matchea el
  // patrón regex 'IMPORT-MOVILES' por casualidad? No. Hardcodeamos el prefijo
  // [LOG-FILTER] usando origLog directo para que el user vea que el filtro está
  // activo aunque su patrón sea estricto).
  origLog(`[LOG-FILTER] Activo. Patrón: /${filter}/i — solo logs que matcheen pasan a stdout/stderr`);
}
