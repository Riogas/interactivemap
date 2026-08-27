/**
 * Cliente de permisos contra el SecuritySuite (vía el proxy /api/auth/permisos).
 *
 * Vive fuera de contexts/AuthContext.tsx para poder testear el punto delicado:
 * distinguir "sesión muerta" de "no llegué a preguntar" de "este usuario no
 * tiene acciones otorgadas".
 */

import { es503Permanente, leerCodigoGuard } from './securitysuite-guard';

/**
 * Cada cuánto se revalida la sesión contra el SecuritySuite mientras la app
 * está abierta (contexts/AuthContext.tsx).
 *
 * Por qué hace falta un intervalo y no alcanza con revalidar al montar: el
 * kiosko de pared se monta UNA vez y queda días abierto (el rollover de
 * medianoche es un setTimeout que cambia estado, no un reload). Sin intervalo,
 * un token que muere al tercer día no lo detecta nadie — que es exactamente el
 * caso que motivó todo esto.
 *
 * 10 minutos es el compromiso: la pantalla de pared se entera del token muerto
 * en menos de lo que tarda alguien en pasar por ahí, y /api/db/permisos —el
 * endpoint más caliente del ecosistema— recibe 6 requests por hora por pestaña.
 */
export const REVALIDACION_PERMISOS_INTERVAL_MS = 10 * 60 * 1000;

// Acciones de permisos consultadas al Security Suite
export const PERMISOS_A_CONSULTAR = [
  { ObjetoKey: 'dashboard', AccionKey: 'stats' },
  { ObjetoKey: 'dashboard', AccionKey: 'date' },
  { ObjetoKey: 'dashboard', AccionKey: 'updptsventa' },
  { ObjetoKey: 'dashboard', AccionKey: 'asigmovil' },
  { ObjetoKey: 'dashboard', AccionKey: 'configzonaemp' },
  { ObjetoKey: 'dashboard', AccionKey: 'ranking' },
];

/**
 * Resultado de consultar permisos al SecuritySuite.
 *
 * Por qué NO alcanza con devolver un `Set<string>`: un Set vacío por sesión
 * muerta es indistinguible de "este usuario no tiene ninguna acción otorgada".
 * Colapsar los dos casos dejaba al usuario adentro de la app con TODO
 * deshabilitado y sin ningún cartel — se lee como un bug de permisos, no como
 * una sesión vencida. En Modo Kiosko es peor: esa sesión no expira nunca por
 * inactividad, así que la pantalla simplemente dejaba de mostrar datos.
 *
 *  - 'ok'                     → hay respuesta; `permisos` puede estar vacío y eso
 *                               significa de verdad "sin acciones otorgadas".
 *  - 'sesion_invalida'  (401) → el SecuritySuite rechazó el token. Hay que
 *                               avisar y mandar a re-login.
 *  - 'servicio_no_configurado' (503 + x-auth-guard: SECRETO_NO_CONFIGURADO) →
 *                               al SecuritySuite le falta el secreto de firma.
 *                               Es PERMANENTE: ni reintentar ni re-loguearse lo
 *                               arreglan.
 *  - 'servicio_caido'   (503 sin ese código, típicamente ERROR_GUARD) → el guard
 *                               del SecuritySuite falló (p.ej. Postgres no
 *                               contesta). Es TRANSITORIO: se degrada igual que
 *                               un error de red y se reintenta.
 *  - 'error_red'              → no llegamos a preguntar. Acá SÍ tiene sentido
 *                               degradar sin romper la sesión.
 *
 * La distinción entre los dos 503 no es cosmética: colapsarlos hacía que un hipo
 * de Postgres a milisegundos de un login YA ACEPTADO dejara a todo el mundo
 * afuera, con un cartel que decía "volvé a intentar" para algo que iba a fallar
 * idéntico. Ver lib/securitysuite-guard.ts.
 */
export type ResultadoPermisos =
  | { estado: 'ok'; permisos: Set<string> }
  | { estado: 'sesion_invalida' }
  | { estado: 'servicio_no_configurado' }
  | { estado: 'servicio_caido' }
  | { estado: 'error_red' };

export async function fetchPermisos(token: string): Promise<ResultadoPermisos> {
  let res: Response;
  try {
    res = await fetch('/api/auth/permisos', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        aplicacion: 'RiogasTracking',
        permisos: PERMISOS_A_CONSULTAR,
      }),
    });
  } catch (e) {
    console.warn('⚠️ fetchPermisos: no se pudo contactar el servicio de permisos', e);
    return { estado: 'error_red' };
  }

  if (res.status === 401) {
    console.warn('⚠️ fetchPermisos: el SecuritySuite rechazó la sesión (401)');
    return { estado: 'sesion_invalida' };
  }

  if (res.status === 503) {
    // Cuál de los dos 503 es se lee del HEADER x-auth-guard, nunca del body: el
    // guard de secapi manda prosa para humanos en `error` y el código en el
    // header (ver lib/securitysuite-guard.ts). El proxy /api/auth/permisos lo
    // reenvía tal cual para que esta rama pueda decidir.
    const codigo = leerCodigoGuard(res);
    if (es503Permanente(codigo)) {
      console.error(
        '⛔ fetchPermisos: al SecuritySuite le falta el secreto de firma (503 SECRETO_NO_CONFIGURADO) — reintentar no sirve',
      );
      return { estado: 'servicio_no_configurado' };
    }
    console.warn(
      `⚠️ fetchPermisos: el SecuritySuite falló de forma transitoria (503${codigo ? ` ${codigo}` : ''}) — se reintenta`,
    );
    return { estado: 'servicio_caido' };
  }

  if (!res.ok) {
    console.warn('⚠️ fetchPermisos: respuesta no OK', res.status);
    return { estado: 'error_red' };
  }

  try {
    const data = await res.json();
    const granted = new Set<string>();

    if (Array.isArray(data.resultados)) {
      for (const r of data.resultados) {
        if (r.permitido === 'GRANTED') {
          granted.add(r.accionKey as string);
        }
      }
    }

    console.log('✅ Permisos cargados:', [...granted]);
    return { estado: 'ok', permisos: granted };
  } catch (e) {
    // 200 con body ilegible: no sabemos qué otorgó. No es sesión muerta.
    console.warn('⚠️ fetchPermisos: respuesta ilegible', e);
    return { estado: 'error_red' };
  }
}
