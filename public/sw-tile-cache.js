// Service Worker para cache de tiles de OpenStreetMap
// Mejora dramática de performance y reduce uso de CPU/Network

const CACHE_NAME = 'osm-tiles-v2'; // v2: fix blank-tile caching at high zoom
const TILE_CACHE_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 días en milisegundos

self.addEventListener('install', (event) => {
  console.log('🔧 [Tile Cache SW] Instalando service worker...');
  // Activar inmediatamente sin esperar
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('🔧 [Tile Cache SW] Activando service worker...');
  
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => {
            console.log(`🗑️ [Tile Cache SW] Eliminando cache antigua: ${name}`);
            return caches.delete(name);
          })
      );
    }).then(() => {
      // Tomar control de todas las páginas inmediatamente
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  // Solo cachear tiles de OpenStreetMap
  if (url.hostname.includes('openstreetmap.org') || 
      url.hostname.includes('tile.openstreetmap.org') ||
      url.pathname.match(/\/\d+\/\d+\/\d+\.png$/)) {
    
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) => {
        return cache.match(event.request).then((cachedResponse) => {
          
          // Si existe en cache, verificar si expiró
          if (cachedResponse) {
            const cachedDate = new Date(cachedResponse.headers.get('date') || 0);
            const now = new Date();
            const age = now - cachedDate;
            
            // Si el tile no expiró, usarlo
            if (age < TILE_CACHE_MAX_AGE) {
              console.log('✅ [Tile Cache] Desde cache:', url.pathname);
              return cachedResponse;
            } else {
              console.log('⏰ [Tile Cache] Expirado, re-descargando:', url.pathname);
            }
          }
          
          // Si no hay cache o expiró, descargar desde red
          return fetch(event.request).then((response) => {
            // Solo cachear respuestas exitosas y con tamaño razonable
            // (OSM puede devolver 200 + tile vacío/transparente ~35-200 bytes para zooms sin datos)
            if (response.status === 200) {
              const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
              // No cachear tiles muy pequeños (stub transparente = ~35 bytes, tile real > 1KB)
              if (contentLength === 0 || contentLength > 500) {
                console.log('💾 [Tile Cache] Cacheando tile:', url.pathname, `(${contentLength} bytes)`);
                cache.put(event.request, response.clone());
              } else {
                console.warn('⚠️ [Tile Cache] Tile sospechosamente pequeño, no se cachea:', url.pathname, `(${contentLength} bytes)`);
              }
            }
            return response;
          }).catch((error) => {
            console.error('❌ [Tile Cache] Error de red:', error);
            
            // Si falla la red, usar cache aunque esté expirado (modo offline)
            if (cachedResponse) {
              console.log('🔄 [Tile Cache] Usando cache expirado (modo offline):', url.pathname);
              return cachedResponse;
            }
            
            // Si no hay cache en absoluto, retornar error
            return new Response('Tile no disponible offline', {
              status: 503,
              statusText: 'Service Unavailable',
              headers: { 'Content-Type': 'text/plain' }
            });
          });
        });
      })
    );
  } else {
    // Para otros recursos, pasar directo sin cachear
    return;
  }
});

// Mensajes del cliente (para debugging)
self.addEventListener('message', (event) => {
  if (event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  
  if (event.data.type === 'CLEAR_CACHE') {
    event.waitUntil(
      caches.delete(CACHE_NAME).then(() => {
        console.log('🗑️ [Tile Cache] Cache limpiado manualmente');
        event.ports[0].postMessage({ success: true });
      })
    );
  }
  
  if (event.data.type === 'CACHE_STATUS') {
    event.waitUntil(
      caches.open(CACHE_NAME).then((cache) => {
        return cache.keys().then((keys) => {
          event.ports[0].postMessage({
            cacheSize: keys.length,
            cacheName: CACHE_NAME
          });
        });
      })
    );
  }
});
