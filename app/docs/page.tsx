'use client';

import { useEffect, useMemo, useState } from 'react';
import { authStorage } from '@/lib/auth-storage';

/**
 * Portal de documentación de APIs — versión mínima (fase 1-3).
 *
 * Lista los endpoints agrupados por módulo, con método, path y autenticación. El visor
 * completo (parámetros, ejemplos, "try it") es otra fase; esta pantalla existe para
 * poder ver el catálogo y comprobar que el gate funciona de punta a punta.
 *
 * Todo el contenido viene de GET /api/docs/spec, que valida contra SecuritySuite en el
 * servidor. Sin ese 200 acá no se renderiza ningún endpoint.
 */

interface OperacionAuth {
  gates?: string[];
  funcionalidades?: string[];
  sinGate?: boolean;
}

interface Operacion {
  operationId?: string;
  summary?: string;
  tags?: string[];
  'x-auth'?: OperacionAuth;
  'x-anotado'?: boolean;
}

interface Spec {
  info?: { title?: string; version?: string };
  tags?: Array<{ name: string; description?: string }>;
  paths?: Record<string, Record<string, Operacion>>;
  'x-excluidos'?: Array<{ archivo: string; motivo: string }>;
  'x-resumen'?: Record<string, number>;
  'x-anotaciones'?: { disponible?: boolean; anotados?: number; huerfanas?: string[] };
}

interface Fila {
  metodo: string;
  ruta: string;
  operacion: Operacion;
}

const ORDEN_METODOS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];

const COLOR_METODO: Record<string, string> = {
  get: 'bg-stats-info-soft text-stats-info',
  post: 'bg-stats-success-soft text-stats-success',
  put: 'bg-stats-warning-soft text-stats-warning',
  patch: 'bg-stats-warning-soft text-stats-warning',
  delete: 'bg-stats-destructive-soft text-stats-destructive',
  head: 'bg-stats-neutral-soft text-stats-neutral',
  options: 'bg-stats-neutral-soft text-stats-neutral',
};

