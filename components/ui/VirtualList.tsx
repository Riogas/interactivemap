'use client';

import React, { useCallback, memo } from 'react';
import { List } from 'react-window';

/**
 * 🚀 VIRTUAL SCROLLING LIST
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

// Row renderer wrapper
const RowRenderer = memo(function RowRenderer({ 
  data, 
  index, 
  style 
}: {
  data: { items: any[]; renderItem: (item: any, index: number) => React.ReactNode };
  index: number;
  style: React.CSSProperties;
}) {
  const { items, renderItem } = data;
  return (
    <div style={style}>
      {renderItem(items[index], index)}
    </div>
  );
});

export function VirtualList<T>({
  items,
  height,
  itemHeight,
  renderItem,
  className = '',
  overscanCount = 5,
}: VirtualListProps<T>) {
  const itemData = { items, renderItem };

  if (items.length === 0) {
    return null;
  }

  // Si hay pocos items (<30), no usar virtualización (overhead innecesario)
  if (items.length < 30) {
    return (
      <div className={className} style={{ maxHeight: height, overflowY: 'auto' }}>
        {items.map((item, index) => (
          <div key={index}>
            {renderItem(item, index)}
          </div>
        ))}
      </div>
    );
  }

  return (
    <List
      height={height}
      itemCount={items.length}
      itemSize={itemHeight}
      width="100%"
      className={className}
      overscanCount={overscanCount}
      itemData={itemData}
    >
      {RowRenderer}
    </List>
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
