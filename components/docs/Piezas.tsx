'use client';

import { useCallback, useState } from 'react';
import { IconoCheck, IconoCopiar } from './Iconos';
import { COLOR_METODO } from './docs-logic';
import { conCodigo } from './texto-rico';
import type { TonoBadge } from './tipos';

/**
 * Piezas visuales compartidas del portal `/docs`.
 *
 * Todo el color sale de los tokens `--stats-*` (app/globals.css), así que el tema
 * claro y el oscuro salen de la misma marcación, sin duplicar clases.
 */

const CLASE_TONO: Record<TonoBadge, string> = {
  peligro: 'bg-stats-destructive-soft text-stats-destructive border-stats-destructive/30',
  aviso: 'bg-stats-warning-soft text-stats-warning border-stats-warning/30',
  ok: 'bg-stats-success-soft text-stats-success border-stats-success/30',
  neutro: 'bg-stats-neutral-soft text-stats-neutral border-stats-border',
};

export function Badge({
  tono = 'neutro',
  children,
  title,
  className = '',
}: {
  tono?: TonoBadge;
  children: React.ReactNode;
  title?: string;
  className?: string;
}) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[0.7rem] font-medium leading-5 ${CLASE_TONO[tono]} ${className}`}
    >
      {children}
    </span>
  );
}

/** Chip del método HTTP: mismo color en la lista, en el detalle y en la respuesta. */
export function ChipMetodo({ metodo, className = '' }: { metodo: string; className?: string }) {
  const clase = COLOR_METODO[metodo.toLowerCase()] ?? 'bg-stats-neutral-soft text-stats-neutral';
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded px-1.5 py-0.5 font-stats-mono text-[0.65rem] font-bold uppercase tracking-wide ${clase} ${className}`}
    >
      {metodo}
    </span>
  );
}

/**
 * Copia al portapapeles con fallback.
 *
 * `navigator.clipboard` NO existe en orígenes inseguros, y el ambiente de desarrollo
 * de TrackMovil se sirve por http: sin el fallback, el botón "Copiar" no haría nada
 * justamente donde más se usa.
 */
export async function copiarTexto(texto: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(texto);
      return true;
    }
  } catch {
    // sigue por el fallback
  }

  try {
    const area = document.createElement('textarea');
    area.value = texto;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

/** Botón "Copiar" que confirma en el propio botón durante un segundo y medio. */
export function BotonCopiar({
  texto,
  etiqueta = 'Copiar',
  className = '',
}: {
  texto: string;
  etiqueta?: string;
  className?: string;
}) {
  const [copiado, setCopiado] = useState(false);

  const copiar = useCallback(async () => {
    const ok = await copiarTexto(texto);
    setCopiado(ok);
    if (ok) setTimeout(() => setCopiado(false), 1500);
  }, [texto]);

  return (
    <button
      type="button"
      onClick={copiar}
      aria-label={etiqueta}
      className={`inline-flex items-center gap-1.5 rounded-md border border-stats-border bg-stats-surface px-2 py-1 text-[0.7rem] font-medium text-stats-muted-fg transition-colors hover:border-stats-primary hover:text-stats-primary ${className}`}
    >
      {copiado ? <IconoCheck size={13} /> : <IconoCopiar size={13} />}
      {copiado ? 'Copiado' : etiqueta}
    </button>
  );
}

/**
 * Bloque de código copiable.
 *
 * Scrollea en su propio contenedor (`overflow-x-auto`): la página nunca scrollea de
 * costado, ni en una notebook de 1366.
 */
export function BloqueCodigo({
  codigo,
  lenguaje,
  titulo,
  maxAlto = 'max-h-96',
}: {
  codigo: string;
  lenguaje?: string;
  titulo?: string;
  maxAlto?: string;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-stats-border bg-stats-surface-2">
      <div className="flex items-center justify-between gap-2 border-b border-stats-border bg-stats-surface px-3 py-1.5">
        <span className="truncate font-stats-mono text-[0.68rem] uppercase tracking-wide text-stats-muted-fg">
          {titulo ?? lenguaje ?? 'código'}
        </span>
        <BotonCopiar texto={codigo} />
      </div>
      <pre className={`${maxAlto} overflow-auto px-3 py-2.5`}>
        <code className="font-stats-mono text-[0.76rem] leading-relaxed text-stats-foreground">{codigo}</code>
      </pre>
    </div>
  );
}

/** Bloque de una sección del detalle: título con icono + contenido. */
export function Seccion({
  titulo,
  icono,
  hint,
  acciones,
  children,
}: {
  titulo: string;
  icono?: React.ReactNode;
  hint?: string;
  acciones?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-stats-border bg-stats-surface p-4 shadow-sm">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-[0.92rem] font-semibold text-stats-foreground">
            {icono}
            {titulo}
          </h3>
          {hint && <p className="mt-0.5 text-[0.74rem] text-stats-muted-fg">{conCodigo(hint, 'hint')}</p>}
        </div>
        {acciones}
      </div>
      {children}
    </section>
  );
}

/** Aviso de que un dato no está anotado. No se oculta: se dice. */
export function SinAnotar({ children }: { children: React.ReactNode }) {
  return <p className="text-[0.8rem] italic text-stats-muted-fg">{children}</p>;
}

/** Tarjeta de número grande del apartado de autenticación. */
export function Kpi({
  valor,
  etiqueta,
  detalle,
  tono = 'neutro',
  onClick,
}: {
  valor: React.ReactNode;
  etiqueta: string;
  detalle?: string;
  tono?: TonoBadge;
  onClick?: () => void;
}) {
  const color =
    tono === 'peligro'
      ? 'text-stats-destructive'
      : tono === 'aviso'
        ? 'text-stats-warning'
        : tono === 'ok'
          ? 'text-stats-success'
          : 'text-stats-foreground';

  const contenido = (
    <>
      <div className={`font-stats-mono text-3xl font-bold tabular-nums ${color}`}>{valor}</div>
      <div className="mt-1 text-[0.78rem] font-medium text-stats-foreground">{etiqueta}</div>
      {detalle && (
        <div className="mt-0.5 text-[0.72rem] leading-snug text-stats-muted-fg">{conCodigo(detalle, 'kpi')}</div>
      )}
    </>
  );

  if (!onClick) {
    return <div className="rounded-xl border border-stats-border bg-stats-surface p-4 shadow-sm">{contenido}</div>;
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-xl border border-stats-border bg-stats-surface p-4 text-left shadow-sm transition-colors hover:border-stats-primary"
    >
      {contenido}
    </button>
  );
}
