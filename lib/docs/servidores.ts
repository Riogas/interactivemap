/**
 * Lista de `servers` del documento OpenAPI, resuelta en TIEMPO DE SERVIDO.
 *
 * Por qué no está en docs/api/openapi.json: ese archivo vive en el repo, y el repo se
 * clona. Las direcciones internas (`http://192.168.2.22:3002` y compañía) no van
 * versionadas — el generador deja solo el hostname público y el ambiente concreto se
 * agrega acá, cuando `GET /api/docs/spec` responde.
 *
 * De dónde sale, en orden:
 *   1. `DOCS_BASE_URL` — si se quiere fijar explícitamente qué URL usa el "Try it".
 *   2. `APP_BASE_URL` — la que ya usa la app para llamarse a sí misma server-to-server.
 *   3. el `Host` del request (con `x-forwarded-proto` si nginx lo manda).
 *
 * El valor es informativo/operativo (mostrar y ejecutar contra el ambiente en el que
 * está parado el root que abrió el portal). No decide permisos: eso es el root-guard.
 */

type Servidor = { url: string; description?: string };

function normalizar(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

/** URL base del ambiente en el que corre este proceso, o null si no se puede saber. */
export function servidorActual(request: { headers: Headers }): string | null {
  const porEnv = normalizar(process.env.DOCS_BASE_URL ?? process.env.APP_BASE_URL ?? '');
  if (porEnv !== '') return porEnv;

  const host = request.headers.get('host');
  if (!host) return null;

  // Detrás de nginx el request llega por http aunque el cliente hable https.
  const proto = (request.headers.get('x-forwarded-proto') ?? '').split(',')[0].trim() || 'http';
  return normalizar(`${proto}://${host}`);
}

/**
 * Devuelve los `servers` a publicar: el ambiente actual primero (es contra el que se
 * ejecuta el "Try it"), después los que trae el documento generado, sin repetir.
 *
 * @param request  el request que se está sirviendo
 * @param generados el array `servers` del openapi.json generado (puede venir cualquier cosa)
 */
export function servidoresDelDocumento(
  request: { headers: Headers },
  generados: unknown,
): Servidor[] {
  const previos: Servidor[] = Array.isArray(generados)
    ? generados.filter(
        (s): s is Servidor =>
          typeof s === 'object' && s !== null && typeof (s as Servidor).url === 'string',
      )
    : [];

  const actual = servidorActual(request);
  if (actual === null) return previos;

  const resto = previos.filter((s) => normalizar(s.url) !== actual);
  return [{ url: actual, description: 'ambiente actual' }, ...resto];
}
