'use client';

/**
 * Utilidad de exportación de cards de estadísticas a PDF y Excel.
 *
 * - PDF (exportCardPdf): captura visual fiel de la card (html2canvas) ARRIBA +
 *   tablas de datos prolijas (jspdf-autotable) ABAJO.
 * - Excel (exportCardExcel): hoja con tabla(s) de datos formateadas + el gráfico
 *   embebido como imagen (captura de la card).
 *
 * Las librerías pesadas (jspdf, html2canvas, exceljs) se importan dinámicamente
 * dentro de cada handler para no inflar el bundle de la página.
 */

export interface CardExportSection {
  /** Título de la sub-tabla (opcional). */
  heading?: string;
  /** Encabezados de columna. */
  columns: string[];
  /** Filas de datos (cada fila = array alineado a columns). */
  rows: Array<Array<string | number>>;
}

export interface CardExportModel {
  /** Título de la card (encabezado del documento y nombre de hoja). */
  title: string;
  /** Subtítulo opcional (ej: fecha del reporte). */
  subtitle?: string;
  /** Secciones de datos. */
  sections: CardExportSection[];
}

// Sanitiza un nombre para usarlo como archivo / hoja de Excel.
function safeName(s: string): string {
  return s.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, '_').slice(0, 80);
}

// Captura un nodo del DOM a un dataURL PNG con html2canvas.
async function captureNode(node: HTMLElement): Promise<{ dataUrl: string; width: number; height: number } | null> {
  try {
    const html2canvas = (await import('html2canvas')).default;
    // Fondo blanco para que el PDF/Excel no salga transparente en dark mode.
    const canvas = await html2canvas(node, {
      backgroundColor: '#ffffff',
      scale: 2,
      logging: false,
      useCORS: true,
    });
    return { dataUrl: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height };
  } catch (e) {
    console.warn('[stats-export] captureNode falló:', e);
    return null;
  }
}

/**
 * Exporta la card a PDF: imagen de la card + tablas de datos.
 */
export async function exportCardPdf(
  node: HTMLElement,
  model: CardExportModel,
  fechaLabel?: string,
): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const autoTable = (await import('jspdf-autotable')).default;

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 12;
  let y = margin;

  // Título
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(20, 20, 20);
  doc.text(model.title, margin, y);
  y += 6;

  if (model.subtitle || fechaLabel) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(120, 120, 120);
    doc.text([model.subtitle, fechaLabel].filter(Boolean).join('  ·  '), margin, y);
    y += 5;
  }
  y += 2;

  // Captura visual de la card
  const shot = await captureNode(node);
  if (shot) {
    const imgW = pageW - margin * 2;
    const imgH = (shot.height / shot.width) * imgW;
    // Si la imagen es muy alta, limitar a ~55% de la página para dejar lugar a las tablas.
    const maxImgH = pageH * 0.55;
    const finalH = Math.min(imgH, maxImgH);
    const finalW = finalH < imgH ? (shot.width / shot.height) * finalH : imgW;
    doc.addImage(shot.dataUrl, 'PNG', margin, y, finalW, finalH, undefined, 'FAST');
    y += finalH + 6;
  }

  // Tablas de datos
  for (const section of model.sections) {
    if (section.heading) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.setTextColor(40, 40, 40);
      // salto de página si no entra el heading
      if (y > pageH - 30) { doc.addPage(); y = margin; }
      doc.text(section.heading, margin, y);
      y += 2;
    }
    autoTable(doc, {
      startY: y + 2,
      head: [section.columns],
      body: section.rows.map((r) => r.map((c) => String(c))),
      margin: { left: margin, right: margin },
      styles: { fontSize: 9, cellPadding: 2 },
      headStyles: { fillColor: [37, 99, 235], textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [245, 247, 250] },
      theme: 'striped',
    });
    // @ts-expect-error lastAutoTable lo agrega el plugin en runtime
    y = (doc.lastAutoTable?.finalY ?? y) + 8;
  }

  doc.save(`${safeName(model.title)}.pdf`);
}

/**
 * Exporta la card a Excel: tabla(s) de datos formateadas + imagen del gráfico.
 */
