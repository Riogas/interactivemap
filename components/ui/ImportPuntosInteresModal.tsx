'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import * as XLSX from 'xlsx';

interface ImportPuntosInteresModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportComplete?: () => void;
  user: { email?: string; username?: string } | null;
  embedded?: boolean;
}

export default function ImportPuntosInteresModal({
  isOpen,
  onClose,
  onImportComplete,
  user,
  embedded = false,
}: ImportPuntosInteresModalProps) {
  const poiFileInputRef = useRef<HTMLInputElement>(null);
  const [importingPOI, setImportingPOI] = useState(false);
  const [importResultPOI, setImportResultPOI] = useState<{
    ok: boolean;
    msg: string;
    replaced?: Array<{ deletedId: number; newId: number; nombre: string; usuario_email: string }>;
  } | null>(null);

  // Limpiar estado al abrir el modal
  useEffect(() => {
    if (isOpen) {
      setImportResultPOI(null);
      setImportingPOI(false);
    }
  }, [isOpen]);

  const handleImportPOI = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (poiFileInputRef.current) poiFileInputRef.current.value = '';

    setImportingPOI(true);
    setImportResultPOI(null);

    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const ws = workbook.Sheets[workbook.SheetNames[0]];
      const raw: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

      if (raw.length < 2) {
        setImportResultPOI({ ok: false, msg: 'El archivo no tiene filas de datos.' });
        setImportingPOI(false);
        return;
      }

      const headers: string[] = (raw[0] as string[]).map(h => String(h ?? '').trim());
      const idxExact = (...names: string[]) => {
        for (const name of names) {
          const i = headers.findIndex(h => h.toLowerCase() === name.toLowerCase());
          if (i >= 0) return i;
        }
        return -1;
      };
      const idxIncludes = (name: string) => headers.findIndex(h => h.toLowerCase().includes(name.toLowerCase()));

      const iId          = idxExact('ID', 'id');
      const iNombre      = idxExact('Nombre', 'name') >= 0 ? idxExact('Nombre', 'name') : idxIncludes('Nombre Corto');
      const iDescripcion = idxExact('Descripcion', 'Descripción', 'description');
      const iLatitud     = idxExact('Latitud', 'lat') >= 0 ? idxExact('Latitud', 'lat') : idxIncludes('CoordX');
      const iLongitud    = idxExact('Longitud', 'lng', 'lon') >= 0 ? idxExact('Longitud', 'lng', 'lon') : idxIncludes('CoordY');
      const iTipo        = idxExact('tipo', 'Tipo');
      const iIcono       = idxExact('icono', 'Icono', 'icon');
      const iVisible     = idxExact('Visible', 'visible');
      const iVisibilidad = idxIncludes('Visibilidad');
      const iCategoria   = idxExact('Categoria', 'Categoría', 'category');
      const iTelefono    = idxExact('Telefono', 'Teléfono', 'phone');
      const iDireccion   = idxIncludes('Direccion');
      const iObs         = idxIncludes('Observaciones');
      const iEscenario   = idxIncludes('escenario');
      const iEmpresa     = idxIncludes('empresa');

      const email = user?.email || user?.username || 'admin@trackmovil';

      const rows = raw.slice(1).filter(r => r[iId] != null).map(r => {
        let descripcionFinal: string | null = null;
        if (iDescripcion >= 0) {
          const v = String(r[iDescripcion] ?? '').trim();
          descripcionFinal = v || null;
        } else {
          const direccion     = iDireccion >= 0 ? String(r[iDireccion] ?? '').trim() : '';
          const observaciones = iObs >= 0 ? String(r[iObs] ?? '').trim() : '';
          descripcionFinal = [direccion, observaciones].filter(Boolean).join(' — ') || null;
        }

        let tipo: 'publico' | 'privado';
        let visible: boolean;
        if (iTipo >= 0) {
          const t = String(r[iTipo] ?? '').toLowerCase().trim();
          tipo = t === 'publico' || t === 'público' || t === 'public' ? 'publico' : 'privado';
        } else if (iVisibilidad >= 0) {
          const v = String(r[iVisibilidad] ?? '').toLowerCase().trim();
          tipo = v === 'publico' || v === 'público' || v === 'public' ? 'publico' : 'privado';
        } else {
          tipo = 'privado';
        }
        if (iVisible >= 0) {
          const v = String(r[iVisible] ?? '').toLowerCase().trim();
          visible = v === 'true' || v === '1' || v === 'si' || v === 'sí';
        } else if (iVisibilidad >= 0) {
          const v = String(r[iVisibilidad] ?? '').toLowerCase().trim();
          visible = v === 'publico' || v === 'público' || v === 'true' || v === '1';
        } else {
          visible = true;
        }

        // icono: opcional y NULLABLE. Si la celda está vacía → null (el mapa cae
        // al icono por defecto de la categoría/escenario). No forzar un emoji.
        let icono: string | null = null;
        if (iIcono >= 0) {
          const v = String(r[iIcono] ?? '').trim();
          icono = v || null;
        }

        return {
          id:                 Number(r[iId]),
          nombre:             String(r[iNombre] ?? '').trim(),
          categoria:          iCategoria >= 0 ? String(r[iCategoria] ?? '').trim() || null : null,
          latitud:            Number(r[iLatitud]),
          longitud:           Number(r[iLongitud]),
          telefono:           r[iTelefono] ? Number(r[iTelefono]) : null,
          descripcion:        descripcionFinal,
          visible,
          tipo,
          icono,
          usuario_email:      email,
          escenario_id:       iEscenario >= 0 && r[iEscenario] != null ? Number(r[iEscenario]) : null,
          empresa_fletera_id: iEmpresa >= 0 && r[iEmpresa] != null ? Number(r[iEmpresa]) : null,
        };
      });

      if (rows.length === 0) {
        setImportResultPOI({ ok: false, msg: 'No se encontraron filas válidas (falta columna ID*).' });
        setImportingPOI(false);
        return;
      }

      const res = await fetch('/api/import/puntos-interes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows }),
      });
      const json = await res.json();

      if (res.ok && json.success) {
        const parts: string[] = [];
        if (json.created?.length) parts.push(`${json.created.length} creado(s)/actualizado(s)`);
        if (json.replaced?.length) parts.push(`${json.replaced.length} reemplazado(s) (mismo nombre, id distinto)`);
        if (!parts.length) parts.push('0 cambios');
        setImportResultPOI({
          ok: true,
          msg: `✅ ${parts.join(' · ')}`,
          replaced: json.replaced ?? [],
        });
        onImportComplete?.();
      } else {
        setImportResultPOI({ ok: false, msg: `❌ Error: ${json.error || 'Error desconocido'}` });
      }
    } catch (err: any) {
      setImportResultPOI({ ok: false, msg: `❌ Error al leer el archivo: ${err.message}` });
    } finally {
      setImportingPOI(false);
    }
  }, [user, onImportComplete]);

  const handleClose = () => {
    setImportResultPOI(null);
    setImportingPOI(false);
    onClose();
  };

  const content = (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span className="text-lg">📍</span>
        <span className="text-sm font-bold text-gray-800">Importar Puntos de Interés</span>
        <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-blue-100 text-blue-700">ADMIN</span>
      </div>
      <p className="text-xs text-gray-500 -mt-2">
        Importa o actualiza los puntos de interés desde un archivo Excel&nbsp;(.xlsx). Los registros existentes serán sobreescritos por ID.
      </p>

      <details className="rounded-lg border border-gray-200 bg-gray-50">
        <summary className="cursor-pointer px-4 py-2 text-xs font-semibold text-gray-600 select-none">📋 Ver formato Excel esperado</summary>
        <div className="px-4 pb-4 pt-2 space-y-3">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-gray-100">
                <th className="text-left px-2 py-1 border border-gray-200">Columna</th>
                <th className="text-left px-2 py-1 border border-gray-200">Tipo</th>
                <th className="text-left px-2 py-1 border border-gray-200">Requerido</th>
                <th className="text-left px-2 py-1 border border-gray-200">Ejemplo</th>
              </tr>
            </thead>
            <tbody>
              {[
                { col: 'ID',                 tipo: 'número',           req: true,  ej: '1000' },
                { col: 'Nombre',             tipo: 'texto',            req: true,  ej: 'Cementerio Central' },
                { col: 'Descripcion',        tipo: 'texto',            req: false, ej: 'Gonzalo Ramírez 1290' },
                { col: 'Latitud',            tipo: 'número',           req: true,  ej: '-34.9178' },
                { col: 'Longitud',           tipo: 'número',           req: true,  ej: '-56.1745' },
                { col: 'tipo',               tipo: 'PUBLICO/PRIVADO',  req: false, ej: 'PUBLICO' },
                { col: 'icono',              tipo: 'texto (nullable)', req: false, ej: '🏥 (vacío = sin icono)' },
                { col: 'Visible',            tipo: 'true/false',       req: false, ej: 'true' },
                { col: 'Categoria',          tipo: 'texto',            req: false, ej: 'Cementerio' },
                { col: 'Telefono',           tipo: 'número',           req: false, ej: '24001234' },
                { col: 'escenario_id',       tipo: 'número',           req: false, ej: '1000' },
                { col: 'empresa_fletera_id', tipo: 'número',           req: false, ej: '70' },
              ].map(({ col, tipo, req, ej }) => (
                <tr key={col} className="even:bg-white odd:bg-gray-50">
                  <td className="px-2 py-1 border border-gray-200 font-mono">{col}</td>
                  <td className="px-2 py-1 border border-gray-200 text-gray-500">{tipo}</td>
                  <td className="px-2 py-1 border border-gray-200">{req ? <span className="text-red-500 font-bold">✓</span> : <span className="text-gray-400">–</span>}</td>
                  <td className="px-2 py-1 border border-gray-200 text-gray-500">{ej}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex justify-end">
            <button
              type="button"
              className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-all"
              onClick={() => {
                const hdrs = ['ID','Nombre','Descripcion','Latitud','Longitud','tipo','icono','Visible','Categoria','Telefono','escenario_id','empresa_fletera_id'];
                const wb = XLSX.utils.book_new();
                const ws = XLSX.utils.aoa_to_sheet([hdrs]);
                XLSX.utils.book_append_sheet(wb, ws, 'Plantilla');
                XLSX.writeFile(wb, 'plantilla-puntos-interes.xlsx');
              }}
            >
              ⬇ Descargar plantilla
            </button>
          </div>
        </div>
      </details>

      <div
        className="border-2 border-dashed border-gray-200 rounded-xl p-5 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-all"
        onClick={() => poiFileInputRef.current?.click()}
      >
        <svg className="w-8 h-8 text-gray-400 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        <p className="text-sm text-gray-600 font-medium">
          {importingPOI ? 'Procesando...' : 'Seleccionar archivo .xlsx'}
        </p>
        <p className="text-xs text-gray-400 mt-1">Haz clic para elegir el archivo</p>
        <input
          ref={poiFileInputRef}
          type="file"
          accept=".xlsx,.xls"
          className="hidden"
          onChange={handleImportPOI}
          disabled={importingPOI}
        />
      </div>

      {importResultPOI && (
        <div className={`text-sm px-4 py-3 rounded-lg border ${importResultPOI.ok ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
          <div>{importResultPOI.msg}</div>
          {importResultPOI.ok && importResultPOI.replaced && importResultPOI.replaced.length > 0 && (
            <details className="mt-2 cursor-pointer">
              <summary className="text-xs font-semibold text-amber-700 hover:underline">
                Ver {importResultPOI.replaced.length} POI(s) reemplazado(s) (mismo nombre, id distinto)
              </summary>
              <ul className="mt-1 text-xs text-gray-600 list-disc list-inside max-h-32 overflow-y-auto">
                {importResultPOI.replaced.map((r, i) => (
                  <li key={i}><span className="font-medium">{r.nombre}</span> ({r.usuario_email})  id anterior: {r.deletedId} → nuevo: {r.newId}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );

  if (embedded) {
    if (!isOpen) return null;
    return content;
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={handleClose}
      />
      {/* Panel */}
      <div className="relative z-10 bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 flex-shrink-0">
          <h2 className="text-base font-semibold text-gray-900">Importar Puntos de Interés</h2>
          <button
            type="button"
            onClick={handleClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
            title="Cerrar"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        {/* Body */}
        <div className="overflow-y-auto flex-1 px-6 py-5">
          {content}
        </div>
      </div>
    </div>
  );
}
