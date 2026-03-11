/**
 * 🔧 Debug Configuration
 * 
 * Flags globales para controlar qué logs se muestran en PM2.
 * Se pueden prender/apagar en runtime vía /api/debug/toggle sin reiniciar.
 * 
 * Uso:
 *   import { debugFlags, gpsLog } from '@/lib/debug-config';
 *   gpsLog('mensaje');           // Solo imprime si debugFlags.gps === true
 *   gpsLog.warn('advertencia');  // Solo imprime si debugFlags.gps === true
 */

export const debugFlags = {
  /** Logs de coordenadas GPS (encolamiento, flush, batching) */
  gps: false,
  /** Logs de importación movZonaServicio */
  movZonas: true,
};

/** Console.log condicional para GPS */
export function gpsLog(...args: any[]) {
  if (debugFlags.gps) console.log(...args);
}
gpsLog.warn = (...args: any[]) => { if (debugFlags.gps) console.warn(...args); };
gpsLog.error = (...args: any[]) => { /* errores SIEMPRE se muestran */ console.error(...args); };

/** Console.log condicional para movZonas */
export function movZonasLog(...args: any[]) {
  if (debugFlags.movZonas) console.log(...args);
}
movZonasLog.error = (...args: any[]) => { console.error(...args); };