export async function exportCardExcel(
  node: HTMLElement,
  model: CardExportModel,
  fechaLabel?: string,
): Promise<void> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'RiogasTracking';
  wb.created = new Date();
  const ws = wb.addWorksheet(safeName(model.title).slice(0, 31) || 'Datos');

  let row = 1;

  // Título
  const titleCell = ws.getCell(`A${row}`);
  titleCell.value = model.title;
  titleCell.font = { bold: true, size: 14, color: { argb: 'FF1F2937' } };
  row += 1;
  if (model.subtitle || fechaLabel) {
    const sub = ws.getCell(`A${row}`);
    sub.value = [model.subtitle, fechaLabel].filter(Boolean).join('  ·  ');
    sub.font = { italic: true, size: 10, color: { argb: 'FF6B7280' } };
    row += 1;
  }
  row += 1;

  let maxCols = 1;

  // Secciones / tablas
  for (const section of model.sections) {
    if (section.heading) {
      const h = ws.getCell(`A${row}`);
      h.value = section.heading;
      h.font = { bold: true, size: 12, color: { argb: 'FF111827' } };
      row += 1;
    }
    // Header
    const headerRow = ws.getRow(row);
    section.columns.forEach((col, i) => {
      const cell = headerRow.getCell(i + 1);
      cell.value = col;
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } };
      cell.alignment = { vertical: 'middle', horizontal: i === 0 ? 'left' : 'center' };
      cell.border = { bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } } };
    });
    maxCols = Math.max(maxCols, section.columns.length);
    row += 1;
    // Filas
    section.rows.forEach((r, ri) => {
      const dataRow = ws.getRow(row);
      r.forEach((val, i) => {
        const cell = dataRow.getCell(i + 1);
        cell.value = val;
        cell.alignment = { horizontal: i === 0 ? 'left' : 'center' };
        if (ri % 2 === 1) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F7FA' } };
        }
      });
      row += 1;
    });
    row += 1; // espacio entre secciones
  }

  // Ancho de columnas
  for (let c = 1; c <= maxCols; c++) {
    ws.getColumn(c).width = c === 1 ? 28 : 16;
  }

  // Imagen del gráfico (captura de la card) debajo de las tablas
  const shot = await captureNode(node);
  if (shot) {
    const imgId = wb.addImage({ base64: shot.dataUrl, extension: 'png' });
    // Escalar a ~520px de ancho conservando proporción
    const targetW = 520;
    const targetH = (shot.height / shot.width) * targetW;
    ws.addImage(imgId, {
      tl: { col: 0, row: row + 1 },
      ext: { width: targetW, height: targetH },
      editAs: 'oneCell',
    });
  }

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${safeName(model.title)}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── Helpers para construir secciones desde los shapes de datos conocidos ─────

/** {label,value,pct}[] → sección [Etiqueta, Cantidad, %]. */
export function sectionFromValuePct(
  heading: string | undefined,
  labelCol: string,
  data: Array<{ label: string; value: number; pct?: number }>,
): CardExportSection {
  const total = data.reduce((s, d) => s + d.value, 0);
  return {
    heading,
    columns: [labelCol, 'Cantidad', '%'],
    rows: data.map((d) => [d.label, d.value, total > 0 ? `${Math.round((d.value / total) * 100)}%` : '0%']),
  };
}

/** StackRow[] → sección [Etiqueta, Entregados, No entregados, Pendientes, Total]. */
export function sectionFromStackRows(
  heading: string | undefined,
  labelCol: string,
  data: Array<{ label: string; entregados: number; noEntregados: number; pendientes: number }>,
): CardExportSection {
  return {
    heading,
    columns: [labelCol, 'Entregados', 'No entregados', 'Pendientes', 'Total'],
    rows: data.map((r) => [
      r.label,
      r.entregados,
      r.noEntregados,
      r.pendientes,
      r.entregados + r.noEntregados + r.pendientes,
    ]),
  };
}

/** BucketRow[] → sección [Etiqueta, Total, ...buckets]. */
export function sectionFromBucketRows(
  heading: string | undefined,
  labelCol: string,
  data: Array<{ label: string; total: number; buckets: Record<string, number> }>,
  bucketOrder: readonly string[],
): CardExportSection {
  return {
    heading,
    columns: [labelCol, 'Total', ...bucketOrder.map((b) => String(b))],
    rows: data.map((r) => [r.label, r.total, ...bucketOrder.map((b) => r.buckets[b] ?? 0)]),
  };
}
