// Hook optimizado para throttling de actualizaciones en tiempo real
// Reduce CPU agrupando múltiples updates en batches con requestAnimationFrame

import { useState, useEffect, useRef } from 'react';

/**
 * Hook que agrupa actualizaciones usando requestAnimationFrame
 * Perfecto para datos que cambian frecuentemente (tiempo real)
 * 
 * @param items - Array de items que se actualizan frecuentemente
 * @returns Items actualizados en el próximo frame de animación
 */
export function useBatchedUpdates<T>(items: T[]): T[] {
  const [batchedItems, setBatchedItems] = useState<T[]>(items);
  const rafRef = useRef<number | undefined>(undefined);
  const pendingItems = useRef<T[]>(items);
  const lastUpdateTime = useRef<number>(Date.now());

  useEffect(() => {
    pendingItems.current = items;

    // Cancelar animationFrame anterior si existe
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
    }

    // Solo actualizar si pasó suficiente tiempo (throttle implícito)
    const now = Date.now();
    const timeSinceLastUpdate = now - lastUpdateTime.current;
    
    // 🚀 OPTIMIZADO: Con >50 items, usar throttle más agresivo (1s en vez de 500ms)
    const throttleMs = items.length > 50 ? 1000 : 500;
    
    if (timeSinceLastUpdate < throttleMs) {
      rafRef.current = requestAnimationFrame(() => {
        setBatchedItems(pendingItems.current);
        lastUpdateTime.current = Date.now();
      });
    } else {
      // Si pasó mucho tiempo, actualizar inmediatamente
      setBatchedItems(items);
      lastUpdateTime.current = now;
    }

    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [items]);

  return batchedItems;
}

/**
 * Hook para detectar si la pestaña está visible
 * Útil para pausar actualizaciones cuando el usuario no está viendo
 * 
 * @returns true si la pestaña está visible, false si está en background
 */
export function useTabVisibility(): boolean {
  const [isVisible, setIsVisible] = useState<boolean>(
    typeof document !== 'undefined' ? !document.hidden : true
  );

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    const handleVisibilityChange = () => {
      setIsVisible(!document.hidden);
      
      if (!document.hidden) {
        console.log('👁️ [Tab Visibility] Pestaña visible');
      } else {
        console.log('🙈 [Tab Visibility] Pestaña oculta');
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  return isVisible;
}

/**
 * Hook que throttlea actualizaciones solo si la pestaña está visible
 * Combina batching + visibility detection para máximo ahorro de CPU
 * 
 * @param items - Items a actualizar
 * @param enabled - Si false, siempre retorna los items sin throttling
 * @returns Items throttled o items originales según visibilidad
 */
export function useSmartBatchedUpdates<T>(
  items: T[],
  enabled: boolean = true
): T[] {
  const isTabVisible = useTabVisibility();
  const batchedItems = useBatchedUpdates(items);
  const [frozenItems, setFrozenItems] = useState<T[]>(items);

  useEffect(() => {
    if (!enabled) {
      // Sin throttling
      setFrozenItems(items);
      return;
    }

    if (isTabVisible) {
      // Tab visible: usar items batcheados
      setFrozenItems(batchedItems);
    }
    // Tab oculto: mantener último estado conocido (freeze)
  }, [items, batchedItems, isTabVisible, enabled]);

  return enabled ? frozenItems : items;
}

/**
 * Hook de throttle simple para funciones
 * Útil para eventos como scroll, resize, etc.
 * 
 * @param callback - Función a throttlear
 * @param delay - Delay en milisegundos (default: 500ms)
 * @returns Función throttleada
 */
export function useThrottle<T extends (...args: any[]) => any>(
  callback: T,
  delay: number = 500
): T {
  const lastRun = useRef<number>(Date.now());
  const timeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);

  const throttled = useRef((...args: Parameters<T>) => {
    const now = Date.now();
    const timeSinceLastRun = now - lastRun.current;

    // Cancelar timeout anterior
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    if (timeSinceLastRun >= delay) {
      // Si pasó suficiente tiempo, ejecutar inmediatamente
      lastRun.current = now;
      callback(...args);
    } else {
      // Si no, programar ejecución
      timeoutRef.current = setTimeout(() => {
        lastRun.current = Date.now();
        callback(...args);
      }, delay - timeSinceLastRun);
    }
  });

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return throttled.current as T;
}

/**
 * Hook para medir performance de renders
 * Útil para debugging y monitoreo
 * 
 * @param componentName - Nombre del componente a monitorear
 */
export function useRenderMonitor(componentName: string) {
  const renderCount = useRef(0);
  const lastRenderTime = useRef(Date.now());

  useEffect(() => {
    renderCount.current++;
    const now = Date.now();
    const timeSinceLastRender = now - lastRenderTime.current;
    
    console.log(
      `🔄 [Render Monitor] ${componentName} - ` +
      `Render #${renderCount.current} ` +
      `(${timeSinceLastRender}ms desde último render)`
    );
    
    lastRenderTime.current = now;
  });

  return {
    renderCount: renderCount.current,
    getAverageRenderTime: () => {
      if (renderCount.current === 0) return 0;
      return (Date.now() - lastRenderTime.current) / renderCount.current;
    }
  };
}