export default function DocsPage() {
  const [spec, setSpec] = useState<Spec | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    let cancelado = false;

    (async () => {
      try {
        const token = authStorage.getItem('trackmovil_token') ?? '';
        const res = await fetch('/api/docs/spec', {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          cache: 'no-store',
        });

        if (!res.ok) {
          const cuerpo = (await res.json().catch(() => null)) as { code?: string } | null;
          const detalle = cuerpo?.code ? ` (${cuerpo.code})` : '';
          const mensaje =
            res.status === 503
              ? `No se pudo verificar el permiso contra SecuritySuite${detalle}. El catálogo no se abre si el permiso no se puede confirmar.`
              : `Acceso denegado${detalle}. El portal es solo para usuarios root.`;
          if (!cancelado) setError(mensaje);
          return;
        }

        const data = (await res.json()) as Spec;
        if (!cancelado) setSpec(data);
      } catch (e) {
        if (!cancelado) setError(e instanceof Error ? e.message : 'Error al cargar el catálogo');
      } finally {
        if (!cancelado) setCargando(false);
      }
    })();

    return () => {
      cancelado = true;
    };
  }, []);

  /** Endpoints agrupados por módulo (el tag que puso el generador). */
  const porModulo = useMemo(() => {
    const grupos = new Map<string, Fila[]>();
    for (const [ruta, operaciones] of Object.entries(spec?.paths ?? {})) {
      for (const [metodo, operacion] of Object.entries(operaciones)) {
        const modulo = operacion.tags?.[0] ?? 'sin-modulo';
        if (!grupos.has(modulo)) grupos.set(modulo, []);
        grupos.get(modulo)!.push({ metodo, ruta, operacion });
      }
    }
    for (const filas of grupos.values()) {
      filas.sort(
        (a, b) =>
          a.ruta.localeCompare(b.ruta) ||
          ORDEN_METODOS.indexOf(a.metodo) - ORDEN_METODOS.indexOf(b.metodo),
      );
    }
    return [...grupos.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [spec]);

  const descripcionModulo = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of spec?.tags ?? []) if (t.description) m.set(t.name, t.description);
    return m;
  }, [spec]);

  if (cargando) {
    return (
      <div className="h-full flex items-center justify-center bg-stats-background">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-stats-info" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center bg-stats-background p-6">
        <div className="max-w-xl rounded-lg border border-stats-border bg-stats-surface p-6">
          <h1 className="font-stats-sans text-lg font-semibold text-stats-foreground">
            Documentación de APIs
          </h1>
          <p className="mt-2 text-sm text-stats-muted-fg">{error}</p>
        </div>
      </div>
    );
  }

  const resumen = spec?.['x-resumen'];

  return (
    <div className="h-full overflow-auto bg-stats-background font-stats-sans">
      <div className="mx-auto max-w-5xl px-6 py-8">
        <header className="border-b border-stats-border pb-5">
          <h1 className="text-2xl font-semibold text-stats-foreground">
            {spec?.info?.title ?? 'TrackMovil — API'}
          </h1>
          <p className="mt-1 text-sm text-stats-muted-fg">
            Catálogo generado desde <code className="font-stats-mono">app/api/**/route.ts</code>
            {spec?.info?.version ? ` · versión ${spec.info.version}` : ''}
          </p>
          {resumen && (
            <p className="mt-3 text-sm text-stats-muted-fg">
              <strong className="text-stats-foreground">{resumen.endpoints}</strong> endpoints en{' '}
              <strong className="text-stats-foreground">{resumen.modulos}</strong> módulos ·{' '}
              <strong className="text-stats-destructive">{resumen.endpointsSinGate}</strong> sin
              ningún gate de autenticación ·{' '}
              <strong className="text-stats-foreground">{spec?.['x-anotaciones']?.anotados ?? 0}</strong>{' '}
              anotados a mano
            </p>
          )}
        </header>

        {porModulo.map(([modulo, filas]) => (
          <section key={modulo} className="mt-8">
            <h2 className="font-stats-mono text-sm font-semibold uppercase tracking-wide text-stats-primary">
              {modulo}
              <span className="ml-2 font-stats-sans text-xs font-normal normal-case text-stats-muted-fg">
                {filas.length} endpoint{filas.length === 1 ? '' : 's'}
              </span>
            </h2>
            {descripcionModulo.has(modulo) && (
              <p className="mt-1 whitespace-pre-line text-xs text-stats-muted-fg">
                {descripcionModulo.get(modulo)}
              </p>
            )}

            <ul className="mt-3 divide-y divide-stats-border rounded-lg border border-stats-border bg-stats-surface">
              {filas.map(({ metodo, ruta, operacion }) => {
                const auth = operacion['x-auth'];
                return (
                  <li key={`${metodo} ${ruta}`} className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded px-2 py-0.5 font-stats-mono text-xs font-bold uppercase ${
                          COLOR_METODO[metodo] ?? 'bg-stats-neutral-soft text-stats-neutral'
                        }`}
                      >
                        {metodo}
                      </span>
                      <code className="font-stats-mono text-sm text-stats-foreground">{ruta}</code>
                      {operacion['x-anotado'] && (
                        <span className="rounded bg-stats-neutral-soft px-1.5 py-0.5 text-[10px] uppercase text-stats-neutral">
                          anotado
                        </span>
                      )}
                    </div>

                    {operacion.summary && (
                      <p className="mt-1 text-sm text-stats-muted-fg">{operacion.summary}</p>
                    )}

                    <p className="mt-1 text-xs">
                      <span className="text-stats-muted-fg">auth: </span>
                      {auth?.sinGate ? (
                        <span className="font-medium text-stats-destructive">
                          sin ningún gate — alcanzable por cualquiera que llegue al puerto
                        </span>
                      ) : (
                        <span className="text-stats-foreground">
                          {(auth?.gates ?? []).join(' · ')}
                          {auth?.funcionalidades?.length
                            ? ` → ${auth.funcionalidades.join(', ')}`
                            : ''}
                        </span>
                      )}
                    </p>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}

        {(spec?.['x-excluidos']?.length ?? 0) > 0 && (
          <section className="mt-10 border-t border-stats-border pt-6">
            <h2 className="font-stats-mono text-sm font-semibold uppercase tracking-wide text-stats-muted-fg">
              Fuera del catálogo
            </h2>
            <ul className="mt-3 space-y-2">
              {spec?.['x-excluidos']?.map((e) => (
                <li key={e.archivo} className="text-xs text-stats-muted-fg">
                  <code className="font-stats-mono text-stats-foreground">{e.archivo}</code>
                  <span className="ml-2">{e.motivo}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
