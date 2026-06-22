# Tabla Extendida Mobile — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the "vista extendida" of Pedidos and Services as a mobile-friendly card list on narrow viewports (≤768px), leaving the desktop table byte-identical.

**Architecture:** Keep all data/filter/sort/pagination logic in `PedidosTableModal` / `ServicesTableModal`. Add a `useIsMobile()` hook; just before each modal's existing desktop `return`, branch `if (isMobile) return <…TableMobile ctx={…}/>`. The mobile shell + cards are new presentational components in `components/ui/mobile/`, fed a single `ctx` object so nothing is recomputed and no logic is duplicated.

**Tech Stack:** Next.js 14 (App Router), React 18, TypeScript, Tailwind, framer-motion, vitest. Spec: `docs/superpowers/specs/2026-06-22-tabla-extendida-mobile-design.md`.

## Global Constraints

- **Do NOT modify the desktop render of either modal.** Edits to `PedidosTableModal.tsx` / `ServicesTableModal.tsx` are additive only: one import, one `const isMobile = useIsMobile()`, one `if (isMobile) return …` placed immediately before the existing `return (`. The existing JSX is not reindented or altered.
- **Do NOT duplicate or move data logic.** The mobile components receive already-computed values via `ctx`. No filtering/sorting/scope logic lives in `components/ui/mobile/`.
- Breakpoint: `≤ 768px` → mobile. Hook default `maxWidthPx = 768`.
- Dark theme, Tailwind classes consistent with the existing modal (`bg-gray-900`, `text-gray-200`, teal/green/red/orange accents).
- SSR-safe: no `window`/`matchMedia` access during render; only inside `useEffect`.
- Reuse the existing handlers verbatim through `ctx` (`setFilters`, `onSort`, `onPedidoClick`, `onMovilClick`, the móvil-combo toggle closure, `getMovilName`, `getMovilColor`, `formatTime`, `formatCurrency`). The mobile móvil filter must call the SAME toggle closure as desktop so colapsable sync is preserved.

---

### Task 1: `useIsMobile` hook

**Files:**
- Create: `hooks/useIsMobile.ts`
- Test: `__tests__/useIsMobile.test.tsx`

**Interfaces:**
- Produces: `export function useIsMobile(maxWidthPx?: number): boolean` (default 768).

- [ ] **Step 1: Write the failing test**

```tsx
// __tests__/useIsMobile.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useIsMobile } from '@/hooks/useIsMobile';

function mockMatchMedia(initialMatches: boolean) {
  let listeners: Array<(e: { matches: boolean }) => void> = [];
  const mql = {
    matches: initialMatches,
    media: '',
    addEventListener: (_: string, cb: (e: { matches: boolean }) => void) => { listeners.push(cb); },
    removeEventListener: (_: string, cb: (e: { matches: boolean }) => void) => { listeners = listeners.filter(l => l !== cb); },
    // legacy fallback
    addListener: (cb: (e: { matches: boolean }) => void) => { listeners.push(cb); },
    removeListener: (cb: (e: { matches: boolean }) => void) => { listeners = listeners.filter(l => l !== cb); },
    dispatch: (matches: boolean) => { mql.matches = matches; listeners.forEach(l => l({ matches })); },
  };
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue(mql));
  return mql;
}

describe('useIsMobile', () => {
  beforeEach(() => { vi.unstubAllGlobals(); });

  it('returns true when the media query matches on mount', () => {
    mockMatchMedia(true);
    const { result } = renderHook(() => useIsMobile(768));
    expect(result.current).toBe(true);
  });

  it('returns false when it does not match', () => {
    mockMatchMedia(false);
    const { result } = renderHook(() => useIsMobile(768));
    expect(result.current).toBe(false);
  });

  it('reacts to viewport changes', () => {
    const mql = mockMatchMedia(false);
    const { result } = renderHook(() => useIsMobile(768));
    expect(result.current).toBe(false);
    act(() => { mql.dispatch(true); });
    expect(result.current).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/useIsMobile.test.tsx`
Expected: FAIL — cannot resolve `@/hooks/useIsMobile`.

- [ ] **Step 3: Write the hook**

```ts
// hooks/useIsMobile.ts
'use client';

import { useEffect, useState } from 'react';

/**
 * True cuando el viewport es "mobile" (<= maxWidthPx). SSR-safe: false en server
 * y en el primer render; se resuelve en useEffect y reacciona a resize/rotación.
 */
export function useIsMobile(maxWidthPx = 768): boolean {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia(`(max-width: ${maxWidthPx}px)`);
    const update = () => setIsMobile(mql.matches);
    update();
    // addEventListener moderno con fallback a addListener (Safari viejo)
    if (mql.addEventListener) mql.addEventListener('change', update);
    else mql.addListener(update);
    return () => {
      if (mql.removeEventListener) mql.removeEventListener('change', update);
      else mql.removeListener(update);
    };
  }, [maxWidthPx]);

  return isMobile;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/useIsMobile.test.tsx`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
git add hooks/useIsMobile.ts __tests__/useIsMobile.test.tsx
git commit -m "feat(mobile): useIsMobile hook (matchMedia, SSR-safe)"
```

---

### Task 2: `MobileSheet` (generic bottom-sheet)

**Files:**
- Create: `components/ui/mobile/MobileSheet.tsx`

**Interfaces:**
- Produces: `export default function MobileSheet({ isOpen, onClose, title, children, footer }: MobileSheetProps)`
  ```ts
  interface MobileSheetProps {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    children: React.ReactNode;
    footer?: React.ReactNode;
  }
  ```

- [ ] **Step 1: Write the component**

```tsx
// components/ui/mobile/MobileSheet.tsx
'use client';

import { motion, AnimatePresence } from 'framer-motion';
import React from 'react';

interface MobileSheetProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

/** Bottom-sheet genérico: slide-up desde abajo, backdrop tap cierra. z muy alto
 *  para quedar por encima del shell mobile (que ya es z-[10001]). */
