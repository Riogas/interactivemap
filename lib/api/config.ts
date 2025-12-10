/**
 * Configuración de la API externa
 * 
 * Para cambiar la URL de la API, edita EXTERNAL_API_URL en .env.production
 * y el cambio se aplicará a todos los proxies automáticamente.
 */

// URL de la API externa (desde variable de entorno o fallback)
export const API_BASE_URL = 
  process.env.EXTERNAL_API_URL || 
  process.env.NEXT_PUBLIC_EXTERNAL_API_URL || 
  'http://localhost:8000';

// URL del proxy (para uso en el cliente/browser)
export const PROXY_BASE_URL = '/api/proxy';

/**
 * En producción, puedes usar variables de entorno:
 * 
 * .env.local:
 * API_BASE_URL=http://192.168.1.72:8082
 * 
 * Luego usar:
 * export const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:8082';
 */
