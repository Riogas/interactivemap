/**
 * Origen de confianza del portal `/docs`: contra qué URL ejecuta el "Try it" y qué
 * `servers` publica `GET /api/docs/spec`.
 *
 * ── Por qué NO sale de los headers del request ────────────────────────────────
 *
 * La versión anterior de este archivo armaba la base con `${x-forwarded-proto}://${Host}`
 * cuando no había env configurada — y no la había en ningún ambiente. El `Host` lo
 * elige quien manda el request, así que un root (o cualquiera que le hiciera abrir una
 * página) podía pedir `POST /api/docs/try` con `Host: 169.254.169.254` y el ejecutor
 * salía a buscar `http://169.254.169.254/api/...` **con el Bearer y el cookie jar del
 * root adentro**: SSRF con exfiltración de credenciales. La "red de seguridad" de
 * `construirUrl` no lo frenaba porque comparaba el destino contra esa misma base: una
 * comparación autorreferencial nunca rechaza nada.
 *
 * De acá en más el destino del fetch NUNCA sale de un header (`Host`,
 * `x-forwarded-host`, `Origin`, `Referer`: todos los elige el cliente). Orden de
 * resolución:
 *
 *   1. `DOCS_TRY_ORIGEN` — si está, se usa tal cual (única env, ver docs/api/README.md).
 *   2. Si no está: `http://127.0.0.1:<PORT del proceso>` (Next escribe `process.env.PORT`
 *      con el puerto real al arrancar; el default del repo es 3002).
 *   3. Nada más. Si no se puede resolver un origen de confianza, el ejecutor responde
 *      **503 ORIGEN_NO_CONFIGURADO** y no llama a nadie.
 *
 * El loopback es a propósito: el "Try it" llama a esta misma app, así que no necesita
 * salir a la red ni pasar por nginx. Si en algún ambiente hace falta que la llamada
 * entre por el proxy (por ejemplo para probar el WAF), se setea `DOCS_TRY_ORIGEN`.
 */

type Servidor = { url: string; description?: string };

/** La única env que define el origen. Un solo nombre, para que no haya cadenas de fallback. */
export const ENV_ORIGEN = 'DOCS_TRY_ORIGEN';

/** Puerto del repo (`.env.example`, `pm2.config.js`) cuando el proceso no expone `PORT`. */
export const PUERTO_POR_DEFECTO = '3002';

function normalizar(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

/** `PORT` del proceso, o el default del repo. `null` si está seteada con basura. */
function puertoDelProceso(env: NodeJS.ProcessEnv): string | null {
  const bruto = (env.PORT ?? '').trim();
  if (bruto === '') return PUERTO_POR_DEFECTO;
  if (!/^\d{1,5}$/.test(bruto)) return null;
  const numero = Number(bruto);
  if (numero < 1 || numero > 65535) return null;
  return String(numero);
}

/**
 * Origen contra el que se ejecuta y se documenta, o `null` si no se puede resolver uno
 * confiable (única causa: `DOCS_TRY_ORIGEN` mal escrita, o `PORT` con basura).
 *
 * Devuelve siempre un origen puro (`http://host:puerto`): si la env trae path, query o
 * credenciales, se descartan — el ejecutor solo alcanza `/api/...` de la raíz.
 *
 * @param env  para los tests; en runtime es `process.env`
 */
export function origenDeConfianza(env: NodeJS.ProcessEnv = process.env): string | null {
  const declarado = (env[ENV_ORIGEN] ?? '').trim();

  if (declarado !== '') {
    let url: URL;
    try {
      url = new URL(declarado);
    } catch {
      console.error(`[docs] ${ENV_ORIGEN}="${declarado}" no es una URL válida. El "Try it" queda cerrado.`);
      return null;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      console.error(`[docs] ${ENV_ORIGEN} tiene que ser http(s), no "${url.protocol}". El "Try it" queda cerrado.`);
      return null;
    }
    return url.origin;
  }

  const puerto = puertoDelProceso(env);
  if (puerto === null) {
    console.error(`[docs] PORT="${env.PORT}" no es un puerto válido y ${ENV_ORIGEN} no está seteada.`);
    return null;
  }

  return `http://127.0.0.1:${puerto}`;
}

/**
 * Devuelve los `servers` a publicar: el origen de confianza primero (es contra el que
 * se ejecuta el "Try it"), después los que trae el documento generado, sin repetir.
 *
 * No recibe el request a propósito: nada de lo que publica este documento se deriva de
 * un header. Los ejemplos copiables del visor usan `window.location.origin`, que es lo
 * que el root está mirando en la barra del navegador (components/docs/DocsViewer.tsx).
 *
 * @param generados el array `servers` del openapi.json generado (puede venir cualquier cosa)
 */
export function servidoresDelDocumento(generados: unknown): Servidor[] {
  const previos: Servidor[] = Array.isArray(generados)
    ? generados.filter(
        (s): s is Servidor =>
          typeof s === 'object' && s !== null && typeof (s as Servidor).url === 'string',
      )
    : [];

  const actual = origenDeConfianza();
  if (actual === null) return previos;

  const resto = previos.filter((s) => normalizar(s.url) !== actual);
  return [{ url: actual, description: 'origen del ejecutor (Try it)' }, ...resto];
}