export default function MobileSheet({ isOpen, onClose, title, children, footer }: MobileSheetProps) {
  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[10060] flex flex-col justify-end bg-black/60"
          onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 320 }}
            className="bg-gray-900 rounded-t-2xl border-t border-gray-700/50 max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-700/50 flex-shrink-0">
              <h3 className="text-sm font-bold text-white">{title}</h3>
              <button onClick={onClose} className="p-2 -mr-2 text-gray-400 hover:text-white" aria-label="Cerrar">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">{children}</div>
            {footer && <div className="flex-shrink-0 px-5 py-3 border-t border-gray-700/50">{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i mobilesheet || echo CLEAN`
Expected: `CLEAN`.

- [ ] **Step 3: Commit**

```bash
git add components/ui/mobile/MobileSheet.tsx
git commit -m "feat(mobile): MobileSheet bottom-sheet primitive"
```

---

### Task 3: `PedidoCardMobile`

**Files:**
- Create: `components/ui/mobile/PedidoCardMobile.tsx`
- Test: `__tests__/PedidoCardMobile.test.tsx`

**Interfaces:**
- Consumes: `PedidoSupabase` from `@/types`, `DelayInfo` from `@/utils/pedidoDelay`.
- Produces:
  ```ts
  interface PedidoCardMobileProps {
    pedido: PedidoSupabase;
    delayInfo: DelayInfo;
    isFinalizados: boolean;
    onClick?: (id: number) => void;
    onMovilClick?: (id: number) => void;
    getMovilName: (id: number | null) => string;
    getMovilColor: (id: number | null) => string;
    formatTime: (s: string | null) => string;
    formatCurrency: (v: number | null) => string;
  }
  export default function PedidoCardMobile(props: PedidoCardMobileProps): JSX.Element
  ```

- [ ] **Step 1: Write the failing test**

```tsx
// __tests__/PedidoCardMobile.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PedidoCardMobile from '@/components/ui/mobile/PedidoCardMobile';

const basePedido: any = {
  id: 48213, movil: 12, zona_nro: 7, cliente_tel: '099 123 456',
  cliente_nombre: 'Juan Perez', cliente_direccion: 'Av. Italia 2940',
  cliente_ciudad: 'Maldonado', producto_nom: 'Supergas 13k', producto_cant: 2,
  imp_bruto: 850, fch_hora_max_ent_comp: '2026-06-22 18:30:00', estado_nro: 1,
  servicio_nombre: 'URGENTE', sub_estado_nro: null, sub_estado_desc: null,
};
const delayInfo: any = { label: 'Atrasado', badgeText: '+25m' };
const noop = () => '';

it('renders key fields and fires callbacks', () => {
  const onClick = vi.fn();
  const onMovilClick = vi.fn();
  render(
    <PedidoCardMobile
      pedido={basePedido} delayInfo={delayInfo} isFinalizados={false}
      onClick={onClick} onMovilClick={onMovilClick}
      getMovilName={(id) => `M${id}`} getMovilColor={() => '#0f0'}
      formatTime={(s) => (s ? '18:30' : '—')} formatCurrency={(v) => `$${v}`}
    />,
  );
  expect(screen.getByText('#48213')).toBeTruthy();
  expect(screen.getByText('099 123 456')).toBeTruthy();
  expect(screen.getByText(/Av\. Italia 2940/)).toBeTruthy();
  fireEvent.click(screen.getByText('M12'));
  expect(onMovilClick).toHaveBeenCalledWith(12);
  fireEvent.click(screen.getByText(/Av\. Italia 2940/));
  expect(onClick).toHaveBeenCalledWith(48213);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/PedidoCardMobile.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the component**

```tsx
// components/ui/mobile/PedidoCardMobile.tsx
'use client';

import React from 'react';
import { PedidoSupabase } from '@/types';
import { DelayInfo } from '@/utils/pedidoDelay';
import { getEstadoDescripcion, isPedidoEntregado } from '@/utils/estadoPedido';
import { fixEncoding } from '@/utils/fixEncoding';

interface PedidoCardMobileProps {
  pedido: PedidoSupabase;
  delayInfo: DelayInfo;
  isFinalizados: boolean;
  onClick?: (id: number) => void;
  onMovilClick?: (id: number) => void;
  getMovilName: (id: number | null) => string;
  getMovilColor: (id: number | null) => string;
  formatTime: (s: string | null) => string;
  formatCurrency: (v: number | null) => string;
}

function borderColor(p: PedidoSupabase, isFinalizados: boolean, info: DelayInfo): string {
  if (isFinalizados) return isPedidoEntregado(p) ? 'border-l-green-500' : 'border-l-red-500';
  if (!p.movil || Number(p.movil) === 0) return 'border-l-blue-500';
  switch (info.label) {
    case 'Muy Atrasado': return 'border-l-red-500';
    case 'Atrasado': return 'border-l-pink-500';
    case 'Hora Límite Cercana': return 'border-l-yellow-500';
    case 'En Hora': return 'border-l-green-500';
    default: return 'border-l-gray-500';
  }
}

function badgeStyle(info: DelayInfo): string {
  switch (info.label) {
    case 'Muy Atrasado': return 'bg-red-500/25 text-red-300';
    case 'Atrasado': return 'bg-pink-500/25 text-pink-300';
    case 'Hora Límite Cercana': return 'bg-yellow-500/25 text-yellow-300';
    case 'En Hora': return 'bg-green-500/25 text-green-300';
    default: return 'bg-gray-500/25 text-gray-400';
  }
}

export default function PedidoCardMobile({
  pedido: p, delayInfo, isFinalizados, onClick, onMovilClick,
  getMovilName, getMovilColor, formatTime, formatCurrency,
}: PedidoCardMobileProps) {
  const esEntregado = isFinalizados && isPedidoEntregado(p);
  const sinMovil = !p.movil || Number(p.movil) === 0;
  const isPendiente = Number(p.estado_nro) === 1;
  const estadoText = (isPendiente && sinMovil)
    ? 'Sin Asignar'
    : getEstadoDescripcion(p.sub_estado_nro, p.sub_estado_desc, p.estado_nro);
  const estadoColor = esEntregado
    ? 'bg-green-500/20 text-green-300'
    : (isPendiente && sinMovil) ? 'bg-blue-500/20 text-blue-300'
    : (!isPendiente && !esEntregado) ? 'bg-orange-500/20 text-orange-300'
    : 'bg-blue-500/20 text-blue-300';

  const atrasoMins = isFinalizados && p.atraso_cump_mins != null ? Number(p.atraso_cump_mins) : null;
  const atrasoLabel = atrasoMins == null ? null : atrasoMins === 0 ? `0'` : atrasoMins < 0 ? `${Math.abs(atrasoMins)}' antes` : `${atrasoMins}'`;
  const atrasoColor = atrasoMins == null ? 'text-gray-500' : atrasoMins <= 0 ? 'text-green-400' : atrasoMins < 15 ? 'text-yellow-400' : 'text-red-400';

  return (
    <div
      onClick={() => onClick?.(p.id)}
      className={`border-l-4 ${borderColor(p, isFinalizados, delayInfo)} bg-gray-800/60 active:bg-gray-700/70 rounded-r-lg px-3 py-2.5 text-sm cursor-pointer`}
    >
      {/* Top row: badge + #id + hora */}
      <div className="flex items-center justify-between gap-2">
        {isFinalizados ? (
          <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${esEntregado ? 'bg-green-500/25 text-green-300' : 'bg-red-500/25 text-red-300'}`}>
            {esEntregado ? '✔ Entregado' : '✗ No Entregado'}
          </span>
        ) : (
          <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${badgeStyle(delayInfo)}`}>⏱ {delayInfo.badgeText}</span>
        )}
        <div className="flex items-center gap-2 text-xs">
          <span className="font-bold text-white">#{p.id}</span>
          <span className="text-gray-400 font-mono">{formatTime(p.fch_hora_max_ent_comp)}</span>
        </div>
      </div>

      {/* Cliente */}
      <div className="mt-1.5 text-gray-100 font-semibold text-[13px]">{p.cliente_tel || '—'}</div>
      {p.cliente_nombre && <div className="text-[11px] text-gray-400">{fixEncoding(p.cliente_nombre)}</div>}

      {/* Dirección */}
      <div className="mt-1 text-gray-300 text-xs flex items-start gap-1">
        <span className="text-gray-500 mt-0.5">📍</span>
        <span>{fixEncoding(p.cliente_direccion) || '—'}{p.cliente_ciudad ? `, ${p.cliente_ciudad}` : ''}</span>
      </div>

      {/* Footer chips */}
      <div className="mt-2 flex items-center gap-2 flex-wrap text-[11px]">
        <button
          onClick={(e) => { e.stopPropagation(); if (p.movil) onMovilClick?.(Number(p.movil)); }}
          className="inline-flex items-center gap-1 text-gray-200 underline decoration-dotted"
        >
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: getMovilColor(p.movil) }} />
          {getMovilName(p.movil)}
        </button>
        {p.zona_nro ? <span className="text-gray-400">Z{p.zona_nro}</span> : null}
        {(p.producto_nom || p.producto_cod) && (
          <span className="text-gray-400">{(p.producto_nom || p.producto_cod)}{p.producto_cant ? ` x${p.producto_cant}` : ''}</span>
        )}
        {p.servicio_nombre && <span className="px-1.5 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300">{p.servicio_nombre}</span>}
      </div>

      {/* Estado + importe + (finalizados) cumplido/atraso */}
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <span className={`text-[10px] px-2 py-0.5 rounded-full ${estadoColor}`}>{estadoText}</span>
        <div className="flex items-center gap-2 text-xs">
          {isFinalizados && (
            <span className="text-gray-400 font-mono">{p.fch_hora_finalizacion ? formatTime(p.fch_hora_finalizacion) : '—'}</span>
          )}
          {atrasoLabel && <span className={`font-bold ${atrasoColor}`}>{atrasoLabel}</span>}
          <span className="text-gray-300">{formatCurrency(p.imp_bruto)}</span>
        </div>
      </div>

      {(p.pedido_obs || p.cliente_obs) && (
        <div className="mt-1 text-[10px] text-gray-500 truncate">{p.pedido_obs || p.cliente_obs}</div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/PedidoCardMobile.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/ui/mobile/PedidoCardMobile.tsx __tests__/PedidoCardMobile.test.tsx
git commit -m "feat(mobile): PedidoCardMobile compact card"
```

---

### Task 4: `ServiceCardMobile`

**Files:**
- Create: `components/ui/mobile/ServiceCardMobile.tsx`

**Interfaces:**
- Consumes: `ServiceSupabase` from `@/types`, `DelayInfo`.
- Produces:
  ```ts
  interface ServiceCardMobileProps {
    service: ServiceSupabase;
    delayInfo: DelayInfo;
    isFinalizados: boolean;
    onClick?: (id: number) => void;
    onMovilClick?: (id: number) => void;
    getMovilName: (id: number | null) => string;
    getMovilColor: (id: number | null) => string;
    formatTime: (s: string | null) => string;
  }
  export default function ServiceCardMobile(props: ServiceCardMobileProps): JSX.Element
  ```

- [ ] **Step 1: Write the component**

Mirror `PedidoCardMobile`, with service differences: no importe, no producto/tipoServicio; show `defecto` chip instead of producto. Use `getEstadoDescripcion`/`isPedidoEntregado` against the service row (same shape fields: `estado_nro`, `sub_estado_nro`, `sub_estado_desc`, `movil`, `zona_nro`, `cliente_*`, `fch_hora_max_ent_comp`, `fch_hora_finalizacion`, `atraso_cump_mins`, `pedido_obs`, `cliente_obs`).

```tsx
// components/ui/mobile/ServiceCardMobile.tsx
'use client';

import React from 'react';
import { ServiceSupabase } from '@/types';
import { DelayInfo } from '@/utils/pedidoDelay';
import { getEstadoDescripcion, isPedidoEntregado } from '@/utils/estadoPedido';
import { fixEncoding } from '@/utils/fixEncoding';

interface ServiceCardMobileProps {
  service: ServiceSupabase;
  delayInfo: DelayInfo;
  isFinalizados: boolean;
  onClick?: (id: number) => void;
  onMovilClick?: (id: number) => void;
  getMovilName: (id: number | null) => string;
  getMovilColor: (id: number | null) => string;
  formatTime: (s: string | null) => string;
}

function borderColor(s: ServiceSupabase, isFinalizados: boolean, info: DelayInfo): string {
  if (isFinalizados) return isPedidoEntregado(s as any) ? 'border-l-green-500' : 'border-l-red-500';
  if (!s.movil || Number(s.movil) === 0) return 'border-l-blue-500';
  switch (info.label) {
    case 'Muy Atrasado': return 'border-l-red-500';
    case 'Atrasado': return 'border-l-pink-500';
    case 'Hora Límite Cercana': return 'border-l-yellow-500';
    case 'En Hora': return 'border-l-green-500';
    default: return 'border-l-gray-500';
  }
}

function badgeStyle(info: DelayInfo): string {
  switch (info.label) {
    case 'Muy Atrasado': return 'bg-red-500/25 text-red-300';
    case 'Atrasado': return 'bg-pink-500/25 text-pink-300';
    case 'Hora Límite Cercana': return 'bg-yellow-500/25 text-yellow-300';
    case 'En Hora': return 'bg-green-500/25 text-green-300';
    default: return 'bg-gray-500/25 text-gray-400';
  }
}

export default function ServiceCardMobile({
  service: s, delayInfo, isFinalizados, onClick, onMovilClick,
  getMovilName, getMovilColor, formatTime,
}: ServiceCardMobileProps) {
  const esEntregado = isFinalizados && isPedidoEntregado(s as any);
  const sinMovil = !s.movil || Number(s.movil) === 0;
  const isPendiente = Number(s.estado_nro) === 1;
  const estadoText = (isPendiente && sinMovil) ? 'Sin Asignar' : getEstadoDescripcion(s.sub_estado_nro, s.sub_estado_desc, s.estado_nro);
  const estadoColor = esEntregado ? 'bg-green-500/20 text-green-300'
    : (isPendiente && sinMovil) ? 'bg-blue-500/20 text-blue-300'
    : (!isPendiente && !esEntregado) ? 'bg-orange-500/20 text-orange-300'
    : 'bg-blue-500/20 text-blue-300';

  const atrasoMins = isFinalizados && s.atraso_cump_mins != null ? Number(s.atraso_cump_mins) : null;
  const atrasoLabel = atrasoMins == null ? null : atrasoMins === 0 ? `0'` : atrasoMins < 0 ? `${Math.abs(atrasoMins)}' antes` : `${atrasoMins}'`;
  const atrasoColor = atrasoMins == null ? 'text-gray-500' : atrasoMins <= 0 ? 'text-green-400' : atrasoMins < 15 ? 'text-yellow-400' : 'text-red-400';

  return (
    <div onClick={() => onClick?.(s.id)} className={`border-l-4 ${borderColor(s, isFinalizados, delayInfo)} bg-gray-800/60 active:bg-gray-700/70 rounded-r-lg px-3 py-2.5 text-sm cursor-pointer`}>
      <div className="flex items-center justify-between gap-2">
        {isFinalizados ? (
          <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${esEntregado ? 'bg-green-500/25 text-green-300' : 'bg-red-500/25 text-red-300'}`}>{esEntregado ? '✔ Entregado' : '✗ No Entregado'}</span>
        ) : (
          <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${badgeStyle(delayInfo)}`}>⏱ {delayInfo.badgeText}</span>
        )}
        <div className="flex items-center gap-2 text-xs">
          <span className="font-bold text-white">#{s.id}</span>
          <span className="text-gray-400 font-mono">{formatTime(s.fch_hora_max_ent_comp)}</span>
        </div>
      </div>
      <div className="mt-1.5 text-gray-100 font-semibold text-[13px]">{s.cliente_tel || '—'}</div>
      {s.cliente_nombre && <div className="text-[11px] text-gray-400">{fixEncoding(s.cliente_nombre)}</div>}
      <div className="mt-1 text-gray-300 text-xs flex items-start gap-1">
        <span className="text-gray-500 mt-0.5">📍</span>
        <span>{fixEncoding(s.cliente_direccion) || '—'}{s.cliente_ciudad ? `, ${s.cliente_ciudad}` : ''}</span>
      </div>
      <div className="mt-2 flex items-center gap-2 flex-wrap text-[11px]">
        <button onClick={(e) => { e.stopPropagation(); if (s.movil) onMovilClick?.(Number(s.movil)); }} className="inline-flex items-center gap-1 text-gray-200 underline decoration-dotted">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: getMovilColor(s.movil) }} />
          {getMovilName(s.movil)}
        </button>
        {s.zona_nro ? <span className="text-gray-400">Z{s.zona_nro}</span> : null}
        {s.defecto && <span className="px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300">{s.defecto}</span>}
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <span className={`text-[10px] px-2 py-0.5 rounded-full ${estadoColor}`}>{estadoText}</span>
        {isFinalizados && (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-gray-400 font-mono">{s.fch_hora_finalizacion ? formatTime(s.fch_hora_finalizacion) : '—'}</span>
            {atrasoLabel && <span className={`font-bold ${atrasoColor}`}>{atrasoLabel}</span>}
          </div>
        )}
      </div>
      {(s.pedido_obs || s.cliente_obs) && <div className="mt-1 text-[10px] text-gray-500 truncate">{s.pedido_obs || s.cliente_obs}</div>}
    </div>
  );
}
```

> Note: if `ServiceSupabase` lacks `defecto`/`cliente_ciudad`/`pedido_obs` fields, drop those lines (verify against `types/index.ts`). The desktop Services table reads `s.defecto`, `s.pedido_obs`, `s.cliente_obs`, so they exist.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i ServiceCardMobile || echo CLEAN`
Expected: `CLEAN`.

- [ ] **Step 3: Commit**

```bash
git add components/ui/mobile/ServiceCardMobile.tsx
git commit -m "feat(mobile): ServiceCardMobile compact card"
```

---

### Task 5: `PedidosTableMobile` shell

**Files:**
- Create: `components/ui/mobile/PedidosTableMobile.tsx`

**Interfaces:**
- Consumes: `MobileSheet` (Task 2), `PedidoCardMobile` (Task 3).
- Produces: `export default function PedidosTableMobile({ ctx }: { ctx: PedidosMobileCtx })`. Define and `export interface PedidosMobileCtx` here (Task 7 imports it). Fields:
  ```ts
  export interface PedidosMobileCtx {
    isOpen: boolean;
    onClose: () => void;
    title: string;                 // "Pedidos"
    isFinalizados: boolean;
    isFilterDisabled: boolean;
    canVerSinAsignarUnitario: boolean;
    sorted: { pedido: import('@/types').PedidoSupabase; delayMins: number | null; delayInfo: import('@/utils/pedidoDelay').DelayInfo }[];
    totalBase: number;             // pedidosBase.length
    stats: Record<string, number>;
    page: number;
    setPage: (u: number | ((p: number) => number)) => void;
    pageSize: number;
    filters: any;                  // same Filters object as desktop
    setFilters: (u: any) => void;
    vista: 'pendientes' | 'finalizados';
    onVistaChange?: (v: 'pendientes' | 'finalizados') => void;
    servicesAvailable: boolean;
    modalTipo: 'pedidos' | 'services';
    setModalTipo: (t: 'pedidos' | 'services') => void;
    sortKey: string; sortDir: 'asc' | 'desc'; onSort: (k: any) => void;
    sortOptions: { key: string; label: string }[];
    atrasoOptions: { key: string; label: string; color: string; dotColor: string }[];
    uniqueZonas: number[]; uniqueProductos: string[]; uniqueServicioNombres: string[];
    movilCombo: {
      label: string; isActive: boolean;
      ids: number[]; selected: number[];
      onToggle: (id: number, checked: boolean) => void;
      onSelectAll: () => void; onSelectNone: () => void;
      getMovilName: (id: number | null) => string;
    };
    onPedidoClick?: (id: number) => void;
    onMovilClick?: (id: number) => void;
    getMovilName: (id: number | null) => string;
    getMovilColor: (id: number | null) => string;
    formatTime: (s: string | null) => string;
    formatCurrency: (v: number | null) => string;
    hasActiveFilters: boolean; clearFilters: () => void; activeFilterCount: number;
  }
  ```

- [ ] **Step 1: Write the shell**

Render structure (full code):

```tsx
// components/ui/mobile/PedidosTableMobile.tsx
'use client';

import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import MobileSheet from './MobileSheet';
import PedidoCardMobile from './PedidoCardMobile';
import { PedidoSupabase } from '@/types';
import { DelayInfo } from '@/utils/pedidoDelay';

export interface PedidosMobileCtx { /* …as defined in Interfaces above… */ }

export default function PedidosTableMobile({ ctx }: { ctx: PedidosMobileCtx }) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const visibleCount = (ctx.page + 1) * ctx.pageSize;
  const visible = ctx.sorted.slice(0, visibleCount);
  const hasMore = visibleCount < ctx.sorted.length;

  // Infinite scroll: cuando el sentinel entra en viewport y quedan más, +1 página.
  useEffect(() => {
    if (!hasMore || !sentinelRef.current) return;
    const el = sentinelRef.current;
    const obs = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) ctx.setPage((p) => p + 1);
    }, { rootMargin: '200px' });
    obs.observe(el);
    return () => obs.disconnect();
  }, [hasMore, ctx]);

  const seg = (active: boolean) => `flex-1 px-3 py-2 text-xs font-medium rounded-md transition-all ${active ? 'bg-teal-500/30 text-teal-300' : 'text-gray-400'}`;

  return (
    <AnimatePresence>
      {ctx.isOpen && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-[10001] bg-gray-900 flex flex-col"
        >
          {/* Header */}
          <div className="flex-shrink-0 border-b border-gray-700/50 px-4 pt-3 pb-2 bg-gray-900">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-white">Vista Extendida</h2>
                <p className="text-[11px] text-gray-400">{ctx.sorted.length} {ctx.isFinalizados ? 'finalizado' : 'pendiente'}{ctx.sorted.length !== 1 ? 's' : ''}{ctx.hasActiveFilters ? ` · de ${ctx.totalBase}` : ''}</p>
              </div>
              <button onClick={ctx.onClose} className="p-2 -mr-2 text-gray-400 hover:text-white" aria-label="Cerrar">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            {/* Tipo Pedidos/Services (cuando aplica) */}
            {ctx.servicesAvailable && (
              <div className="mt-2 flex gap-1 bg-gray-800/60 rounded-lg p-0.5">
                <button onClick={() => ctx.setModalTipo('pedidos')} className={seg(ctx.modalTipo === 'pedidos')}>Pedidos</button>
                <button onClick={() => ctx.setModalTipo('services')} className={seg(ctx.modalTipo === 'services')}>Services</button>
              </div>
            )}

            {/* Vista Pendientes/Finalizados */}
            <div className="mt-2 flex gap-1 bg-gray-800/60 rounded-lg p-0.5">
              <button disabled={ctx.isFilterDisabled} onClick={() => { if (!ctx.isFilterDisabled) { ctx.onVistaChange?.('pendientes'); ctx.setFilters((f: any) => ({ ...f, entrega: 'todos', atraso: [] })); } }} className={seg(ctx.vista === 'pendientes')}>Pendientes</button>
              <button disabled={ctx.isFilterDisabled} onClick={() => { if (!ctx.isFilterDisabled) { ctx.onVistaChange?.('finalizados'); ctx.setFilters((f: any) => ({ ...f, asignacion: 'todos', atraso: [] })); } }} className={seg(ctx.isFinalizados)}>Finalizados</button>
            </div>

            {/* Búsqueda */}
            <div className="mt-2 relative">
              <svg className="w-4 h-4 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
              <input value={ctx.filters.search} onChange={(e) => { ctx.setFilters((f: any) => ({ ...f, search: e.target.value })); ctx.setPage(0); }} placeholder="Buscar…" className="w-full pl-9 pr-3 py-2 bg-gray-800 border border-gray-600/50 rounded-lg text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-teal-500/50" />
            </div>

            {/* Acciones: Filtros + Ordenar */}
            <div className="mt-2 flex gap-2">
              <button onClick={() => setFiltersOpen(true)} className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg bg-gray-800 border border-gray-600/50 text-gray-200">
                Filtros{ctx.activeFilterCount > 0 && <span className="bg-teal-500 text-white text-[10px] min-w-4 h-4 px-1 rounded-full flex items-center justify-center">{ctx.activeFilterCount}</span>}
              </button>
              <button onClick={() => setSortOpen(true)} className="flex-1 px-3 py-2 text-xs font-medium rounded-lg bg-gray-800 border border-gray-600/50 text-gray-200">Ordenar</button>
            </div>
          </div>

          {/* Lista */}
          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
            {visible.length === 0 ? (
              <div className="text-center py-16 text-gray-500 text-sm">{ctx.hasActiveFilters ? 'Sin resultados con esos filtros' : (ctx.isFinalizados ? 'No hay finalizados' : 'No hay pendientes')}</div>
            ) : (
              <>
                {visible.map(({ pedido, delayInfo }) => (
                  <PedidoCardMobile
                    key={pedido.id} pedido={pedido} delayInfo={delayInfo} isFinalizados={ctx.isFinalizados}
                    onClick={ctx.onPedidoClick} onMovilClick={ctx.onMovilClick}
                    getMovilName={ctx.getMovilName} getMovilColor={ctx.getMovilColor}
                    formatTime={ctx.formatTime} formatCurrency={ctx.formatCurrency}
                  />
                ))}
                <div ref={sentinelRef} />
                {hasMore && (
                  <button onClick={() => ctx.setPage((p) => p + 1)} className="w-full py-3 text-xs text-teal-300 bg-gray-800/60 rounded-lg">Cargar más ({ctx.sorted.length - visible.length} restantes)</button>
                )}
                <div className="text-center text-[10px] text-gray-600 pt-1">Mostrando {visible.length} de {ctx.sorted.length}</div>
              </>
            )}
          </div>

          {/* Hoja de Ordenar */}
          <MobileSheet isOpen={sortOpen} onClose={() => setSortOpen(false)} title="Ordenar por">
            <div className="space-y-1">
              {ctx.sortOptions.map((o) => {
                const active = ctx.sortKey === o.key;
                return (
                  <button key={o.key} onClick={() => ctx.onSort(o.key)} className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm ${active ? 'bg-teal-500/20 text-teal-300' : 'text-gray-300 bg-gray-800/40'}`}>
                    <span>{o.label}</span>
                    {active && <span>{ctx.sortDir === 'asc' ? '↑' : '↓'}</span>}
                  </button>
                );
              })}
            </div>
          </MobileSheet>

          {/* Hoja de Filtros */}
          <MobileSheet
            isOpen={filtersOpen} onClose={() => setFiltersOpen(false)} title="Filtros"
            footer={
              <div className="flex gap-2">
                {ctx.hasActiveFilters && <button onClick={ctx.clearFilters} className="flex-1 py-2.5 text-sm text-red-300 bg-red-500/10 rounded-lg">Limpiar</button>}
                <button onClick={() => setFiltersOpen(false)} className="flex-1 py-2.5 text-sm text-white bg-teal-600 rounded-lg">Aplicar</button>
              </div>
            }
          >
            {/* Asignación / Entrega */}
            {ctx.isFinalizados ? (
              <FilterGroup label="Entrega">
                {(['todos', 'entregados', 'no_entregados'] as const).map((v) => (
                  <Chip key={v} active={ctx.filters.entrega === v} disabled={ctx.isFilterDisabled} onClick={() => ctx.setFilters((f: any) => ({ ...f, entrega: v }))}>{v === 'todos' ? 'Todos' : v === 'entregados' ? 'Entregados' : 'No Entregados'}</Chip>
                ))}
              </FilterGroup>
            ) : (
              <FilterGroup label="Asignación">
                <Chip active={ctx.filters.asignacion === 'todos'} disabled={ctx.isFilterDisabled} onClick={() => ctx.setFilters((f: any) => ({ ...f, asignacion: 'todos' }))}>Todos</Chip>
                <Chip active={ctx.filters.asignacion === 'con_movil'} disabled={ctx.isFilterDisabled} onClick={() => ctx.setFilters((f: any) => ({ ...f, asignacion: 'con_movil' }))}>Con Móvil</Chip>
                {ctx.canVerSinAsignarUnitario && <Chip active={ctx.filters.asignacion === 'sin_movil'} disabled={ctx.isFilterDisabled} onClick={() => ctx.setFilters((f: any) => ({ ...f, asignacion: 'sin_movil' }))}>Sin Móvil</Chip>}
              </FilterGroup>
            )}

            {/* Atraso */}
            <FilterGroup label="Atraso">
              {ctx.atrasoOptions.map((o) => {
                const active = ctx.filters.atraso.includes(o.key);
                return (
                  <Chip key={o.key} active={active} disabled={ctx.isFilterDisabled} onClick={() => { ctx.setFilters((f: any) => ({ ...f, atraso: f.atraso.includes(o.key) ? f.atraso.filter((k: string) => k !== o.key) : [...f.atraso, o.key] })); ctx.setPage(0); }}>{o.label} ({ctx.stats[o.key] || 0})</Chip>
                );
              })}
            </FilterGroup>

            {/* Zona */}
            <FilterSelect label="Zona" value={ctx.filters.zona ?? ''} disabled={ctx.isFilterDisabled} onChange={(v) => { ctx.setFilters((f: any) => ({ ...f, zona: v ? Number(v) : null })); ctx.setPage(0); }} options={[{ value: '', label: 'Todas' }, ...ctx.uniqueZonas.map((z) => ({ value: String(z), label: `Zona ${z}` }))]} />

            {/* Producto */}
            {ctx.uniqueProductos.length > 0 && (
              <FilterSelect label="Producto" value={ctx.filters.producto ?? ''} disabled={ctx.isFilterDisabled} onChange={(v) => { ctx.setFilters((f: any) => ({ ...f, producto: v || null })); ctx.setPage(0); }} options={[{ value: '', label: 'Todos' }, ...ctx.uniqueProductos.map((p) => ({ value: p, label: p }))]} />
            )}

            {/* Tipo servicio (multi) */}
            {ctx.uniqueServicioNombres.length > 0 && (
              <FilterGroup label="Tipo de servicio">
                {ctx.uniqueServicioNombres.map((t) => (
                  <Chip key={t} active={ctx.filters.tipoServicio.includes(t)} disabled={ctx.isFilterDisabled} onClick={() => { ctx.setFilters((f: any) => ({ ...f, tipoServicio: f.tipoServicio.includes(t) ? f.tipoServicio.filter((x: string) => x !== t) : [...f.tipoServicio, t] })); ctx.setPage(0); }}>{t}</Chip>
                ))}
              </FilterGroup>
            )}

            {/* Móvil (multi) — usa el MISMO handler que desktop */}
            <FilterGroup label="Móvil">
              <Chip active={false} disabled={ctx.isFilterDisabled} onClick={ctx.movilCombo.onSelectAll}>Todos</Chip>
              <Chip active={false} disabled={ctx.isFilterDisabled} onClick={ctx.movilCombo.onSelectNone}>Ninguno</Chip>
              {ctx.movilCombo.ids.map((id) => (
                <Chip key={id} active={ctx.movilCombo.selected.includes(id)} disabled={ctx.isFilterDisabled} onClick={() => ctx.movilCombo.onToggle(id, !ctx.movilCombo.selected.includes(id))}>{ctx.movilCombo.getMovilName(id)}</Chip>
              ))}
            </FilterGroup>
          </MobileSheet>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ── helpers locales ──
