/**
 * Parser de un SUBCONJUNTO de YAML, suficiente para `docs/api/anotaciones.yaml`.
 *
 * Por qué existe en vez de una dependencia: el repo no trae ningún parser de YAML
 * (js-yaml aparece solo como dependencia transitiva, no resoluble desde el código de
 * la app) y sumar una dependencia nueva para leer un único archivo escrito por
 * nosotros mismos no se justifica. El archivo de anotaciones es de autoría interna,
 * así que alcanza con un subconjunto acotado y documentado.
 *
 * SOPORTA:
 *   - mapas anidados por indentación (espacios; los tabs son error)
 *   - listas en bloque (`- item`) y listas de mapas (`- clave: valor`)
 *   - listas y mapas en flujo en una línea (`[a, b]`, `{a: 1}`)
 *   - escalares en bloque `|`, `|-`, `>`, `>-`
 *   - comillas simples y dobles, comentarios `#`, `true/false/null/~`, números
 *
 * NO SOPORTA (y tira error o devuelve el texto crudo): anclas/aliases (`&`, `*`),
 * tags (`!!`), documentos múltiples (`---`), claves complejas (`? `), multilínea
 * implícita. Lo que no soporta está documentado en docs/api/README.md.
 */

export type YamlValue = string | number | boolean | null | YamlValue[] | { [clave: string]: YamlValue };

interface Contexto {
  lineas: string[];
  i: number;
}

/** Indentación (en espacios) de una línea. -1 si la línea es vacía o solo comentario. */
function indentacion(linea: string): number {
  const cuerpo = quitarComentario(linea);
  if (cuerpo.trim() === '') return -1;
  return cuerpo.length - cuerpo.trimStart().length;
}

/** Corta el comentario `#` que esté fuera de comillas y precedido por espacio o inicio de línea. */
function quitarComentario(linea: string): string {
  let comilla: string | null = null;
  for (let i = 0; i < linea.length; i++) {
    const c = linea[i];
    if (comilla) {
      if (c === comilla) comilla = null;
      continue;
    }
    if (c === '"' || c === "'") {
      comilla = c;
      continue;
    }
    if (c === '#' && (i === 0 || /\s/.test(linea[i - 1]))) {
      return linea.slice(0, i);
    }
  }
  return linea;
}

/** Índice del `:` separador de clave/valor (fuera de comillas, seguido de espacio o fin). -1 si no hay. */
function buscarSeparador(s: string): number {
  let comilla: string | null = null;
  let profundidad = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (comilla) {
      if (c === comilla) comilla = null;
      continue;
    }
    if (c === '"' || c === "'") {
      comilla = c;
      continue;
    }
    if (c === '[' || c === '{') profundidad++;
    else if (c === ']' || c === '}') profundidad--;
    else if (c === ':' && profundidad === 0 && (i + 1 >= s.length || s[i + 1] === ' ')) {
      return i;
    }
  }
  return -1;
}

/** Avanza hasta la próxima línea con contenido. */
function saltarVacias(ctx: Contexto): void {
  while (ctx.i < ctx.lineas.length && indentacion(ctx.lineas[ctx.i]) === -1) ctx.i++;
}

/** Corta por comas de nivel 0 (respeta comillas y anidamiento). */
function partirPorComas(s: string): string[] {
  const partes: string[] = [];
  let actual = '';
  let comilla: string | null = null;
  let profundidad = 0;
  for (const c of s) {
    if (comilla) {
      actual += c;
      if (c === comilla) comilla = null;
      continue;
    }
    if (c === '"' || c === "'") {
      comilla = c;
      actual += c;
      continue;
    }
    if (c === '[' || c === '{') profundidad++;
    if (c === ']' || c === '}') profundidad--;
    if (c === ',' && profundidad === 0) {
      partes.push(actual);
      actual = '';
      continue;
    }
    actual += c;
  }
  if (actual.trim() !== '') partes.push(actual);
  return partes.map((p) => p.trim());
}

/** Convierte un escalar de una línea al tipo JS que corresponde. */
function escalar(bruto: string): YamlValue {
  const s = bruto.trim();
  if (s === '') return null;

  if (s.length >= 2 && s[0] === '"' && s.endsWith('"')) {
    return s
      .slice(1, -1)
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
  }
  if (s.length >= 2 && s[0] === "'" && s.endsWith("'")) {
    return s.slice(1, -1).replace(/''/g, "'");
  }

  if (s.startsWith('[') && s.endsWith(']')) {
    const interior = s.slice(1, -1).trim();
    return interior === '' ? [] : partirPorComas(interior).map(escalar);
  }
  if (s.startsWith('{') && s.endsWith('}')) {
    const interior = s.slice(1, -1).trim();
    const obj: { [k: string]: YamlValue } = {};
    if (interior === '') return obj;
    for (const parte of partirPorComas(interior)) {
      const idx = buscarSeparador(parte);
      if (idx < 0) continue;
      obj[String(escalar(parte.slice(0, idx)))] = escalar(parte.slice(idx + 1));
    }
    return obj;
  }

  if (s === 'true' || s === 'True') return true;
  if (s === 'false' || s === 'False') return false;
  if (s === 'null' || s === 'Null' || s === '~') return null;
  if (/^-?\d+$/.test(s)) return parseInt(s, 10);
  if (/^-?\d*\.\d+$/.test(s)) return parseFloat(s);

  return s;
}

