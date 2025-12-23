import { NextResponse } from 'next/server';

/**
 * Interfaz estándar de respuesta API
 */
export interface ApiResponse<T = any> {
  success: boolean;
  message: string;
  data?: T;
  error?: string;
  details?: any;
  timestamp: string;
  statusCode: number;
}

/**
 * Crea una respuesta exitosa estandarizada
 */
export function successResponse<T>(
  data: T,
  message: string = 'Operación exitosa',
  statusCode: number = 200
): NextResponse<ApiResponse<T>> {
  const response: ApiResponse<T> = {
    success: true,
    message,
    data,
    timestamp: new Date().toISOString(),
    statusCode,
  };

  console.log(`\n${'✅'.repeat(40)}`);
  console.log(`✅ RESPUESTA EXITOSA [${statusCode}]`);
  console.log(`${'✅'.repeat(40)}`);
  console.log('📤 Enviando respuesta:');
  console.log('  - Status Code:', statusCode);
  console.log('  - Success:', true);
  console.log('  - Message:', message);
  console.log('  - Data keys:', data ? Object.keys(data as any) : 'null');
  console.log('  - Timestamp:', response.timestamp);
  console.log('  - Content-Type: application/json');
  console.log(`${'✅'.repeat(40)}\n`);

  return NextResponse.json(response, { 
    status: statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'X-Response-Time': response.timestamp,
    }
  });
}

/**
 * Crea una respuesta de error estandarizada
 */
export function errorResponse(
  error: string,
  statusCode: number = 500,
  details?: any
): NextResponse<ApiResponse> {
  const response: ApiResponse = {
    success: false,
    message: getStatusMessage(statusCode),
    error,
    details: details?.message || details,
    timestamp: new Date().toISOString(),
    statusCode,
  };

  console.log(`\n${'❌'.repeat(40)}`);
  console.error(`❌ RESPUESTA DE ERROR [${statusCode}]`);
  console.log(`${'❌'.repeat(40)}`);
  console.error('📤 Enviando error:');
  console.error('  - Status Code:', statusCode);
  console.error('  - Success:', false);
  console.error('  - Error:', error);
  console.error('  - Message:', response.message);
  if (details) {
    console.error('  - Details:', typeof details === 'object' ? JSON.stringify(details, null, 2) : details);
  }
  console.error('  - Timestamp:', response.timestamp);
  console.log(`${'❌'.repeat(40)}\n`);

  return NextResponse.json(response, { 
    status: statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'X-Response-Time': response.timestamp,
    }
  });
}

/**
 * Obtiene el mensaje estándar según el código de estado
 */
function getStatusMessage(statusCode: number): string {
  const messages: Record<number, string> = {
    200: 'OK',
    201: 'Creado exitosamente',
    400: 'Solicitud incorrecta',
    401: 'No autorizado',
    403: 'Prohibido',
    404: 'No encontrado',
    409: 'Conflicto',
    422: 'Entidad no procesable',
    500: 'Error interno del servidor',
    503: 'Servicio no disponible',
  };
  return messages[statusCode] || 'Error desconocido';
}

/**
 * Wrapper para manejar errores en API routes
 */
export async function handleApiRequest<T>(
  handler: () => Promise<T>,
  successMessage?: string
): Promise<NextResponse<ApiResponse<T>>> {
  try {
    const data = await handler();
    return successResponse(data, successMessage);
  } catch (error: any) {
    // Error de validación (Zod, Joi, etc)
    if (error.name === 'ValidationError' || error.name === 'ZodError') {
      return errorResponse(
        'Error de validación',
        400,
        error.errors || error.message
      );
    }

    // Error de base de datos (Supabase)
    if (error.code) {
      return errorResponse(
        'Error de base de datos',
        500,
        { code: error.code, message: error.message }
      );
    }

    // Error genérico
    return errorResponse(
      error.message || 'Error inesperado',
      500,
      error.stack
    );
  }
}

/**
 * Valida que el body tenga los campos requeridos
 */
export function validateRequiredFields(
  body: any,
  requiredFields: string[]
): { valid: boolean; missingFields?: string[] } {
  const missingFields = requiredFields.filter(field => !(field in body));
  
  if (missingFields.length > 0) {
    return { valid: false, missingFields };
  }
  
  return { valid: true };
}

/**
 * Log estructurado para debugging
 */
export function logRequest(method: string, path: string, body?: any) {
  const timestamp = new Date().toISOString();
  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🌐 API REQUEST [${timestamp}]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Method: ${method}
Path: ${path}
${body ? `Body: ${JSON.stringify(body, null, 2)}` : 'No body'}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  `);
}