function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-gray-500 mb-1.5">{label}</div>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}
function Chip({ active, disabled, onClick, children }: { active: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button disabled={disabled} onClick={() => { if (!disabled) onClick(); }} className={`px-3 py-1.5 text-xs rounded-full border ${active ? 'bg-teal-500/20 border-teal-500/40 text-teal-300' : 'bg-gray-800 border-gray-600/50 text-gray-300'} ${disabled ? 'opacity-50' : ''}`}>{children}</button>
  );
}
function FilterSelect({ label, value, onChange, options, disabled }: { label: string; value: string | number; onChange: (v: string) => void; options: { value: string; label: string }[]; disabled?: boolean }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-gray-500 mb-1.5">{label}</div>
      <select disabled={disabled} value={value} onChange={(e) => onChange(e.target.value)} className={`w-full bg-gray-800 border border-gray-600/50 rounded-lg text-sm text-gray-200 px-3 py-2 ${disabled ? 'opacity-50' : ''}`}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}
```

> Replace the `export interface PedidosMobileCtx { /* … */ }` placeholder with the full interface from the Interfaces block above.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i PedidosTableMobile || echo CLEAN`
Expected: `CLEAN`.

- [ ] **Step 3: Commit**

```bash
git add components/ui/mobile/PedidosTableMobile.tsx
git commit -m "feat(mobile): PedidosTableMobile shell (cards + filter/sort sheets + infinite scroll)"
```

