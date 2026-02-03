/**
 * 🛡️ UTILIDADES DE VALIDACIÓN CON ZOD
 * 
 * Este archivo contiene schemas de validación para proteger
 * los endpoints de la aplicación contra datos malformados o maliciosos.
 */

import { z } from 'zod';
import { NextResponse } from 'next/server';

/**
 * =====================================
 * SCHEMAS DE VALIDACIÓN COMUNES
 * =====================================
 */

/**
 * ID numérico positivo (usado para movil_id, pedido_id, etc.)
 */
export const numericIdSchema = z
  .string()
  .regex(/^\d+$/, 'Debe ser un número válido')
  .transform(Number)
  .refine((n) => n > 0, 'Debe ser mayor a 0');

/**
 * ID de móvil
 */
export const movilIdSchema = numericIdSchema;

/**
 * ID de pedido
 */
export const pedidoIdSchema = numericIdSchema;

/**
 * ID de escenario
 */
export const escenarioIdSchema = numericIdSchema;

/**
 * Límite de resultados (máximo 1000)
 */
export const limitSchema = z
  .string()
  .optional()
  .default('100')
  .pipe(
    z
      .string()
      .regex(/^\d+$/, 'El límite debe ser un número')
      .transform(Number)
      .refine((n) => n > 0 && n <= 1000, 'El límite debe estar entre 1 y 1000')
  );

/**
 * Página de paginación (debe ser >= 1)
 */
export const pageSchema = z
  .string()
  .optional()
  .default('1')
  .pipe(
    z
      .string()
      .regex(/^\d+$/, 'La página debe ser un número')
      .transform(Number)
      .refine((n) => n >= 1, 'La página debe ser >= 1')
  );

/**
 * Fecha en formato YYYY-MM-DD
 */
export const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha debe estar en formato YYYY-MM-DD')
  .refine((date) => {
    const parsed = new Date(date);
    return !isNaN(parsed.getTime());
  }, 'Fecha inválida');

/**
 * Fecha opcional
 */
export const optionalDateSchema = dateSchema.optional();

/**
 * Coordenadas geográficas (latitud)
 */
export const latitudeSchema = z
  .number()
  .min(-90, 'Latitud debe estar entre -90 y 90')
  .max(90, 'Latitud debe estar entre -90 y 90');

/**
 * Coordenadas geográficas (longitud)
 */
export const longitudeSchema = z
  .number()
  .min(-180, 'Longitud debe estar entre -180 y 180')
  .max(180, 'Longitud debe estar entre -180 y 180');

/**
 * Boolean desde string
 */
export const booleanStringSchema = z
  .string()
  .transform((val) => val === 'true')
  .pipe(z.boolean());

/**
 * Email válido
 */
export const emailSchema = z.string().email('Email inválido');

/**
 * =====================================
 * SCHEMAS PARA ENDPOINTS ESPECÍFICOS
 * =====================================
 */

/**
 * Parámetros para GET /api/coordinates
 */
export const coordinatesQuerySchema = z.object({
  movilId: movilIdSchema,
  limit: limitSchema.optional(),
});

/**
 * Parámetros para GET /api/pedidos
 */
export const pedidosQuerySchema = z.object({
  escenario: escenarioIdSchema.optional(),
  movil: movilIdSchema.optional(),
  estado: numericIdSchema.optional(),
  fecha: dateSchema.optional(),
  empresa_fletera_id: numericIdSchema.optional(),
  conCoordenadas: booleanStringSchema.optional(),
});

/**
 * Parámetros para GET /api/empresas
 */
export const empresasQuerySchema = z.object({
  escenario_id: z.string().optional(),
});

/**
 * Body para POST /api/import/gps
 */
export const importGpsBodySchema = z.object({
  gps: z.union([
    z.array(
      z.object({
        movil: numericIdSchema.optional(),
        movil_id: numericIdSchema.optional(),
        latitud: latitudeSchema,
        longitud: longitudeSchema,
        velocidad: z.number().optional(),
        fecha_hora: z.string().optional(),
        timestamp_local: z.string().optional(),
        timestamp_utc: z.string().optional(),
        // Agregar más campos según sea necesario
      })
    ),
    z.object({
      movil: numericIdSchema.optional(),
      movil_id: numericIdSchema.optional(),
      latitud: latitudeSchema,
      longitud: longitudeSchema,
      velocidad: z.number().optional(),
      fecha_hora: z.string().optional(),
      timestamp_local: z.string().optional(),
      timestamp_utc: z.string().optional(),
    }),
  ]),
});

/**
 * Body para POST /api/import/moviles
 */
