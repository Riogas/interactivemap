/**
 * Cliente de permisos contra el SecuritySuite (vía el proxy /api/auth/permisos).
 *
 * Vive fuera de contexts/AuthContext.tsx para poder testear el punto delicado:
 * distinguir "sesión muerta" de "no llegué a preguntar" de "este usuario no
 * tiene acciones otorgadas".
 */

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
 *  - 'servicio_no_configurado' (503) → al SecuritySuite le falta el secreto de
 *                               firma. Re-loguearse no arregla nada; es un
 *                               problema de infraestructura.
 *  - 'error_red'              → no llegamos a preguntar. Acá SÍ tiene sentido
 *                               degradar sin romper la sesión.
 */
export type ResultadoPermisos =
  | { estado: 'ok'; permisos: Set<string> }
  | { estado: 'sesion_invalida' }
  | { estado: 'servicio_no_configurado' }
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
    console.error(
      '⛔ fetchPermisos: el servicio de seguridad no está disponible/configurado (503)',
    );
    return { estado: 'servicio_no_configurado' };
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
