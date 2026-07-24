'use client';

import { useMemo, useState } from 'react';
import type { RankingRow } from '@/types/metricas-dashboard';
import { formatMin, formatCount } from './metricas-theme';

type SortKey = 'valor' | 'cantidad' | 'promedio' | 'mediana' | 'p90' | 'atraso';

const NUMERIC_COLS: { key: SortKey; label: string }[] = [
  { key: 'cantidad', label: 'Cumpl.' },
  { key: 'promedio', label: 'Prom.' },
  { key: 'mediana', label: 'Mediana' },
  { key: 'p90', label: 'P90' },
  { key: 'atraso', label: 'Atraso' },
];

function Caret({ active, dir }: { active: boolean; dir: 1 | -1 }) {
  return <span className={`ml-0.5 text-[0.7em] ${active ? 'opacity-100' : 'opacity-40'}`}>{active ? (dir === 1 ? '▲' : '▼') : '▲'}</span>;
}

/** Tabla ordenable + búsqueda. `limit` acota las filas visibles (card compacta); sin límite (modal ampliado) muestra todas. */
export function DetalleTable({
  ranking,
  dimensionLabel,
  limit,
}: {
  ranking: RankingRow[];
  dimensionLabel: string;
  limit?: number;
}) {
  const [sortKey, setSortKey] = useState<SortKey>('promedio');
  const [sortDir, setSortDir] = useState<1 | -1>(1);
  const [query, setQuery] = useState('');

  const filteredAll = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = q ? ranking.filter((r) => r.valor.toLowerCase().includes(q)) : ranking;
    return [...rows].sort((a, b) => {
      if (sortKey === 'valor') return a.valor.localeCompare(b.valor) * sortDir;
      const av = a[sortKey] ?? -Infinity;
      const bv = b[sortKey] ?? -Infinity;
      return (av - bv) * sortDir;
    });
  }, [ranking, query, sortKey, sortDir]);

  const filtered = limit ? filteredAll.slice(0, limit) : filteredAll;

  function toggleSort(key: SortKey) {
    if (key === sortKey) setSortDir((d) => (d === 1 ? -1 : 1));
    else {
      setSortKey(key);
      setSortDir(1);
    }
  }

  if (ranking.length === 0) {
    return (
      <div className="flex h-[160px] items-center justify-center text-center text-sm text-stats-muted-fg">
        Sin datos para esta dimensión en el período seleccionado.
      </div>
    );
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs text-stats-muted-fg">
          {filteredAll.length} {filteredAll.length === 1 ? 'resultado' : 'resultados'}
          {limit && filteredAll.length > limit ? ` · mostrando ${filtered.length}` : ''}
        </span>
        <div className="flex items-center gap-1.5 rounded-lg border border-stats-border bg-stats-surface-2 px-2 py-1">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-stats-muted-fg)" strokeWidth={2}>
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4-4" />
          </svg>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar…"
            aria-label={`Buscar por ${dimensionLabel.toLowerCase()}`}
            className="w-28 bg-transparent text-sm text-stats-foreground outline-none placeholder:text-stats-muted-fg sm:w-36"
          />
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse text-sm">
          <thead>
            <tr>
              <th
                onClick={() => toggleSort('valor')}
                scope="col"
                aria-sort={sortKey === 'valor' ? (sortDir === 1 ? 'ascending' : 'descending') : 'none'}
                className={`cursor-pointer select-none whitespace-nowrap border-b border-stats-border px-2.5 py-2 text-left text-[0.68rem] font-bold uppercase tracking-wide ${sortKey === 'valor' ? 'text-stats-primary' : 'text-stats-muted-fg'}`}
              >
                {dimensionLabel} <Caret active={sortKey === 'valor'} dir={sortDir} />
              </th>
              {NUMERIC_COLS.map((c) => (
                <th
                  key={c.key}
                  onClick={() => toggleSort(c.key)}
                  scope="col"
                  aria-sort={sortKey === c.key ? (sortDir === 1 ? 'ascending' : 'descending') : 'none'}
                  className={`cursor-pointer select-none whitespace-nowrap border-b border-stats-border px-2.5 py-2 text-right text-[0.68rem] font-bold uppercase tracking-wide ${sortKey === c.key ? 'text-stats-primary' : 'text-stats-muted-fg'}`}
                >
                  {c.label} <Caret active={sortKey === c.key} dir={sortDir} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.valor} className="hover:bg-stats-surface-2">
                <td className="whitespace-nowrap border-b border-stats-border px-2.5 py-2 text-left text-stats-foreground">{r.valor}</td>
                <td className="border-b border-stats-border px-2.5 py-2 text-right font-stats-mono tabular-nums text-stats-foreground">
                  {formatCount(r.cantidad)}
                </td>
                <td className="border-b border-stats-border px-2.5 py-2 text-right">
                  <span className="rounded-md bg-stats-primary/10 px-1.5 py-0.5 font-stats-mono text-[0.8rem] font-semibold text-stats-primary">
                    {formatMin(r.promedio)}
                  </span>
                </td>
                <td className="border-b border-stats-border px-2.5 py-2 text-right font-stats-mono tabular-nums text-stats-foreground">
                  {formatMin(r.mediana)}
                </td>
                <td className="border-b border-stats-border px-2.5 py-2 text-right font-stats-mono tabular-nums text-stats-foreground">
                  {formatMin(r.p90)}
                </td>
                <td
                  className={`border-b border-stats-border px-2.5 py-2 text-right font-stats-mono tabular-nums ${
                    r.atraso != null && r.atraso > 0 ? 'text-stats-destructive' : 'text-stats-success'
                  }`}
                >
                  {r.atraso == null ? '—' : `${r.atraso > 0 ? '+' : ''}${formatMin(r.atraso)}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
