'use client';

import React from 'react';
import { List } from 'react-window';

/**
 * 🚀 VIRTUAL SCROLLING LIST (react-window v2 API)
 * 
 * Renderiza solo los items visibles en el viewport del scroll.
 * Con 600 pedidos, en lugar de renderizar 600 elementos DOM,
 * solo renderiza ~15-20 que caben en la pantalla.
 * 
 * Ahorro: ~95% menos elementos DOM en el sidebar.
 */

interface VirtualListProps<T> {
  items: T[];
  height: number;
  itemHeight: number;
  renderItem: (item: T, index: number) => React.ReactNode;
  className?: string;
  overscanCount?: number;
}

interface VirtualRowData<T> {
  items: T[];
  renderItem: (item: T, index: number) => React.ReactNode;
}

// react-window v2 rowComponent: plain function matching expected signature
function VirtualRow<T>(props: {
  ariaAttributes: { 'aria-posinset': number; 'aria-setsize': number; role: 'listitem' };
  index: number;
  style: React.CSSProperties;
  data: VirtualRowData<T>;
}) {
  const { index, style, data } = props;
  const items = data?.items;
  const renderItem = data?.renderItem;

  if (!items || !renderItem || index < 0 || index >= items.length || !items[index]) {
    return <div style={style} />;
  }

  return (
    <div style={style}>
      {renderItem(items[index], index)}
    </div>
  );
}

export function VirtualList<T>({
  items,
  height,
  itemHeight,
  renderItem,
  className = '',
  overscanCount = 5,
}: VirtualListProps<T>) {
  if (!items || items.length === 0) {
    return null;
  }

  // Altura segura (mínimo 100px, nunca NaN)
  const safeHeight = Math.max(100, Number.isFinite(height) ? height : 400);

  // Si hay pocos items (<30), no usar virtualización (overhead innecesario)
  if (items.length < 30) {
    return (
      <div className={className} style={{ maxHeight: safeHeight, overflowY: 'auto' }}>
        {items.map((item, index) => (
          <div key={index}>
            {renderItem(item, index)}
          </div>
        ))}
      </div>
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ListAny = List as any;

  return (
    <ListAny
      height={safeHeight}
      rowCount={items.length}
      rowHeight={itemHeight}
      className={className}
      overscanCount={overscanCount}
      rowComponent={VirtualRow}
      rowProps={{ data: { items, renderItem } }}
    />
  );
}

/**
 * Hook para calcular la altura disponible del contenedor virtual
 * basado en el viewport
 */
export function useVirtualListHeight(
  containerRef: React.RefObject<HTMLDivElement | null>,
  defaultHeight: number = 400
): number {
  const [height, setHeight] = React.useState(defaultHeight);

  React.useEffect(() => {
    const updateHeight = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        const available = window.innerHeight - rect.top - 20; // 20px padding
        setHeight(Math.max(200, available));
      }
    };

    updateHeight();
    window.addEventListener('resize', updateHeight);
    
    // Observer for container size changes
    let observer: ResizeObserver | null = null;
    if (containerRef.current && typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(updateHeight);
      observer.observe(containerRef.current);
    }

    return () => {
      window.removeEventListener('resize', updateHeight);
      if (observer) observer.disconnect();
    };
  }, [containerRef, defaultHeight]);

  return height;
}
