/**
 * Fetch con timeout y reintentos configurables
 * Evita ConnectTimeoutError en conexiones lentas
 */

export interface FetchWithTimeoutOptions extends RequestInit {
  timeout?: number; // Timeout en milisegundos (default: 30000)
  retries?: number; // Número de reintentos (default: 2)
  retryDelay?: number; // Delay entre reintentos en ms (default: 1000)
}

/**
 * Ejecuta un fetch con timeout y reintentos automáticos
 * 
 * @param url - URL a la que hacer fetch
 * @param options - Opciones de fetch + timeout/retries
 * @returns Promise<Response>
 * 
 * @example
 * ```ts
 * const response = await fetchWithTimeout('https://api.example.com/data', {
 *   method: 'POST',
 *   headers: { 'Content-Type': 'application/json' },
 *   body: JSON.stringify({ foo: 'bar' }),
 *   timeout: 30000, // 30 segundos
 *   retries: 3, // 3 reintentos
 * });
 * ```
 */
export async function fetchWithTimeout(
  url: string,
  options: FetchWithTimeoutOptions = {}
): Promise<Response> {
  const {
    timeout = 30000, // 30 segundos por defecto
    retries = 2, // 2 reintentos por defecto
    retryDelay = 1000, // 1 segundo entre reintentos
    ...fetchOptions
  } = options;

  let lastError: Error | null = null;
  
  // Intentar fetch con reintentos
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      console.log(`🌐 Fetch attempt ${attempt + 1}/${retries + 1} to ${url}`);
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(url, {
        ...fetchOptions,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      
      console.log(`✅ Fetch successful (${response.status}) after ${attempt + 1} attempt(s)`);
      return response;
      
    } catch (error: any) {
      lastError = error;
      
      const isTimeout = 
        error.name === 'AbortError' ||
        error.message?.includes('timeout') ||
        error.message?.includes('Timeout') ||
        error.cause?.code === 'UND_ERR_CONNECT_TIMEOUT';

      console.error(`❌ Fetch attempt ${attempt + 1} failed:`, {
        error: error.message,
        isTimeout,
        willRetry: attempt < retries,
      });

      // Si no quedan más reintentos, lanzar el error
      if (attempt >= retries) {
        console.error(`❌ All ${retries + 1} fetch attempts failed for ${url}`);
        throw new Error(
          `Fetch failed after ${retries + 1} attempts: ${error.message}`,
          { cause: error }
        );
      }

      // Esperar antes de reintentar (exponential backoff)
      const delay = retryDelay * Math.pow(2, attempt);
      console.log(`⏳ Waiting ${delay}ms before retry...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  // Esto nunca debería ejecutarse, pero TypeScript lo requiere
  throw lastError || new Error('Fetch failed for unknown reason');
}

/**
 * Helper: Fetch con timeout predeterminado de 30s para APIs externas lentas
 */
export async function fetchExternalAPI(
  url: string,
  options: FetchWithTimeoutOptions = {}
): Promise<Response> {
  return fetchWithTimeout(url, {
    timeout: 30000, // 30s para APIs externas
    retries: 2, // 2 reintentos
    retryDelay: 1500, // 1.5s entre reintentos
    ...options,
  });
}

/**
 * Helper: Fetch con timeout predeterminado de 60s para operaciones lentas (importación, procesamiento)
 */
export async function fetchSlowOperation(
  url: string,
  options: FetchWithTimeoutOptions = {}
): Promise<Response> {
  return fetchWithTimeout(url, {
    timeout: 60000, // 60s para operaciones lentas
    retries: 1, // 1 reintento
    retryDelay: 2000, // 2s entre reintentos
    ...options,
  });
}
