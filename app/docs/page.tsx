'use client';

import { useEffect, useState } from 'react';
import { authStorage } from '@/lib/auth-storage';
import { DocsViewer } from '@/components/docs/DocsViewer';
import { IconoAlerta, IconoLibro } from '@/components/docs/Iconos';
import type { SpecDocs } from '@/components/docs/tipos';

/**
 * Portal de documentación de APIs de TrackMovil.
 *
 * Esta página no tiene catálogo propio: TODO lo que muestra sale de
 * `GET /api/docs/spec`, que valida el permiso contra SecuritySuite en el servidor
 * (lib/docs/root-guard.ts, fail-closed). Sin ese 200 no se renderiza un solo endpoint,
 * y por eso alcanza con que el guard de la página (app/docs/layout.tsx) sea cosmético.
 *
 * Si algún día esta pantalla trae contenido propio —aunque sea una lista de paths
 * hardcodeada— hay que mover el gate al servidor. Ver docs/api/README.md § Acceso.
 */
export default function DocsPage() {
  const [spec, setSpec] = useState<SpecDocs | null>(null);
  const [error, setError] = useState<{ titulo: string; detalle: string } | null>(null);
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
          const codigo = cuerpo?.code ? ` (${cuerpo.code})` : '';
          if (!cancelado) {
            setError(
              res.status === 503
                ? {
                    titulo: 'No se pudo verificar el permiso',
                    detalle: `SecuritySuite no contestó o el proceso no está bien configurado${codigo}. El catálogo no se abre si el permiso no se puede confirmar: es fail-closed a propósito.`,
                  }
                : {
                    titulo: 'Acceso denegado',
                    detalle: `Este portal es solo para usuarios root de RiogasTracking${codigo}. Para entrar hace falta el rol Root de la aplicación en SecuritySuite.`,
                  },
            );
          }
          return;
        }

        const data = (await res.json()) as SpecDocs;
        if (!cancelado) setSpec(data);
      } catch (e) {
        if (!cancelado) {
          setError({
            titulo: 'No se pudo cargar el catálogo',
            detalle: e instanceof Error ? e.message : 'Error desconocido',
          });
        }
      } finally {
        if (!cancelado) setCargando(false);
      }
    })();

    return () => {
      cancelado = true;
    };
  }, []);

  if (cargando) {
    return (
      <div className="flex h-full items-center justify-center bg-stats-background">
        <div className="flex flex-col items-center gap-3 text-stats-muted-fg">
          <span className="animate-spin rounded-full border-2 border-stats-border border-t-stats-primary p-4" />
          <p className="font-stats-sans text-[0.8rem]">Cargando el catálogo…</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center bg-stats-background p-6 font-stats-sans">
        <div className="max-w-xl rounded-xl border border-stats-border bg-stats-surface p-6 shadow-sm">
          <h1 className="flex items-center gap-2 text-[1.05rem] font-bold text-stats-foreground">
            <span className="text-stats-destructive">
              <IconoAlerta size={18} />
            </span>
            {error.titulo}
          </h1>
          <p className="mt-2 text-[0.85rem] leading-relaxed text-stats-muted-fg">{error.detalle}</p>
          <p className="mt-4 flex items-center gap-2 border-t border-stats-border pt-3 text-[0.75rem] text-stats-muted-fg">
            <IconoLibro size={14} />
            Documentación de APIs · TrackMovil
          </p>
        </div>
      </div>
    );
  }

  return <DocsViewer spec={spec ?? {}} />;
}
