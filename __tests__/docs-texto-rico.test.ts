/**
 * Tests de components/docs/texto-rico.tsx.
 *
 * Las anotaciones de docs/api/anotaciones.yaml están escritas con backticks (86 en el
 * archivo). Sin este renderer el portal los mostraba crudos —`x-api-key` con las
 * comillas invertidas a la vista, en medio de una oración— en descripciones, notas,
 * consumidores, errores y hints. Esto es lo que los convierte en `<code>`.
 */

import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { TextoRico, conCodigo } from '@/components/docs/texto-rico';

/** Render a HTML plano, que es lo que ve el root en la pantalla. */
function html(texto: string): string {
  return renderToStaticMarkup(TextoRico({ texto }) as React.ReactElement);
}

describe('TextoRico', () => {
  it('lo que va entre backticks sale como <code>, y los backticks no se ven', () => {
    const salida = html('Se autentica con el header `x-api-key`.');

    expect(salida).toContain('<code');
    expect(salida).toContain('x-api-key</code>');
    expect(salida).not.toContain('`');
  });

  it('varios spans en una misma línea', () => {
    const salida = html('Acepta `{ pedidos: [...] }`, un array pelado o `PascalCase`.');

    expect(salida.match(/<code/g)).toHaveLength(2);
    expect(salida).not.toContain('`');
  });

  it('los párrafos se separan en <p> y los saltos sueltos se pegan con un espacio', () => {
    const salida = html('Primera línea\nsegunda línea\n\nOtro párrafo.');

    expect(salida.match(/<p>/g)).toHaveLength(2);
    expect(salida).toContain('Primera línea segunda línea');
  });

  it('un texto vacío no renderiza un bloque fantasma', () => {
    expect(TextoRico({ texto: '' })).toBeNull();
    expect(TextoRico({ texto: '   \n  ' })).toBeNull();
  });

  it('no interpreta markdown: solo backticks', () => {
    const salida = html('**esto no es negrita** y [esto](no) es un link');

    expect(salida).toContain('**esto no es negrita**');
    expect(salida).toContain('[esto](no)');
    expect(salida).not.toContain('<strong');
    expect(salida).not.toContain('<a ');
  });

  it('el texto es texto: nada de HTML crudo (React escapa)', () => {
    const salida = html('<script>alert(1)</script>');

    expect(salida).not.toContain('<script>');
    expect(salida).toContain('&lt;script&gt;');
  });
});

describe('conCodigo', () => {
  it('devuelve los fragmentos alternados, con <code> en los impares', () => {
    const partes = conCodigo('antes `medio` después', 'k');

    expect(partes).toHaveLength(3);
    expect(partes[1].type).toBe('code');
    expect(partes[1].props.children).toBe('medio');
  });

  it('un backtick sin cerrar no rompe nada', () => {
    expect(() => renderToStaticMarkup(conCodigo('roto ` sin cerrar', 'k') as React.ReactNode)).not.toThrow();
  });
});