---

### Task 6: `ServicesTableMobile` shell

**Files:**
- Create: `components/ui/mobile/ServicesTableMobile.tsx`

**Interfaces:**
- Produces: `export default function ServicesTableMobile({ ctx }: { ctx: ServicesMobileCtx })` and `export interface ServicesMobileCtx`. Identical to `PedidosMobileCtx` minus pedido-only fields: drop `uniqueProductos`, `uniqueServicioNombres`, `formatCurrency`, `servicesAvailable`, `modalTipo`, `setModalTipo`; add `uniqueDefectos: string[]`. `sorted` items are `{ service: ServiceSupabase; delayMins; delayInfo }`.

- [ ] **Step 1: Write the shell**

Copy `PedidosTableMobile`, then: render `ServiceCardMobile` instead of `PedidoCardMobile`; remove the Pedidos/Services toggle; remove the Producto + Tipo servicio filter groups; replace Producto with a Defecto `FilterSelect` bound to `ctx.filters.defecto` / `ctx.uniqueDefectos`; title "Vista Extendida de Services". Keep the same FilterGroup/Chip/FilterSelect helpers (copy them into this file, or extract to `components/ui/mobile/filterControls.tsx` and import in both — extraction preferred to stay DRY).

> DRY note: extract `FilterGroup`, `Chip`, `FilterSelect`, and the `seg()` segment style into `components/ui/mobile/filterControls.tsx` exporting all three components + a `segClass(active)` helper; import them in both shells. Update Task 5's file to import from there too.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -iE "ServicesTableMobile|filterControls" || echo CLEAN`
Expected: `CLEAN`.

