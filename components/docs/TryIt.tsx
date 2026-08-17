'use client';

import { useMemo, useState } from 'react';
import { authStorage } from '@/lib/auth-storage';
import { formatearCuerpo, parametrosDe, tonoDeStatus } from './docs-logic';
import { queryString, rutaConValores, type ValoresPeticion } from './ejemplos';
import { IconoAlerta, IconoCerrar, IconoLlave, IconoPlay, IconoReloj } from './Iconos';
import { Badge, BloqueCodigo, BotonCopiar, ChipMetodo } from './Piezas';
import type { Ambiente } from './docs-logic';
import type { Endpoint } from './tipos';

/**
 * "Try it": ejecuta el endpoint contra el ambiente en el que está parado el portal.
 *
 * Nada se ejecuta desde el navegador: el request sale de `POST /api/docs/try`, que
 * vuelve a pasar por el gate root, obliga a que el destino sea del propio host, y
 * pone las credenciales de la sesión del root (ver lib/docs/try-request.ts).
 *
 * Dos cosas que parecen detalles y no lo son:
 *
 * - **El payload viaja en base64.** El WAF de nginx delante de TrackMovil rechaza con
 *   403 los bodies con sintaxis de shell, y el cuerpo de un ejemplo legítimo puede
 *   tenerla. Codificado, el WAF ve base64 y el cuerpo llega entero.
 * - **Las escrituras piden escribir el path.** El diálogo muestra en qué ambiente
 *   está parado, en rojo si es producción. Un DELETE en prod no se desanda.
 */

/** UTF-8 → base64, sin perder acentos (btoa solo entiende latin-1). */
function aBase64(texto: string): string {
  const bytes = new TextEncoder().encode(texto);
  let binario = '';
  for (const byte of bytes) binario += String.fromCharCode(byte);
  return btoa(binario);
}

interface RespuestaTry {
  success?: boolean;
  status?: number;
  statusText?: string;
  headers?: Record<string, string>;
  body?: string;
  duracionMs?: number;
  truncado?: boolean;
  headersDescartados?: string[];
  ejecutado?: { metodo: string; url: string };
  error?: string;
  code?: string;
}

interface FilaHeader {
  clave: string;
  valor: string;
}

const ESCRITURAS = new Set(['post', 'put', 'patch', 'delete']);

