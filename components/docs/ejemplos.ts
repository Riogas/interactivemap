/**
 * Generación de los ejemplos copiables del visor: curl, fetch (JS) y VB6.
 *
 * Dos reglas:
 *
 * 1. **El host sale del ambiente en runtime** (`window.location.origin`), nunca una IP
 *    ni un host hardcodeado. El que copia el ejemplo estando en dev tiene que llevarse
 *    un comando que apunte a dev.
 * 2. **Los ejemplos reflejan lo que hay cargado en el formulario del "Try it"**: si el
 *    root completó el escenario y el cuerpo, el curl que copia es exactamente esa
 *    llamada, no una plantilla que después hay que editar.
 *
 * El ejemplo VB6 solo se genera si el endpoint declara un consumidor VB6 en
 * `docs/api/anotaciones.yaml` (`consumidores: [... VB6 ...]`).
 *
 * Todo puro: se testea en `components/docs/ejemplos.test.ts`.
 */

import { badgesAuth, esSinAuth, parametrosDe, tieneConsumidorVb6 } from './docs-logic';
import type { Endpoint } from './tipos';

export interface ValoresPeticion {
  /** Valores de los parámetros de path, por nombre. */
  path: Record<string, string>;
  /** Valores de query, por nombre. Los vacíos no se emiten. */
  query: Record<string, string>;
  /** Headers extra que el usuario cargó. */
  headers: Record<string, string>;
  /** Cuerpo crudo (texto). Se manda tal cual si es un JSON válido. */
  body: string;
}

export const VALORES_VACIOS: ValoresPeticion = { path: {}, query: {}, headers: {}, body: '' };

/**
 * Reemplaza `{param}` por el valor cargado, o por el nombre en mayúsculas como
 * placeholder. No se dejan las llaves: `curl` las interpreta como globbing y el
 * comando copiado fallaría con un error que no tiene nada que ver.
 */
export function rutaConValores(ruta: string, valores: Record<string, string>): string {
  return ruta.replace(/\{([^}]+)\}/g, (_, nombre: string) => {
    const valor = (valores[nombre] ?? '').trim();
    return valor !== '' ? encodeURIComponent(valor) : nombre.toUpperCase();
  });
}

/** Query string con los valores no vacíos, ya codificados. */
export function queryString(query: Record<string, string>): string {
  const params = new URLSearchParams();
  for (const [clave, valor] of Object.entries(query)) {
    if (valor === undefined || valor === null || String(valor).trim() === '') continue;
    params.set(clave, String(valor));
  }
  const qs = params.toString();
  return qs === '' ? '' : `?${qs}`;
}

/** URL completa del ejemplo, contra el origen del ambiente actual. */
export function urlDeEjemplo(origen: string, ruta: string, valores: ValoresPeticion): string {
  return `${origen.replace(/\/+$/, '')}${rutaConValores(ruta, valores.path)}${queryString(valores.query)}`;
}

/**
 * Headers que el ejemplo sugiere según cómo se autentica el endpoint.
 *
 * No inventa secretos: pone el nombre del header y un placeholder en mayúsculas.
 */
export function headersSugeridos(endpoint: Endpoint, valores: ValoresPeticion): Record<string, string> {
  const sugeridos: Record<string, string> = {};
  const etiquetas = badgesAuth(endpoint.op).map((b) => b.etiqueta);

  if (etiquetas.includes('x-api-key')) sugeridos['x-api-key'] = 'TU_API_KEY';
  if (etiquetas.includes('JWT root') || etiquetas.includes('JWT')) {
    sugeridos['Authorization'] = 'Bearer TU_TOKEN_DE_SECURITYSUITE';
  }
  if (endpoint.metodo !== 'get' && endpoint.metodo !== 'head') {
    sugeridos['Content-Type'] = 'application/json';
  }

  // Lo que cargó el usuario gana sobre la sugerencia.
  for (const [clave, valor] of Object.entries(valores.headers)) {
    if (String(valor ?? '').trim() === '') continue;
    sugeridos[clave] = valor;
  }
  return sugeridos;
}