- [ ] **Step 3: Commit**

```bash
git add components/ui/mobile/ServicesTableMobile.tsx components/ui/mobile/filterControls.tsx components/ui/mobile/PedidosTableMobile.tsx
git commit -m "feat(mobile): ServicesTableMobile shell + shared filterControls"
```

---

### Task 7: Wire `PedidosTableModal` (additive)

**Files:**
- Modify: `components/ui/PedidosTableModal.tsx` (add import + `const isMobile` + `if (isMobile) return …` immediately before the existing `return (`)

**Interfaces:**
- Consumes: `useIsMobile` (Task 1), `PedidosTableMobile` + `PedidosMobileCtx` (Task 5).

- [ ] **Step 1: Add imports** (top of file, with the other imports):

```ts
import { useIsMobile } from '@/hooks/useIsMobile';
import PedidosTableMobile from '@/components/ui/mobile/PedidosTableMobile';
```

- [ ] **Step 2: Add the hook + sort/atraso option lists**

Immediately after `const formatCurrency = …` (just before the desktop `return (`), add:

```tsx
  const isMobile = useIsMobile();

  const mobileSortOptions = [
    { key: 'delay', label: 'Atraso' },
    { key: 'id', label: '# Pedido' },
    { key: 'movil', label: 'Móvil' },
    { key: 'zona', label: 'Zona' },
    { key: 'cliente', label: 'Cliente' },
    { key: 'importe', label: 'Importe' },
    { key: 'hora_max', label: 'Hora Máx' },
    ...(isFinalizados ? [{ key: 'cumplido', label: 'Cumplido' }] : []),
  ];

  // Recrea exactamente la lógica del combo de móvil del desktop (colapsable vs filtro local),
  // pero expuesta como handlers planos para el shell mobile.
  const isColapsableMode = openSource === 'colapsable';
  const movilComboSelected = isColapsableMode ? selectedMoviles : filters.movil;
  const movilComboToggle = (id: number, checked: boolean) => {
    if (isColapsableMode && onSelectedMovilesChange) {
      onSelectedMovilesChange(checked ? Array.from(new Set([...selectedMoviles, id])) : selectedMoviles.filter((x) => x !== id));
    } else {
      setFilters((f) => ({ ...f, movil: checked ? Array.from(new Set([...f.movil, id])) : f.movil.filter((x) => x !== id) }));
    }
    setPage(0);
  };
  const movilComboSelectAll = () => { if (isColapsableMode && onSelectedMovilesChange) onSelectedMovilesChange(activeMovilesForCombo); else setFilters((f) => ({ ...f, movil: [] })); setPage(0); };
  const movilComboSelectNone = () => { if (isColapsableMode && onSelectedMovilesChange) onSelectedMovilesChange([]); else setFilters((f) => ({ ...f, movil: [] })); setPage(0); };

  const activeFilterCount = [filters.atraso.length > 0, filters.zona !== null, (isColapsableMode ? movilComboSelected.length > 0 && movilComboSelected.length !== activeMovilesForCombo.length : filters.movil.length > 0), filters.producto !== null, filters.tipoServicio.length > 0, filters.asignacion !== 'todos', filters.entrega !== 'todos'].filter(Boolean).length;

  if (isMobile) {
    return (
      <PedidosTableMobile
        ctx={{
          isOpen, onClose, title: 'Pedidos', isFinalizados, isFilterDisabled, canVerSinAsignarUnitario,
          sorted, totalBase: pedidosBase.length, stats, page, setPage, pageSize: PAGE_SIZE,
          filters, setFilters, vista, onVistaChange,
          servicesAvailable: !!(services && services.length >= 0), modalTipo, setModalTipo,
          sortKey, sortDir, onSort: handleSort, sortOptions: mobileSortOptions,
          atrasoOptions: (isFinalizados ? ATRASO_FINALIZADO_OPTIONS : ATRASO_OPTIONS) as { key: string; label: string; color: string; dotColor: string }[],
          uniqueZonas, uniqueProductos, uniqueServicioNombres,
          movilCombo: {
            label: '', isActive: false,
            ids: activeMovilesForCombo, selected: movilComboSelected,
            onToggle: movilComboToggle, onSelectAll: movilComboSelectAll, onSelectNone: movilComboSelectNone,
            getMovilName,
          },
          onPedidoClick, onMovilClick, getMovilName, getMovilColor, formatTime, formatCurrency,
          hasActiveFilters: !!hasActiveFilters, clearFilters, activeFilterCount,
        }}
      />
    );
  }
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i PedidosTableModal || echo CLEAN`
Expected: `CLEAN` (fix any type mismatches between the ctx object and `PedidosMobileCtx`; align names).

