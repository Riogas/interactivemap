// Configuración de cache para tiles de OpenStreetMap
// Mejora performance del mapa reduciendo requests HTTP y uso de CPU

/**
 * Configuración optimizada para TileLayer con cache agresivo
 */
export const configureTileCache = () => {
  return {
    // ✅ CACHE Y PERFORMANCE
    maxZoom: 19, // Zoom máximo permitido
    maxNativeZoom: 18, // OSM solo provee tiles hasta zoom 18
    minZoom: 3, // Zoom mínimo
    
    // ✅ BUFFER Y MEMORIA
    keepBuffer: 4, // Mantener 4 "pantallas" de tiles en memoria (reduce re-fetching)
    updateWhenIdle: true, // Solo actualizar tiles cuando el usuario para de moverse
    updateInterval: 200, // Mínimo 200ms entre actualizaciones de tiles
    
    // ✅ HTTP Y CORS
    crossOrigin: true, // Permitir cache HTTP correcto
    
    // ✅ RETINA Y CALIDAD
    detectRetina: true, // Detectar pantallas de alta densidad
    
    // ✅ ATRIBUCIÓN
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    
    // ✅ OPCIONES DE TILE
    tileSize: 256, // Tamaño estándar de tiles OSM
    noWrap: false, // Permitir wrap horizontal (mapa infinito)
    bounds: undefined, // Sin límites geográficos
    
    // ✅ ERROR HANDLING
    errorTileUrl: '', // Tile transparente si falla la carga
  };
};

/**
 * Registrar Service Worker para cache persistente de tiles
 */
export const registerTileCacheServiceWorker = () => {
  // Solo en producción y si el navegador lo soporta
  if (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator && 
    'caches' in window &&
    process.env.NODE_ENV === 'production'
  ) {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('/sw-tile-cache.js')
        .then((registration) => {
          console.log('✅ [Tile Cache] Service Worker registrado:', registration.scope);
          
          // Escuchar actualizaciones del SW
          registration.addEventListener('updatefound', () => {
            const newWorker = registration.installing;
            console.log('🔄 [Tile Cache] Nueva versión del SW detectada');
            
            newWorker?.addEventListener('statechange', () => {
              if (newWorker.state === 'activated') {
                console.log('✅ [Tile Cache] Nueva versión activada');
              }
            });
          });
        })
        .catch((error) => {
          console.warn('⚠️ [Tile Cache] Error registrando SW:', error);
        });
    });
  } else {
    console.log('ℹ️ [Tile Cache] Service Worker no disponible o en desarrollo');
  }
};

/**
 * Obtener estadísticas del cache de tiles
 */
export const getTileCacheStats = async (): Promise<{
  cacheSize: number;
  cacheName: string;
} | null> => {
  if (!('serviceWorker' in navigator) || !navigator.serviceWorker.controller) {
    return null;
  }

  return new Promise((resolve) => {
    const messageChannel = new MessageChannel();
    const controller = navigator.serviceWorker.controller;
    
    if (!controller) {
      resolve(null);
      return;
    }
    
    messageChannel.port1.onmessage = (event) => {
      resolve(event.data);
    };
    
    controller.postMessage(
      { type: 'CACHE_STATUS' },
      [messageChannel.port2]
    );
    
    // Timeout después de 2 segundos
    setTimeout(() => resolve(null), 2000);
  });
};

/**
 * Limpiar cache de tiles manualmente
 */
export const clearTileCache = async (): Promise<boolean> => {
  if (!('serviceWorker' in navigator) || !navigator.serviceWorker.controller) {
    return false;
  }

  return new Promise((resolve) => {
    const messageChannel = new MessageChannel();
    const controller = navigator.serviceWorker.controller;
    
    if (!controller) {
      resolve(false);
      return;
    }
    
    messageChannel.port1.onmessage = (event) => {
      resolve(event.data.success || false);
    };
    
    controller.postMessage(
      { type: 'CLEAR_CACHE' },
      [messageChannel.port2]
    );
    
    // Timeout después de 5 segundos
    setTimeout(() => resolve(false), 5000);
  });
};

/**
 * Hook de React para monitorear cache de tiles
 */
export const useTileCacheMonitor = () => {
  const [cacheStats, setCacheStats] = React.useState<{
    cacheSize: number;
    cacheName: string;
  } | null>(null);

  React.useEffect(() => {
    const updateStats = async () => {
      const stats = await getTileCacheStats();
      setCacheStats(stats);
    };

    updateStats();
    
    // Actualizar cada 30 segundos
    const interval = setInterval(updateStats, 30000);
    
    return () => clearInterval(interval);
  }, []);

  return cacheStats;
};

// Re-exportar React para el hook
import React from 'react';