/** Comentario de arranque de cada ejemplo, si el endpoint necesita una aclaración. */
function notaDeAuth(endpoint: Endpoint, comentario: string): string[] {
  const etiquetas = badgesAuth(endpoint.op).map((b) => b.etiqueta);
  const lineas: string[] = [];
  if (esSinAuth(endpoint.op)) {
    lineas.push(`${comentario} Este endpoint NO valida nada: alcanza con llegar al puerto.`);
  }
  if (etiquetas.includes('Sesión Supabase')) {
    lineas.push(`${comentario} Necesita la cookie de sesión de Supabase (la manda el navegador al estar logueado).`);
  }
  if (etiquetas.includes('token en body')) {
    lineas.push(`${comentario} El token va DENTRO del cuerpo (campo "token"), no en un header.`);
  }
  return lineas;
}

/** Escapa un texto para meterlo entre comillas simples en sh. */
function comillaSh(texto: string): string {
  return `'${texto.replace(/'/g, `'\\''`)}'`;
}

/** El cuerpo tal cual lo cargó el usuario; si está vacío, no hay cuerpo. */
function cuerpoDe(valores: ValoresPeticion): string | null {
  const texto = valores.body.trim();
  return texto === '' ? null : texto;
}

export function ejemploCurl(endpoint: Endpoint, origen: string, valores: ValoresPeticion): string {
  const url = urlDeEjemplo(origen, endpoint.ruta, valores);
  const metodo = endpoint.metodo.toUpperCase();
  const headers = headersSugeridos(endpoint, valores);
  const cuerpo = cuerpoDe(valores);

  const partes: string[] = [];
  partes.push(metodo === 'GET' ? `curl ${comillaSh(url)}` : `curl -X ${metodo} ${comillaSh(url)}`);
  for (const [clave, valor] of Object.entries(headers)) {
    if (clave.toLowerCase() === 'content-type' && cuerpo === null) continue;
    partes.push(`  -H ${comillaSh(`${clave}: ${valor}`)}`);
  }
  if (cuerpo !== null) partes.push(`  -d ${comillaSh(cuerpo)}`);

  return [...notaDeAuth(endpoint, '#'), partes.join(' \\\n')].join('\n');
}

export function ejemploFetch(endpoint: Endpoint, origen: string, valores: ValoresPeticion): string {
  const url = urlDeEjemplo(origen, endpoint.ruta, valores);
  const metodo = endpoint.metodo.toUpperCase();
  const headers = headersSugeridos(endpoint, valores);
  const cuerpo = cuerpoDe(valores);
  const usaSesion = badgesAuth(endpoint.op).some((b) => b.etiqueta === 'Sesión Supabase');

  const opciones: string[] = [`  method: '${metodo}',`];

  const entradasHeaders = Object.entries(headers).filter(
    ([clave]) => !(clave.toLowerCase() === 'content-type' && cuerpo === null),
  );
  if (entradasHeaders.length > 0) {
    opciones.push('  headers: {');
    for (const [clave, valor] of entradasHeaders) opciones.push(`    '${clave}': '${valor}',`);
    opciones.push('  },');
  }
  if (usaSesion) opciones.push(`  credentials: 'include',`);
  if (cuerpo !== null) opciones.push(`  body: ${JSON.stringify(cuerpo)},`);

  return [
    ...notaDeAuth(endpoint, '//'),
    `const res = await fetch('${url}', {`,
    ...opciones,
    '});',
    '',
    'const data = await res.json();',
    'console.log(res.status, data);',
  ].join('\n');
}

/** Escapa un texto para un literal de string de VB6 (las comillas se duplican). */
function comillaVb(texto: string): string {
  return `"${texto.replace(/"/g, '""')}"`;
}

/**
 * Ejemplo VB6 con `MSXML2.ServerXMLHTTP.6.0` — el objeto que usan las pantallas
 * viejas para hablar HTTP. Solo se genera si el endpoint declara consumidor VB6.
 */
