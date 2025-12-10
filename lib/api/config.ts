/**
 * Configuración de la API externa
 * 
 * Para cambiar la URL de la API, edita API_BASE_URL aquí
 * y el cambio se aplicará a todos los proxies automáticamente.
 */

// URL de la API externa (sin proxy, para uso en el servidor Next.js)
export const API_BASE_URL = 'http://192.168.1.72:8082';

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