- [ ] **Step 4: Verify desktop tests still pass**

Run: `npx vitest run __tests__/tabla-extendida-filtros-origen.test.ts`
Expected: PASS (no logic changed).

- [ ] **Step 5: Commit**

```bash
git add components/ui/PedidosTableModal.tsx
git commit -m "feat(mobile): render PedidosTableMobile on narrow viewports (desktop untouched)"
```

---

### Task 8: Wire `ServicesTableModal` (additive)

**Files:**
- Modify: `components/ui/ServicesTableModal.tsx`

**Interfaces:**
- Consumes: `useIsMobile`, `ServicesTableMobile` + `ServicesMobileCtx`.

- [ ] **Step 1: Add imports**

```ts
import { useIsMobile } from '@/hooks/useIsMobile';
import ServicesTableMobile from '@/components/ui/mobile/ServicesTableMobile';
```

- [ ] **Step 2: Add hook + `if (isMobile) return`** just before the desktop `return (`, mirroring Task 7 but with the Services ctx (no producto/tipoServicio/importe/modalTipo; add `uniqueDefectos`; sort options use the Services `SortKey` set: delay, id, movil, zona, cliente, defecto, hora_max). Build `movilCombo` the same way. Map `sorted` items as `{ service, delayMins, delayInfo }`.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i ServicesTableModal || echo CLEAN`
Expected: `CLEAN`.

- [ ] **Step 4: Commit**

```bash
git add components/ui/ServicesTableModal.tsx
git commit -m "feat(mobile): render ServicesTableMobile on narrow viewports (desktop untouched)"
```

---

### Task 9: Full verification (typecheck, tests, visual)

- [ ] **Step 1: Full typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no new errors in the touched files.

- [ ] **Step 2: Full test run for the affected areas**

Run: `npx vitest run __tests__/useIsMobile.test.tsx __tests__/PedidoCardMobile.test.tsx __tests__/tabla-extendida-filtros-origen.test.ts app/api/zonas/capacidad-snapshot/route.test.ts`
Expected: all PASS.

- [ ] **Step 3: Lint the new files**

Run: `npx eslint components/ui/mobile hooks/useIsMobile.ts --max-warnings=0`
Expected: clean (fix any unused vars / hook-deps).

- [ ] **Step 4: Visual check (Playwright, optional but recommended)**

Start dev server, open dashboard, set viewport 390×844, open the extended Pedidos table, screenshot the card list + open the Filtros sheet + screenshot. Then set viewport 1440×900 and confirm the desktop table renders unchanged. (Use the playwright MCP tools.)

- [ ] **Step 5: Final commit / push**

```bash
git add -A && git commit -m "test(mobile): verification pass for extended table mobile" || true
git push origin dev
```

---

## Self-Review

**Spec coverage:**
- Activación por ancho → Task 1 (`useIsMobile`) + Tasks 7/8 (`if (isMobile)`). ✓
- Pedidos y Services → Tasks 3/5/7 (pedidos), 4/6/8 (services). ✓
- Tarjeta compacta → Tasks 3/4 (layout matches approved mockup). ✓
- Barra fija + hoja de filtros → Task 5/6 (header search + MobileSheet filters/sort). ✓
- Infinite scroll + "Cargar más" → Task 5 (IntersectionObserver + button). ✓
- Web idéntica (additive edits) → Tasks 7/8 (import + hook + single `if` before desktop return). ✓
- Testing (hook unit, card smoke, no-regresión, visual) → Tasks 1, 3, 9. ✓

**Placeholder scan:** `PedidosMobileCtx` body is shown fully in the Interfaces block; Task 5 Step 1 notes to paste it in place of the `/* … */` marker. Task 6 and Task 8 describe deltas from Tasks 5/7 with explicit field lists (allowed: they are "copy X then change these named things", with the exact names enumerated — not "similar to N" hand-waving). Acceptable.

**Type consistency:** `setPage` signature `(u: number | ((p:number)=>number)) => void` matches React's setter; `sorted` element shape matches the modals' `pedidosWithDelay`/services equivalent; `handleSort` is passed as `onSort`; `ATRASO_OPTIONS`/`ATRASO_FINALIZADO_OPTIONS` already exist in each modal. Verify `activeMovilesForCombo`, `selectedMoviles`, `onSelectedMovilesChange`, `services`, `modalTipo`, `setModalTipo` are in scope at the insertion point in `PedidosTableModal` (they are — declared above the return). For `ServicesTableModal`, confirm it has `vista`/`isFinalizados`/`entrega` (it does, per dashboard usage) before wiring the Entrega group.