export function ejemploVb6(endpoint: Endpoint, origen: string, valores: ValoresPeticion): string {
  const url = urlDeEjemplo(origen, endpoint.ruta, valores);
  const metodo = endpoint.metodo.toUpperCase();
  const headers = headersSugeridos(endpoint, valores);
  const cuerpo = cuerpoDe(valores);

  const lineas: string[] = [
    ...notaDeAuth(endpoint, `'`),
    'Dim http As Object',
    'Dim respuesta As String',
    '',
    'Set http = CreateObject("MSXML2.ServerXMLHTTP.6.0")',
    `http.Open ${comillaVb(metodo)}, ${comillaVb(url)}, False`,
  ];
  for (const [clave, valor] of Object.entries(headers)) {
    if (clave.toLowerCase() === 'content-type' && cuerpo === null) continue;
    lineas.push(`http.setRequestHeader ${comillaVb(clave)}, ${comillaVb(valor)}`);
  }
  lineas.push(cuerpo === null ? 'http.send' : `http.send ${comillaVb(cuerpo)}`);
  lineas.push(
    '',
    'respuesta = http.responseText',
    'If http.Status >= 200 And http.Status < 300 Then',
    '    Debug.Print respuesta',
    'Else',
    `    Debug.Print "Error " & http.Status & ": " & respuesta`,
    'End If',
  );
  return lineas.join('\n');
}

export interface EjemploRenderizable {
  id: string;
  titulo: string;
  /** Para el resaltado/etiqueta del bloque: 'bash', 'javascript', 'vb', 'texto'. */
  lenguaje: string;
  codigo: string;
}

/**
 * Los ejemplos de un endpoint: los generados (curl, fetch, y VB6 si corresponde) más
 * los que estén escritos a mano en `anotaciones.yaml`, que van al final porque son
 * llamadas reales y no plantillas.
 */
export function ejemplosDe(
  endpoint: Endpoint,
  origen: string,
  valores: ValoresPeticion = VALORES_VACIOS,
): EjemploRenderizable[] {
  const out: EjemploRenderizable[] = [
    { id: 'curl', titulo: 'curl', lenguaje: 'bash', codigo: ejemploCurl(endpoint, origen, valores) },
    { id: 'fetch', titulo: 'fetch (JS)', lenguaje: 'javascript', codigo: ejemploFetch(endpoint, origen, valores) },
  ];

  if (tieneConsumidorVb6(endpoint.op)) {
    out.push({ id: 'vb6', titulo: 'VB6', lenguaje: 'vb', codigo: ejemploVb6(endpoint, origen, valores) });
  }

  const anotados = endpoint.op['x-ejemplos'] ?? [];
  anotados.forEach((ej, i) => {
    const codigo = String(ej?.codigo ?? '').trimEnd();
    if (codigo === '') return;
    out.push({
      id: `anotado-${i}`,
      titulo: String(ej?.titulo ?? `Ejemplo ${i + 1}`),
      lenguaje: String(ej?.lenguaje ?? 'texto'),
      codigo,
    });
  });

  return out;
}

/**
 * Valores iniciales del formulario: los `example` declarados y el cuerpo de ejemplo
 * de las anotaciones, para que el "Try it" arranque con algo ejecutable y no en blanco.
 */
export function valoresIniciales(endpoint: Endpoint): ValoresPeticion {
  const path: Record<string, string> = {};
  const query: Record<string, string> = {};

  for (const p of parametrosDe(endpoint)) {
    const ejemplo = p.example === undefined || p.example === null ? '' : String(p.example);
    if (p.in === 'path') path[p.name] = ejemplo;
    else if (p.in === 'query') query[p.name] = ejemplo;
  }

  const contenidos = endpoint.op.requestBody?.content ?? {};
  const primero = Object.values(contenidos)[0];
  const ejemploCuerpo = primero?.example;
  const body =
    ejemploCuerpo === undefined || ejemploCuerpo === null
      ? ''
      : typeof ejemploCuerpo === 'string'
        ? ejemploCuerpo
        : JSON.stringify(ejemploCuerpo, null, 2);

  return { path, query, headers: {}, body };
}
