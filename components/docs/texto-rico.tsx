// Render mínimo del texto de las anotaciones: párrafos, saltos de línea y
// `código` entre backticks. No se monta un renderer de markdown entero por esto
// —lo único que usan las notas es el backtick, y meter una dependencia nueva para
// eso es peor que resolverlo en doce líneas—, pero sin esto los 86 backticks de
// docs/api/anotaciones.yaml se veían crudos en la pantalla.
//
// Portado de Goya (src/components/docs/texto-rico.tsx) con los tokens `--stats-*`
// de esta app.
import { Fragment } from 'react';

/**
 * Parte un texto en fragmentos y envuelve en `<code>` lo que va entre backticks.
 *
 * Se exporta suelto para los lugares donde no cabe un `<p>` (el hint de una sección,
 * el texto de un badge, una celda de tabla).
 *
 * @param texto texto con backticks
 * @param clave prefijo de las keys de React (tiene que ser único en la lista)
 */
export function conCodigo(texto: string, clave: string) {
  return texto.split('`').map((parte, i) =>
    i % 2 === 1 ? (
      <code
        key={`${clave}-${i}`}
        // `break-all`: las notas traen cosas como
        // `{ Zona, ZonaActiva: "S"|"N", Demora, ZonaNombre }`, que sin esto empujan
        // el ancho del documento en un teléfono.
        className="break-all rounded bg-stats-surface-2 px-1 py-0.5 font-stats-mono text-[0.9em] text-stats-foreground"
      >
        {parte}
      </code>
    ) : (
      <Fragment key={`${clave}-${i}`}>{parte}</Fragment>
    ),
  );
}

/** Texto largo de una anotación o de un docblock: párrafos + `código` inline. */
export function TextoRico({ texto, className = '' }: { texto: string; className?: string }) {
  const limpio = (texto ?? '').trim();
  if (!limpio) return null;
  const parrafos = limpio.split(/\n\s*\n/);

  return (
    <div className={`space-y-2 break-words text-[0.82rem] leading-relaxed text-stats-muted-fg ${className}`}>
      {parrafos.map((parrafo, i) => (
        <p key={i}>
          {parrafo.split('\n').map((linea, j, todas) => (
            <Fragment key={j}>
              {conCodigo(linea, `${i}-${j}`)}
              {j < todas.length - 1 ? ' ' : null}
            </Fragment>
          ))}
        </p>
      ))}
    </div>
  );
}