/** Lee un escalar en bloque (`|`, `|-`, `>`, `>-`) cuyo contenido está indentado más que `indentPadre`. */
function escalarEnBloque(ctx: Contexto, indentPadre: number, indicador: string): string {
  const plegar = indicador.startsWith('>');
  const recortar = indicador.includes('-');

  const crudas: string[] = [];
  let indentContenido = -1;
  while (ctx.i < ctx.lineas.length) {
    const linea = ctx.lineas[ctx.i];
    if (linea.trim() === '') {
      crudas.push('');
      ctx.i++;
      continue;
    }
    const ind = linea.length - linea.trimStart().length;
    if (ind <= indentPadre) break;
    if (indentContenido === -1) indentContenido = ind;
    crudas.push(linea.slice(indentContenido));
    ctx.i++;
  }

  // Las líneas vacías del final no forman parte del bloque.
  while (crudas.length > 0 && crudas[crudas.length - 1] === '') crudas.pop();

  let texto: string;
  if (plegar) {
    // Plegado simple: las líneas de un mismo párrafo se unen con espacio.
    const parrafos: string[] = [];
    let actual: string[] = [];
    for (const l of crudas) {
      if (l === '') {
        parrafos.push(actual.join(' '));
        actual = [];
      } else {
        actual.push(l.trim());
      }
    }
    parrafos.push(actual.join(' '));
    texto = parrafos.join('\n');
  } else {
    texto = crudas.join('\n');
  }

  return recortar ? texto : texto + '\n';
}

function parseValor(ctx: Contexto, indentPadre: number, resto: string): YamlValue {
  const r = resto.trim();

  if (r === '|' || r === '|-' || r === '>' || r === '>-' || r === '|+' || r === '>+') {
    return escalarEnBloque(ctx, indentPadre, r);
  }
  if (r !== '') return escalar(r);

  // Valor en las líneas siguientes: mapa/lista anidados.
  const antes = ctx.i;
  saltarVacias(ctx);
  if (ctx.i >= ctx.lineas.length) {
    ctx.i = antes;
    return null;
  }
  const ind = indentacion(ctx.lineas[ctx.i]);
  const cuerpo = quitarComentario(ctx.lineas[ctx.i]).trim();
  const esItem = cuerpo === '-' || cuerpo.startsWith('- ');

  // Una lista puede venir alineada con la clave (YAML lo permite); un mapa no.
  if (ind > indentPadre || (esItem && ind === indentPadre)) {
    return parseBloque(ctx, ind);
  }
  ctx.i = antes;
  return null;
}

function parseMapa(ctx: Contexto, indent: number): YamlValue {
  const out: { [clave: string]: YamlValue } = {};
  while (true) {
    saltarVacias(ctx);
    if (ctx.i >= ctx.lineas.length) break;
    const ind = indentacion(ctx.lineas[ctx.i]);
    if (ind < indent) break;
    if (ind > indent) {
      throw new Error(`yaml-min: indentación inesperada en la línea ${ctx.i + 1}`);
    }
    const cuerpo = quitarComentario(ctx.lineas[ctx.i]).trim();
    if (cuerpo === '-' || cuerpo.startsWith('- ')) break;

    const idx = buscarSeparador(cuerpo);
    if (idx < 0) {
      throw new Error(`yaml-min: se esperaba "clave: valor" en la línea ${ctx.i + 1}: ${cuerpo}`);
    }
    const clave = String(escalar(cuerpo.slice(0, idx)));
    const resto = cuerpo.slice(idx + 1);
    ctx.i++;
    out[clave] = parseValor(ctx, indent, resto);
  }
  return out;
}

function parseSecuencia(ctx: Contexto, indent: number): YamlValue {
  const out: YamlValue[] = [];
  while (true) {
    saltarVacias(ctx);
    if (ctx.i >= ctx.lineas.length) break;
    const ind = indentacion(ctx.lineas[ctx.i]);
    if (ind !== indent) break;
    const cuerpo = quitarComentario(ctx.lineas[ctx.i]).trim();
    if (cuerpo !== '-' && !cuerpo.startsWith('- ')) break;

    const resto = cuerpo === '-' ? '' : cuerpo.slice(2).trim();

    if (resto !== '' && buscarSeparador(resto) >= 0) {
      // `- clave: valor` → mapa cuyo primer par vive en esta misma línea. Se reescribe la
      // línea sin el guion, respetando la columna, y se delega en parseMapa.
      const original = ctx.lineas[ctx.i];
      const offset = original.indexOf('-', indent) + 2;
      ctx.lineas[ctx.i] = ' '.repeat(offset) + quitarComentario(original).trim().slice(2).trim();
      out.push(parseMapa(ctx, offset));
      continue;
    }

    ctx.i++;
    out.push(parseValor(ctx, indent, resto));
  }
  return out;
}

function parseBloque(ctx: Contexto, indent: number): YamlValue {
  saltarVacias(ctx);
  if (ctx.i >= ctx.lineas.length) return {};
  const cuerpo = quitarComentario(ctx.lineas[ctx.i]).trim();
  return cuerpo === '-' || cuerpo.startsWith('- ')
    ? parseSecuencia(ctx, indent)
    : parseMapa(ctx, indent);
}

/**
 * Parsea el subconjunto de YAML descrito arriba.
 *
 * @throws si hay tabs de indentación o una línea que no encaja en el subconjunto.
 */
export function parseYamlSimple(texto: string): YamlValue {
  const lineas = texto.replace(/\r\n?/g, '\n').split('\n');

  lineas.forEach((linea, n) => {
    if (/^\s*\t/.test(linea)) {
      throw new Error(`yaml-min: tabs de indentación no soportados (línea ${n + 1})`);
    }
  });

  const ctx: Contexto = { lineas, i: 0 };
  saltarVacias(ctx);
  if (ctx.i >= lineas.length) return {};
  return parseBloque(ctx, indentacion(lineas[ctx.i]));
}
