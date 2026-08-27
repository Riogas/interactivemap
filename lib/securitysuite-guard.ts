/**
 * Códigos del guard del SecuritySuite (secapi) y cómo leerlos.
 *
 * OJO — esto es lo que se tuvo mal la primera vez: **secapi NO manda el código
 * en el body**. Su `denegar()` (security_suite/src/lib/auth/apiGuard.ts) responde
 *
 *     { success: false, error: mensajeDe(code) }        // prosa para humanos
 *     headers: { "x-auth-guard": code }                  // el código va ACÁ
 *
 * así que comparar `json.error === 'SECRETO_NO_CONFIGURADO'` es código muerto
 * para todo lo que pase por el guard (o sea, todo `/api/db/*`).
 *
 * ÚNICA EXCEPCIÓN: `POST /api/db/login` es de nivel PUBLICA, no pasa por
 * `denegar()`, y su 503 sí trae `{ error: 'SECRETO_NO_CONFIGURADO' }` en el body
 * (security_suite/src/lib/auth/responses.ts). Ahí — y solo ahí — mirar el body
 * es lo correcto.
 *
 * Este módulo es compartido cliente/servidor a propósito: no importa nada de
 * `next/server` para que el bundle del browser no arrastre el runtime de rutas.
 */

/** Header donde el guard del SecuritySuite manda el CÓDIGO del rechazo. */
export const HEADER_AUTH_GUARD = 'x-auth-guard';

/** Valores posibles de `x-auth-guard`. */
export type CodigoGuard =
  | 'SIN_TOKEN'
  | 'TOKEN_INVALIDO'
  | 'TOKEN_VENCIDO'
  | 'USUARIO_NO_ENCONTRADO'
  | 'NO_ROOT'
  | 'SIN_POLITICA'
  | 'SECRETO_NO_CONFIGURADO'
  | 'ERROR_GUARD';

/**
 * ¿Este 503 es PERMANENTE?
 *
 * secapi devuelve 503 en dos casos que NO son lo mismo, y tratarlos igual es un
 * error en las dos direcciones:
 *
 *  - `SECRETO_NO_CONFIGURADO` → falta (o es inválida) `JWT_SECRET`. Es
 *    permanente: reintentar no sirve y re-loguearse tampoco; hay que tocar la
 *    configuración del servidor.
 *  - `ERROR_GUARD` → el guard falló resolviendo al usuario (típicamente Postgres
 *    no contesta). Es transitorio: reintentar SÍ sirve.
 *
 * Default cuando no hay código (503 de un proxy intermedio, de nginx, de un
 * timeout): **transitorio**. La asimetría es deliberada — equivocarse hacia
 * "permanente" deja a todo el mundo afuera por un hipo de la base, mientras que
 * equivocarse hacia "transitorio" solo hace que se reintente y se degrade.
 */
export function es503Permanente(codigo: string | null | undefined): boolean {
  return (codigo ?? '').trim().toUpperCase() === 'SECRETO_NO_CONFIGURADO';
}

/**
 * Lee `x-auth-guard` de una respuesta sin asumir que `headers` exista.
 *
 * Los tests (y algún mock viejo) arman respuestas como objetos planos
 * `{ status, ok, json }` sin `headers`; sin este guard, leer el código haría
 * explotar el camino de error, que es justo el que no puede fallar.
 */
export function leerCodigoGuard(res: { headers?: Headers | null }): string | null {
  try {
    return res?.headers?.get?.(HEADER_AUTH_GUARD) ?? null;
  } catch {
    return null;
  }
}
