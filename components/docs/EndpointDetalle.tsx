'use client';

import { useMemo, useState } from 'react';
import {
  badgesAuth,
  consumidoresDe,
  esSinAuth,
  parametrosDe,
  tonoDeStatus,
  type Ambiente,
} from './docs-logic';
import { ejemplosDe, valoresIniciales, type ValoresPeticion } from './ejemplos';
import {
  IconoAlerta,
  IconoArchivo,
  IconoCodigo,
  IconoEnchufe,
  IconoEscudo,
  IconoInfo,
  IconoPlay,
  IconoUsuarios,
} from './Iconos';
import { Badge, BloqueCodigo, BotonCopiar, ChipMetodo, Seccion, SinAnotar, TextoLargo } from './Piezas';
import { TryIt } from './TryIt';
import type { Endpoint } from './tipos';

/**
 * Ficha completa de un endpoint: qué hace, cómo se autentica, quién lo consume, qué
 * recibe, qué devuelve, qué falla, cómo se llama y —abajo de todo— cómo probarlo.
 *
 * Los ejemplos se generan con los valores que haya cargados en el formulario del
 * "Try it", así que el curl que se copia es exactamente la llamada que se ejecutó.
 */
export function EndpointDetalle({
  endpoint,
  origen,
  ambiente,
}: {
  endpoint: Endpoint;
  origen: string;
  ambiente: Ambiente;
}) {
  const [valores, setValores] = useState<ValoresPeticion>(() => valoresIniciales(endpoint));

  const op = endpoint.op;
  const badges = badgesAuth(op);
  const sinAuth = esSinAuth(op);
  const consumidores = consumidoresDe(op);
  const parametros = parametrosDe(endpoint);
  const ejemplos = useMemo(() => ejemplosDe(endpoint, origen, valores), [endpoint, origen, valores]);
  const [ejemploActivo, setEjemploActivo] = useState(0);

  const respuestas = Object.entries(op.responses ?? {}).sort(
    (a, b) => Number(a[0]) - Number(b[0]),
  );
  const errores = op['x-errores'] ?? [];
  const cuerpo = op.requestBody;
  const contenidoCuerpo = Object.entries(cuerpo?.content ?? {})[0];
  const urlCompleta = `${origen}${endpoint.ruta}`;

  return (
    <div className="mx-auto max-w-4xl space-y-4 px-4 py-5 sm:px-6">
      {/* ── Encabezado ───────────────────────────────────────────────────── */}
      <header className="rounded-xl border border-stats-border bg-stats-surface p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-2 text-[0.72rem] text-stats-muted-fg">
          <span className="font-stats-mono uppercase tracking-wide text-stats-primary">{endpoint.modulo}</span>
          {op['x-archivo'] && (
            <>
              <span aria-hidden="true">·</span>
              <span className="inline-flex items-center gap-1 font-stats-mono">
                <IconoArchivo size={12} />
                {op['x-archivo']}
              </span>
            </>
          )}
          {op['x-anotado'] ? (
            <Badge tono="ok" className="ml-auto">
              anotado a mano
            </Badge>
          ) : (
            <Badge tono="neutro" className="ml-auto" title="Sin entrada en docs/api/anotaciones.yaml">
              solo generado
            </Badge>
          )}
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <ChipMetodo metodo={endpoint.metodo} className="text-[0.78rem]" />
          <code className="min-w-0 break-all font-stats-mono text-[1.05rem] font-semibold text-stats-foreground">
            {endpoint.ruta}
          </code>
          <BotonCopiar texto={urlCompleta} etiqueta="Copiar URL" className="ml-auto" />
        </div>

        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {badges.map((b) => (
            <Badge key={b.etiqueta} tono={b.tono} title={b.detalle}>
              {b.tono === 'peligro' ? <IconoAlerta size={12} /> : <IconoEscudo size={12} />}
              {b.etiqueta}
            </Badge>
          ))}
          {op.deprecated && <Badge tono="aviso">deprecado</Badge>}
        </div>

        {sinAuth && (
          <p className="mt-3 flex items-start gap-2 rounded-lg border border-stats-destructive/40 bg-stats-destructive-soft px-3 py-2 text-[0.78rem] leading-snug text-stats-destructive">
            <IconoAlerta size={15} className="mt-0.5 shrink-0" />
            <span>
              Este endpoint <strong>no valida nada</strong>: el handler no invoca ningún gate, así que lo puede
              llamar cualquiera que llegue al puerto. Es información sensible y es la razón por la que este portal
              es solo-root.
            </span>
          </p>
        )}

        {op.summary && <p className="mt-3 text-[0.88rem] font-medium text-stats-foreground">{op.summary}</p>}
      </header>

      {op.description && op.description.trim() !== op.summary?.trim() && (
        <Seccion titulo="Qué hace" icono={<IconoInfo size={15} />}>
          <TextoLargo>{op.description}</TextoLargo>
        </Seccion>
      )}

      {/* ── Autenticación ────────────────────────────────────────────────── */}
      <Seccion
        titulo="Autenticación"
        icono={<IconoEscudo size={15} />}
        hint="Lo que el handler invoca de verdad, leído del código por el generador."
      >
        <div className="space-y-2">
          {sinAuth ? (
            <p className="text-[0.82rem] font-medium text-stats-destructive">
              Ningún gate. Cualquier request que llegue al puerto se atiende.
            </p>
          ) : (
            <ul className="space-y-1">
              {(op['x-auth']?.gates ?? []).map((g) => (
                <li key={g} className="flex items-start gap-2 text-[0.82rem] text-stats-foreground">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-stats-primary" />
                  <code className="font-stats-mono">{g}</code>
                </li>
              ))}
            </ul>
          )}

          {(op['x-auth']?.funcionalidades?.length ?? 0) > 0 && (
            <p className="text-[0.8rem] text-stats-muted-fg">
              Funcionalidades exigidas:{' '}
              {op['x-auth']?.funcionalidades?.map((f) => (
                <code key={f} className="mr-1 rounded bg-stats-surface-2 px-1 py-0.5 font-stats-mono text-[0.76rem]">
                  {f}
                </code>
              ))}
            </p>
          )}

          {op['x-auth-nota'] && (
            <div className="rounded-lg border border-stats-border bg-stats-surface-2 px-3 py-2">
              <TextoLargo className="text-stats-foreground">{op['x-auth-nota']}</TextoLargo>
            </div>
          )}
        </div>
      </Seccion>

      {/* ── Consumidores ─────────────────────────────────────────────────── */}
      <Seccion titulo="Quién lo consume" icono={<IconoUsuarios size={15} />}>
        {consumidores.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5">
            {consumidores.map((c) => (
              <li key={c}>
                <Badge tono="neutro">
                  <IconoEnchufe size={12} />
                  {c}
                </Badge>
              </li>
            ))}
          </ul>
        ) : (
          <SinAnotar>
            Sin anotar. Si sabés quién llama a este endpoint, agregalo en{' '}
            <code className="font-stats-mono">docs/api/anotaciones.yaml</code> — es el dato que ningún generador
            puede inferir.
          </SinAnotar>
        )}
      </Seccion>

      {/* ── Parámetros ───────────────────────────────────────────────────── */}
      <Seccion titulo="Parámetros" icono={<IconoCodigo size={15} />}>
        {parametros.length === 0 ? (
          <SinAnotar>No recibe parámetros de path ni de query.</SinAnotar>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] text-left text-[0.78rem]">
              <thead>
                <tr className="border-b border-stats-border text-[0.7rem] uppercase tracking-wide text-stats-muted-fg">
                  <th className="py-1.5 pr-3 font-medium">Nombre</th>
                  <th className="py-1.5 pr-3 font-medium">En</th>
                  <th className="py-1.5 pr-3 font-medium">Tipo</th>
                  <th className="py-1.5 pr-3 font-medium">Req.</th>
                  <th className="py-1.5 font-medium">Descripción</th>
                </tr>
              </thead>
              <tbody>
                {parametros.map((p) => (
                  <tr key={`${p.in}-${p.name}`} className="border-b border-stats-border align-top last:border-0">
                    <td className="py-1.5 pr-3 font-stats-mono text-stats-foreground">{p.name}</td>
                    <td className="py-1.5 pr-3 text-stats-muted-fg">{p.in}</td>
                    <td className="py-1.5 pr-3 font-stats-mono text-stats-muted-fg">{p.schema?.type ?? 'string'}</td>
                    <td className="py-1.5 pr-3">
                      {p.required ? (
                        <span className="font-medium text-stats-destructive">sí</span>
                      ) : (
                        <span className="text-stats-muted-fg">no</span>
                      )}
                    </td>
                    <td className="py-1.5 text-stats-muted-fg">{p.description ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Seccion>

      {/* ── Cuerpo del request ───────────────────────────────────────────── */}
      {endpoint.metodo !== 'get' && endpoint.metodo !== 'head' && (
        <Seccion titulo="Cuerpo del request" icono={<IconoCodigo size={15} />}>
          {cuerpo ? (
            <div className="space-y-3">
              {cuerpo.description && <TextoLargo>{cuerpo.description}</TextoLargo>}
              {(cuerpo['x-campos']?.length ?? 0) > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[30rem] text-left text-[0.78rem]">
                    <thead>
                      <tr className="border-b border-stats-border text-[0.7rem] uppercase tracking-wide text-stats-muted-fg">
                        <th className="py-1.5 pr-3 font-medium">Campo</th>
                        <th className="py-1.5 pr-3 font-medium">Tipo</th>
                        <th className="py-1.5 pr-3 font-medium">Req.</th>
                        <th className="py-1.5 font-medium">Descripción</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cuerpo['x-campos']?.map((c) => (
                        <tr key={c.nombre} className="border-b border-stats-border align-top last:border-0">
                          <td className="py-1.5 pr-3 font-stats-mono text-stats-foreground">{c.nombre}</td>
                          <td className="py-1.5 pr-3 font-stats-mono text-stats-muted-fg">{c.tipo ?? '—'}</td>
                          <td className="py-1.5 pr-3">
                            {c.requerido ? (
                              <span className="font-medium text-stats-destructive">sí</span>
                            ) : (
                              <span className="text-stats-muted-fg">no</span>
                            )}
                          </td>
                          <td className="py-1.5 text-stats-muted-fg">{c.descripcion ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {contenidoCuerpo?.[1]?.example !== undefined && (
                <BloqueCodigo
                  titulo={contenidoCuerpo[0]}
                  codigo={
                    typeof contenidoCuerpo[1].example === 'string'
                      ? String(contenidoCuerpo[1].example)
                      : JSON.stringify(contenidoCuerpo[1].example, null, 2)
                  }
                />
              )}
            </div>
          ) : (
            <SinAnotar>
              Sin schema anotado. El generador no infiere cuerpos: se documentan en{' '}
              <code className="font-stats-mono">anotaciones.yaml</code> (clave <code>cuerpo:</code>).
            </SinAnotar>
          )}
        </Seccion>
      )}

      {/* ── Respuestas ───────────────────────────────────────────────────── */}
      <Seccion
        titulo="Respuestas"
        icono={<IconoInfo size={15} />}
        hint="Los códigos que el handler devuelve, leídos de sus `status:`."
      >
        {respuestas.length === 0 ? (
          <SinAnotar>Sin respuestas declaradas.</SinAnotar>
        ) : (
          <ul className="space-y-2.5">
            {respuestas.map(([codigo, resp]) => {
              const ejemplo = Object.values(resp?.content ?? {})[0]?.example;
              return (
                <li key={codigo} className="border-b border-stats-border pb-2.5 last:border-0 last:pb-0">
                  <div className="flex items-center gap-2">
                    <Badge tono={tonoDeStatus(Number(codigo))} className="font-stats-mono">
                      {codigo}
                    </Badge>
                    <span className="text-[0.82rem] text-stats-foreground">{resp?.description ?? '—'}</span>
                  </div>
                  {ejemplo !== undefined && (
                    <div className="mt-2">
                      <BloqueCodigo
                        titulo={`ejemplo ${codigo}`}
                        maxAlto="max-h-64"
                        codigo={typeof ejemplo === 'string' ? ejemplo : JSON.stringify(ejemplo, null, 2)}
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Seccion>

      {/* ── Errores conocidos ────────────────────────────────────────────── */}
      <Seccion
        titulo="Errores conocidos"
        icono={<IconoAlerta size={15} />}
        hint="Lo que falla en la práctica y qué hacer cuando pasa."
      >
        {errores.length === 0 ? (
          <SinAnotar>
            Sin errores anotados. Los códigos de arriba salen del código; lo que se sabe por experiencia va en{' '}
            <code className="font-stats-mono">anotaciones.yaml</code> (clave <code>errores:</code>).
          </SinAnotar>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] text-left text-[0.78rem]">
              <thead>
                <tr className="border-b border-stats-border text-[0.7rem] uppercase tracking-wide text-stats-muted-fg">
                  <th className="py-1.5 pr-3 font-medium">Código</th>
                  <th className="py-1.5 pr-3 font-medium">Cuándo</th>
                  <th className="py-1.5 font-medium">Qué hacer</th>
                </tr>
              </thead>
              <tbody>
                {errores.map((e, i) => (
                  <tr key={`${e.codigo}-${i}`} className="border-b border-stats-border align-top last:border-0">
                    <td className="whitespace-nowrap py-1.5 pr-3">
                      <span className="font-stats-mono text-stats-destructive">{e.codigo ?? '—'}</span>
                      {e.code && <div className="font-stats-mono text-[0.7rem] text-stats-muted-fg">{e.code}</div>}
                    </td>
                    <td className="py-1.5 pr-3 text-stats-foreground">{e.cuando ?? '—'}</td>
                    <td className="py-1.5 text-stats-muted-fg">{e.solucion ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Seccion>

      {/* ── Notas ────────────────────────────────────────────────────────── */}
      {op['x-notas'] && (
        <Seccion titulo="Notas" icono={<IconoInfo size={15} />}>
          <TextoLargo>{op['x-notas']}</TextoLargo>
        </Seccion>
      )}

      {/* ── Ejemplos ─────────────────────────────────────────────────────── */}
      <Seccion
        titulo="Ejemplos"
        icono={<IconoCodigo size={15} />}
        hint="Contra el host de este ambiente, con los valores que tengas cargados abajo."
      >
        <div className="mb-2.5 flex flex-wrap gap-1.5">
          {ejemplos.map((ej, i) => (
            <button
              key={ej.id}
              type="button"
              onClick={() => setEjemploActivo(i)}
              className={`rounded-lg px-2.5 py-1 text-[0.76rem] font-medium transition-colors ${
                i === ejemploActivo
                  ? 'bg-stats-primary text-stats-primary-fg'
                  : 'border border-stats-border text-stats-muted-fg hover:border-stats-primary hover:text-stats-primary'
              }`}
            >
              {ej.titulo}
            </button>
          ))}
        </div>
        {ejemplos[ejemploActivo] && (
          <BloqueCodigo
            codigo={ejemplos[ejemploActivo].codigo}
            titulo={ejemplos[ejemploActivo].titulo}
            lenguaje={ejemplos[ejemploActivo].lenguaje}
          />
        )}
      </Seccion>

      {/* ── Try it ───────────────────────────────────────────────────────── */}
      <Seccion
        titulo="Probar"
        icono={<IconoPlay size={15} />}
        hint="La llamada sale del servidor, contra este mismo ambiente, con tu sesión."
        acciones={
          <Badge tono={ambiente.esProduccion ? 'peligro' : 'aviso'} title={ambiente.detalle}>
            {ambiente.etiqueta}
          </Badge>
        }
      >
        <TryIt endpoint={endpoint} valores={valores} onValores={setValores} ambiente={ambiente} />
      </Seccion>
    </div>
  );
}