export const importMovilesBodySchema = z.object({
  moviles: z.union([
    z.array(
      z.object({
        id: z.union([z.string(), z.number()]).optional(),
        Nro: z.number().optional(),
        nro: z.number().optional(),
        Descripcion: z.string().optional(),
        descripcion: z.string().optional(),
        Matricula: z.string().optional(),
        matricula: z.string().optional(),
        // Agregar más campos según sea necesario
      })
    ),
    z.object({
      id: z.union([z.string(), z.number()]).optional(),
      Nro: z.number().optional(),
      nro: z.number().optional(),
      Descripcion: z.string().optional(),
      descripcion: z.string().optional(),
      Matricula: z.string().optional(),
      matricula: z.string().optional(),
    }),
  ]),
});

/**
 * Body para POST /api/puntos-interes
 */
export const puntosInteresBodySchema = z.object({
  nombre: z.string().min(1, 'Nombre es requerido').max(200, 'Nombre muy largo'),
  descripcion: z.string().max(1000, 'Descripción muy larga').optional(),
  latitud: latitudeSchema,
  longitud: longitudeSchema,
  icono: z.string().max(50).optional(),
  color: z.string().max(20).optional(),
  usuario_email: emailSchema,
});

/**
 * =====================================
 * FUNCIÓN DE VALIDACIÓN GENÉRICA
 * =====================================
 */

/**
 * Valida datos contra un schema de Zod
 * 
 * @example
 * ```typescript
 * const result = validateInput(movilIdSchema, searchParams.get('movilId'));
 * if (result.success) {
 *   const movilId = result.data;
 * } else {
 *   return NextResponse.json(result.error, { status: 400 });
 * }
 * ```
 */
export function validateInput<T>(
  schema: z.ZodSchema<T>,
  data: unknown
): { success: true; data: T } | { success: false; error: NextResponse } {
  const result = schema.safeParse(data);

  if (!result.success) {
    const errors = result.error.issues.map((err: any) => ({
      field: err.path.join('.'),
      message: err.message,
    }));

    console.warn('⚠️  Validación fallida:', errors);

    return {
      success: false,
      error: NextResponse.json(
        {
          success: false,
          error: 'Datos de entrada inválidos',
          message: 'Los datos proporcionados no cumplen con el formato requerido',
          code: 'VALIDATION_ERROR',
          details: errors,
        },
        { status: 400 }
      ),
    };
  }

  return {
    success: true,
    data: result.data,
  };
}

/**
 * Valida query parameters de un request
 * 
 * @example
 * ```typescript
 * const result = validateQueryParams(request, coordinatesQuerySchema);
 * if (!result.success) return result.error;
 * 
 * const { movilId, limit } = result.data;
 * ```
 */
export function validateQueryParams<T>(
  request: Request,
  schema: z.ZodSchema<T>
): { success: true; data: T } | { success: false; error: NextResponse } {
  const url = new URL(request.url);
  const params = Object.fromEntries(url.searchParams.entries());

  return validateInput(schema, params);
}

/**
 * Valida el body JSON de un request
 * 
 * @example
 * ```typescript
 * const result = await validateBody(request, importGpsBodySchema);
 * if (!result.success) return result.error;
 * 
 * const { gps } = result.data;
 * ```
 */
export async function validateBody<T>(
  request: Request,
  schema: z.ZodSchema<T>
): Promise<{ success: true; data: T } | { success: false; error: NextResponse }> {
  try {
    const body = await request.json();
    return validateInput(schema, body);
  } catch (error) {
    console.error('❌ Error al parsear JSON:', error);
    return {
      success: false,
      error: NextResponse.json(
        {
          success: false,
          error: 'JSON inválido',
          message: 'El cuerpo de la petición no es un JSON válido',
          code: 'INVALID_JSON',
        },
        { status: 400 }
      ),
    };
  }
}

/**
 * =====================================
 * SANITIZACIÓN DE DATOS
 * =====================================
 */

/**
 * Sanitiza un string para prevenir XSS
 */
export function sanitizeString(str: string): string {
  return str
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}

/**
 * Sanitiza un objeto recursivamente
 */
export function sanitizeObject(obj: any): any {
  if (typeof obj === 'string') {
    return sanitizeString(obj);
  }

  if (Array.isArray(obj)) {
    return obj.map(sanitizeObject);
  }

  if (obj !== null && typeof obj === 'object') {
    const sanitized: any = {};
    for (const key in obj) {
      sanitized[key] = sanitizeObject(obj[key]);
    }
    return sanitized;
  }

  return obj;
}

/**
 * =====================================
 * HELPERS DE VALIDACIÓN
 * =====================================
 */

/**
 * Verifica si un valor es un número positivo
 */
export function isPositiveNumber(value: any): boolean {
  const num = Number(value);
  return !isNaN(num) && num > 0;
}

/**
 * Verifica si una fecha es válida
 */
export function isValidDate(dateString: string): boolean {
  const date = new Date(dateString);
  return !isNaN(date.getTime());
}

/**
 * Verifica si una coordenada es válida
 */
export function isValidCoordinate(lat: number, lng: number): boolean {
  return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}