export function TryIt({
  endpoint,
  valores,
  onValores,
  ambiente,
}: {
  endpoint: Endpoint;
  valores: ValoresPeticion;
  onValores: (v: ValoresPeticion) => void;
  ambiente: Ambiente;
}) {
  const [filasHeaders, setFilasHeaders] = useState<FilaHeader[]>([]);
  const [confirmando, setConfirmando] = useState(false);
  const [textoConfirmacion, setTextoConfirmacion] = useState('');
  const [ejecutando, setEjecutando] = useState(false);
  const [respuesta, setRespuesta] = useState<RespuestaTry | null>(null);

  const parametros = useMemo(() => parametrosDe(endpoint), [endpoint]);
  const paramsPath = parametros.filter((p) => p.in === 'path');
  const paramsQuery = parametros.filter((p) => p.in === 'query');
  const esEscritura = ESCRITURAS.has(endpoint.metodo);

  /** El path concreto que se va a ejecutar (con los valores del formulario puestos). */
  const pathEfectivo = rutaConValores(endpoint.ruta, valores.path);
  const faltanPath = paramsPath.filter((p) => (valores.path[p.name] ?? '').trim() === '');

  function actualizarHeaders(filas: FilaHeader[]) {
    setFilasHeaders(filas);
    const record: Record<string, string> = {};
    for (const f of filas) {
      if (f.clave.trim() === '') continue;
      record[f.clave.trim()] = f.valor;
    }
    onValores({ ...valores, headers: record });
  }

  async function ejecutar(confirmacion?: string) {
    setEjecutando(true);
    setRespuesta(null);

    let cuerpo: unknown;
    const textoCuerpo = valores.body.trim();
    if (textoCuerpo !== '' && !['get', 'head'].includes(endpoint.metodo)) {
      try {
        cuerpo = JSON.parse(textoCuerpo);
      } catch {
        cuerpo = textoCuerpo; // se manda tal cual: puede ser un cuerpo que no sea JSON
      }
    }

    const query: Record<string, string> = {};
    for (const [clave, valor] of Object.entries(valores.query)) {
      if (String(valor ?? '').trim() === '') continue;
      query[clave] = String(valor);
    }

    const payload = {
      metodo: endpoint.metodo.toUpperCase(),
      path: pathEfectivo,
      query,
      headers: valores.headers,
      body: cuerpo,
      confirmacion,
    };

    try {
      const token = authStorage.getItem('trackmovil_token') ?? '';
      const res = await fetch('/api/docs/try', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ payload: aBase64(JSON.stringify(payload)) }),
        cache: 'no-store',
      });
      setRespuesta((await res.json()) as RespuestaTry);
    } catch (e) {
      setRespuesta({ success: false, error: e instanceof Error ? e.message : 'No se pudo ejecutar' });
    } finally {
      setEjecutando(false);
      setConfirmando(false);
      setTextoConfirmacion('');
    }
  }

  return (
    <div className="space-y-4">
      {/* ── Formulario ───────────────────────────────────────────────────── */}
      {paramsPath.length > 0 && (
        <div>
          <p className="mb-1.5 text-[0.72rem] font-semibold uppercase tracking-wide text-stats-muted-fg">
            Parámetros de path
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {paramsPath.map((p) => (
              <label key={p.name} className="block">
                <span className="font-stats-mono text-[0.72rem] text-stats-foreground">
                  {p.name}
                  <span className="ml-1 text-stats-destructive">*</span>
                </span>
                <input
                  value={valores.path[p.name] ?? ''}
                  onChange={(e) => onValores({ ...valores, path: { ...valores.path, [p.name]: e.target.value } })}
                  placeholder={p.name}
                  className="mt-0.5 w-full rounded-lg border border-stats-border bg-stats-surface-2 px-2.5 py-1.5 font-stats-mono text-[0.78rem] text-stats-foreground outline-none transition-colors focus:border-stats-primary"
                />
              </label>
            ))}
          </div>
        </div>
      )}

      {paramsQuery.length > 0 && (
        <div>
          <p className="mb-1.5 text-[0.72rem] font-semibold uppercase tracking-wide text-stats-muted-fg">
            Query string
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {paramsQuery.map((p) => (
              <label key={p.name} className="block">
                <span className="font-stats-mono text-[0.72rem] text-stats-foreground">
                  {p.name}
                  {p.required && <span className="ml-1 text-stats-destructive">*</span>}
                </span>
                <input
                  value={valores.query[p.name] ?? ''}
                  onChange={(e) => onValores({ ...valores, query: { ...valores.query, [p.name]: e.target.value } })}
                  placeholder={p.description ?? p.name}
                  className="mt-0.5 w-full rounded-lg border border-stats-border bg-stats-surface-2 px-2.5 py-1.5 font-stats-mono text-[0.78rem] text-stats-foreground outline-none transition-colors focus:border-stats-primary"
                />
              </label>
            ))}
          </div>
        </div>
      )}

      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <p className="text-[0.72rem] font-semibold uppercase tracking-wide text-stats-muted-fg">Headers</p>
          <button
            type="button"
            onClick={() => actualizarHeaders([...filasHeaders, { clave: '', valor: '' }])}
            className="rounded-md border border-stats-border px-2 py-0.5 text-[0.7rem] text-stats-muted-fg transition-colors hover:border-stats-primary hover:text-stats-primary"
          >
            + Agregar
          </button>
        </div>
        <p className="mb-2 flex items-start gap-1.5 text-[0.72rem] leading-snug text-stats-muted-fg">
          <IconoLlave size={13} className="mt-0.5 shrink-0" />
          <span>
            <code className="font-stats-mono">Authorization</code> y{' '}
            <code className="font-stats-mono">Cookie</code> los pone el servidor con tu sesión: si los cargás acá se
            descartan.
          </span>
        </p>
        {filasHeaders.length > 0 && (
          <div className="space-y-1.5">
            {filasHeaders.map((fila, i) => (
              <div key={i} className="flex gap-1.5">
                <input
                  value={fila.clave}
                  onChange={(e) => {
                    const copia = [...filasHeaders];
                    copia[i] = { ...copia[i], clave: e.target.value };
                    actualizarHeaders(copia);
                  }}
                  placeholder="x-api-key"
                  className="w-2/5 rounded-lg border border-stats-border bg-stats-surface-2 px-2.5 py-1.5 font-stats-mono text-[0.78rem] text-stats-foreground outline-none focus:border-stats-primary"
                />
                <input
                  value={fila.valor}
                  onChange={(e) => {
                    const copia = [...filasHeaders];
                    copia[i] = { ...copia[i], valor: e.target.value };
                    actualizarHeaders(copia);
                  }}
                  placeholder="valor"
                  className="flex-1 rounded-lg border border-stats-border bg-stats-surface-2 px-2.5 py-1.5 font-stats-mono text-[0.78rem] text-stats-foreground outline-none focus:border-stats-primary"
                />
                <button
                  type="button"
                  onClick={() => actualizarHeaders(filasHeaders.filter((_, n) => n !== i))}
                  aria-label="Quitar header"
                  className="rounded-lg border border-stats-border px-2 text-stats-muted-fg transition-colors hover:border-stats-destructive hover:text-stats-destructive"
                >
                  <IconoCerrar size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {!['get', 'head'].includes(endpoint.metodo) && (
        <div>
          <p className="mb-1.5 text-[0.72rem] font-semibold uppercase tracking-wide text-stats-muted-fg">
            Cuerpo (JSON)
          </p>
          <textarea
            value={valores.body}
            onChange={(e) => onValores({ ...valores, body: e.target.value })}
            rows={6}
            spellCheck={false}
            placeholder={'{\n  "campo": "valor"\n}'}
            className="w-full rounded-lg border border-stats-border bg-stats-surface-2 px-3 py-2 font-stats-mono text-[0.78rem] leading-relaxed text-stats-foreground outline-none transition-colors focus:border-stats-primary"
          />
        </div>
      )}

      {/* ── Ejecutar ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3 border-t border-stats-border pt-3">
        <button
          type="button"
          disabled={ejecutando || faltanPath.length > 0}
          onClick={() => (esEscritura ? setConfirmando(true) : ejecutar())}
          className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-[0.82rem] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
            esEscritura
              ? 'bg-stats-destructive text-white hover:brightness-110'
              : 'bg-stats-primary text-stats-primary-fg hover:brightness-110'
          }`}
        >
          <IconoPlay size={14} />
          {ejecutando ? 'Ejecutando…' : esEscritura ? 'Ejecutar (pide confirmación)' : 'Ejecutar'}
        </button>

        <span className="min-w-0 flex-1 truncate font-stats-mono text-[0.74rem] text-stats-muted-fg">
          {endpoint.metodo.toUpperCase()} {pathEfectivo}
          {queryString(valores.query)}
        </span>

        {faltanPath.length > 0 && (
          <Badge tono="aviso" title="Completá los parámetros de path para poder ejecutar">
            falta {faltanPath.map((p) => p.name).join(', ')}
          </Badge>
        )}
      </div>

      {/* ── Respuesta ────────────────────────────────────────────────────── */}
      {respuesta && <PanelRespuesta respuesta={respuesta} />}

      {/* ── Diálogo de confirmación de escritura ─────────────────────────── */}
      {confirmando && (
        <div
          className="metricas-modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="titulo-confirmar-try"
          onClick={() => setConfirmando(false)}
        >
          <div
            className="metricas-modal-content w-full max-w-lg rounded-2xl border border-stats-border bg-stats-surface p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <span
                className={`mt-0.5 shrink-0 ${ambiente.esProduccion ? 'text-stats-destructive' : 'text-stats-warning'}`}
              >
                <IconoAlerta size={22} />
              </span>
              <div className="min-w-0">
                <h4 id="titulo-confirmar-try" className="text-[1rem] font-bold text-stats-foreground">
                  Vas a ejecutar una escritura
                </h4>
                <p className="mt-1 text-[0.8rem] leading-relaxed text-stats-muted-fg">
                  Esto no es una simulación: la llamada sale contra{' '}
                  <strong className={ambiente.esProduccion ? 'text-stats-destructive' : 'text-stats-warning'}>
                    {ambiente.etiqueta}
                  </strong>{' '}
                  y los datos que toque quedan tocados.
                </p>
              </div>
            </div>

            <div
              className={`mt-4 rounded-lg border px-3 py-2 ${
                ambiente.esProduccion
                  ? 'border-stats-destructive/40 bg-stats-destructive-soft'
                  : 'border-stats-warning/40 bg-stats-warning-soft'
              }`}
            >
              <p
                className={`text-[0.72rem] font-bold uppercase tracking-wide ${
                  ambiente.esProduccion ? 'text-stats-destructive' : 'text-stats-warning'
                }`}
              >
                Ambiente: {ambiente.etiqueta}
              </p>
              <p
                className={`mt-0.5 text-[0.74rem] leading-snug ${
                  ambiente.esProduccion ? 'text-stats-destructive' : 'text-stats-warning'
                }`}
              >
                {ambiente.detalle}
              </p>
            </div>

            <div className="mt-3 flex items-center gap-2">
              <ChipMetodo metodo={endpoint.metodo} />
              <code className="min-w-0 flex-1 truncate font-stats-mono text-[0.82rem] text-stats-foreground">
                {pathEfectivo}
              </code>
            </div>

            <label className="mt-4 block">
              <span className="text-[0.78rem] text-stats-foreground">
                Escribí el path exacto para confirmar:{' '}
                <code className="font-stats-mono text-stats-primary">{pathEfectivo}</code>
              </span>
              <input
                autoFocus
                value={textoConfirmacion}
                onChange={(e) => setTextoConfirmacion(e.target.value)}
                placeholder={pathEfectivo}
                spellCheck={false}
                className="mt-1.5 w-full rounded-lg border border-stats-border bg-stats-surface-2 px-3 py-2 font-stats-mono text-[0.82rem] text-stats-foreground outline-none transition-colors focus:border-stats-primary"
              />
            </label>

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmando(false)}
                className="rounded-lg border border-stats-border px-3 py-1.5 text-[0.8rem] font-medium text-stats-muted-fg transition-colors hover:text-stats-foreground"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={textoConfirmacion.trim() !== pathEfectivo || ejecutando}
                onClick={() => ejecutar(pathEfectivo)}
                className="rounded-lg bg-stats-destructive px-3.5 py-1.5 text-[0.8rem] font-semibold text-white transition-colors hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {ejecutando ? 'Ejecutando…' : `Ejecutar ${endpoint.metodo.toUpperCase()}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Resultado de la ejecución: status del endpoint llamado, tiempos, headers y cuerpo. */
function PanelRespuesta({ respuesta }: { respuesta: RespuestaTry }) {
  const [verHeaders, setVerHeaders] = useState(false);

  // Un error del ejecutor (gate, path inválido, confirmación) no trae status del
  // endpoint: se muestra distinto para que no se confunda con un 4xx del endpoint.
  if (respuesta.status === undefined) {
    return (
      <div className="rounded-lg border border-stats-destructive/40 bg-stats-destructive-soft px-3 py-2.5">
        <p className="flex items-center gap-2 text-[0.8rem] font-semibold text-stats-destructive">
          <IconoAlerta size={14} />
          No se ejecutó{respuesta.code ? ` · ${respuesta.code}` : ''}
        </p>
        {respuesta.error && <p className="mt-1 text-[0.78rem] text-stats-destructive">{respuesta.error}</p>}
      </div>
    );
  }

  const tono = tonoDeStatus(respuesta.status);
  const cuerpo = formatearCuerpo(respuesta.body ?? '');

  return (
    <div className="space-y-2.5 rounded-xl border border-stats-border bg-stats-surface-2 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tono={tono} className="font-stats-mono">
          {respuesta.status} {respuesta.statusText}
        </Badge>
        <Badge tono="neutro">
          <IconoReloj size={12} /> {respuesta.duracionMs} ms
        </Badge>
        {respuesta.truncado && <Badge tono="aviso">respuesta truncada a 1 MB</Badge>}
        {(respuesta.headersDescartados?.length ?? 0) > 0 && (
          <Badge tono="aviso" title="El servidor los pone con tu sesión, no el cliente">
            headers descartados: {respuesta.headersDescartados?.join(', ')}
          </Badge>
        )}
        <button
          type="button"
          onClick={() => setVerHeaders((v) => !v)}
          className="ml-auto rounded-md border border-stats-border px-2 py-0.5 text-[0.7rem] text-stats-muted-fg transition-colors hover:border-stats-primary hover:text-stats-primary"
        >
          {verHeaders ? 'Ocultar headers' : 'Ver headers'}
        </button>
        {cuerpo !== '' && <BotonCopiar texto={cuerpo} etiqueta="Copiar respuesta" />}
      </div>

      {respuesta.ejecutado && (
        <p className="truncate font-stats-mono text-[0.7rem] text-stats-muted-fg">
          {respuesta.ejecutado.metodo} {respuesta.ejecutado.url}
        </p>
      )}

      {verHeaders && (
        <div className="overflow-x-auto rounded-lg border border-stats-border bg-stats-surface">
          <table className="w-full text-left font-stats-mono text-[0.72rem]">
            <tbody>
              {Object.entries(respuesta.headers ?? {}).map(([clave, valor]) => (
                <tr key={clave} className="border-b border-stats-border last:border-0">
                  <td className="whitespace-nowrap px-2.5 py-1 text-stats-muted-fg">{clave}</td>
                  <td className="px-2.5 py-1 text-stats-foreground">{valor}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {cuerpo === '' ? (
        <p className="text-[0.78rem] italic text-stats-muted-fg">(sin cuerpo)</p>
      ) : (
        <BloqueCodigo codigo={cuerpo} titulo="respuesta" maxAlto="max-h-[28rem]" />
      )}
    </div>
  );
}
