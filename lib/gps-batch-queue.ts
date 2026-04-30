/**
 * 🔄 GPS Batch Queue System
 * 
 * Sistema de cola para inserción de coordenadas GPS en lotes.
 * Reduce la carga a Supabase agrupando múltiples inserciones en una sola operación.
 * Optimizado para 100+ móviles enviando coordenadas simultáneamente.
 * 
 * Características:
 * - ✅ Acumula coordenadas en memoria
 * - ✅ Flush automático cada 5 segundos o 100 registros (optimizado para alta carga)
 * - ✅ Retry automático con exponential backoff
 * - ✅ Evita sobrecarga de Supabase
 * - ✅ Logging detallado para debugging
 * - ✅ Timeout de 15 segundos en requests a Supabase
 * - ✅ Auto-creación de móviles si no existen (FK constraint)
 * 
 * Rendimiento estimado con 100 móviles:
 * - 100 coords/segundo → 500 coords cada 5s → 5 batches de 100/minuto
 * - Reducción de carga: 6,000 requests/min → 60 requests/min (99% reducción)
 */

import { createClient } from '@supabase/supabase-js';
import { gpsLog } from '@/lib/debug-config';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Cliente con timeout configurado
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  global: {
    fetch: (url, options = {}) => {
      return fetch(url, {
        ...options,
        signal: AbortSignal.timeout(15000), // 15 segundos timeout
      });
    },
  },
});

interface GPSRecord {
  movil_id: string;
  pedido_id: string | null;
  escenario_id: string | null;
  device_id: string | null;
  usuario: string | null;
  latitud: number;
  longitud: number;
  utm_x: number | null;
  utm_y: number | null;
  accuracy: number | null;
  altitude: number | null;
  bearing: number | null;
  provider: string | null;
  speed_accuracy: number | null;
  speed: number | null;
  vertical_accuracy: number | null;
  battery_level: number | null;
  is_charging: boolean | null;
  timestamp: string;
  timestamp_utc: string;
  [key: string]: any; // Para campos adicionales dinámicos
}

class GPSBatchQueue {
  private queue: GPSRecord[] = [];
  // flushPromise sirve como mutex atomico: si ya hay un flush en curso,
  // los callers reusan la misma Promise en lugar de iniciar uno paralelo.
  // Evita la race del booleano `isProcessing` previo, donde dos addBatch
  // concurrentes podian limpiar la cola entre medias y perder records.
  private flushPromise: Promise<void> | null = null;
  private flushTimer: NodeJS.Timeout | null = null;
  
  // Configuración
  private readonly BATCH_SIZE = 100;       // Flush cada 100 registros (aumentado para 100+ móviles)
  private readonly FLUSH_INTERVAL = 5000;  // Flush cada 5 segundos
  private readonly MAX_RETRIES = 3;        // 3 intentos máximo
  private readonly RETRY_DELAY = 2000;     // 2s entre reintentos

  constructor() {
    // Iniciar timer de flush automático
    this.startFlushTimer();
    
    // Cleanup al cerrar el proceso
    process.on('beforeExit', () => this.forceFlush());
    process.on('SIGINT', () => this.forceFlush());
    process.on('SIGTERM', () => this.forceFlush());
    
    gpsLog('🔄 GPS Batch Queue iniciado');
    gpsLog(`   - Batch size: ${this.BATCH_SIZE} registros`);
    gpsLog(`   - Flush interval: ${this.FLUSH_INTERVAL}ms`);
  }

  /**
   * Agregar un registro GPS a la cola
   */
  async add(record: GPSRecord): Promise<void> {
    this.queue.push(record);
    
    gpsLog(`📦 GPS agregado a cola (${this.queue.length}/${this.BATCH_SIZE})`);
    
    // Si alcanzamos el tamaño del batch, flush inmediato
    if (this.queue.length >= this.BATCH_SIZE) {
      gpsLog(`🚀 Batch size alcanzado (${this.BATCH_SIZE}), flush inmediato`);
      await this.flush();
    }
  }

  /**
   * Agregar múltiples registros GPS a la cola
   */
  async addBatch(records: GPSRecord[]): Promise<void> {
    this.queue.push(...records);
    
    gpsLog(`📦 ${records.length} GPS agregados a cola (${this.queue.length}/${this.BATCH_SIZE})`);
    
    // Si alcanzamos el tamaño del batch, flush inmediato
    if (this.queue.length >= this.BATCH_SIZE) {
      gpsLog(`🚀 Batch size alcanzado (${this.BATCH_SIZE}), flush inmediato`);
      await this.flush();
    }
  }

  /**
   * Procesar la cola e insertar en Supabase.
   *
   * Atomic: si ya hay un flush en curso, devuelve la misma Promise para
   * que los callers concurrentes esperen el mismo resultado en vez de
   * iniciar flushes paralelos (que perderian records al hacer `queue = []`).
   */
  private async flush(): Promise<void> {
    if (this.flushPromise) {
      return this.flushPromise;
    }
    this.flushPromise = this._doFlush().finally(() => {
      this.flushPromise = null;
    });
    return this.flushPromise;
  }

  /**
   * Implementacion real del flush. Solo se ejecuta una vez por ciclo
   * gracias al mutex flushPromise.
   *
   * En caso de error tras agotar los reintentos, re-encola los records
   * al frente de la cola y propaga la excepcion para que el caller
   * pueda decidir (en general, el siguiente flush los reintentara).
   */
  private async _doFlush(): Promise<void> {
    // Atomic: extraemos TODOS los records actuales y dejamos la cola
    // vacia. splice asegura que records insertados durante el flush
    // (a partir de aqui) NO se borren cuando termine.
    const batch = this.queue.splice(0, this.queue.length);
    if (batch.length === 0) {
      return;
    }

    gpsLog(`\n${'═'.repeat(80)}`);
    gpsLog(`🔄 INICIANDO FLUSH DE GPS BATCH`);
    gpsLog(`${'═'.repeat(80)}`);
    gpsLog(`📊 Registros a insertar: ${batch.length}`);
    gpsLog(`⏰ Timestamp: ${new Date().toISOString()}`);

    let attempt = 0;
    let success = false;
    let lastError: Error | null = null;

    while (attempt < this.MAX_RETRIES && !success) {
      attempt++;

      try {
        gpsLog(`\n🔧 Intento ${attempt}/${this.MAX_RETRIES}`);

        const startTime = Date.now();

        // Insertar en Supabase
        const { error } = await supabase
          .from('gps_tracking_history')
          .insert(batch);

        const duration = Date.now() - startTime;

        if (error) {
          throw new Error(`Supabase error: ${error.message}`);
        }

        success = true;

        gpsLog(`✅ Batch insertado exitosamente`);
        gpsLog(`   - Registros: ${batch.length}`);
        gpsLog(`   - Duración: ${duration}ms`);
        gpsLog(`   - Velocidad: ${(batch.length / (duration / 1000)).toFixed(2)} reg/s`);
        gpsLog(`${'═'.repeat(80)}\n`);

      } catch (error: unknown) {
        const err = error as { message?: string; name?: string; code?: string; cause?: unknown };
        lastError = error instanceof Error ? error : new Error(String(error));
        console.error(`❌ Error en intento ${attempt}/${this.MAX_RETRIES}:`);
        console.error(`   - Mensaje: ${err.message}`);
        console.error(`   - Tipo: ${err.name}`);
        console.error(`   - Código: ${err.code || 'N/A'}`);
        console.error(`   - Causa: ${err.cause || 'N/A'}`);

        // Detectar tipo de error
        const message = err.message ?? '';
        const isTimeout = err.name === 'AbortError' || message.includes('timeout');
        const isNetwork = message.includes('fetch failed') || message.includes('ECONNREFUSED');
        const isForeignKey = message.includes('violates foreign key constraint') && message.includes('fk_gps_movil');

        if (isTimeout) {
          console.error(`   ⏱️ TIMEOUT: Supabase no respondió en 15 segundos`);
        } else if (isNetwork) {
          console.error(`   🌐 ERROR DE RED: No se pudo conectar a Supabase`);
        } else if (isForeignKey) {
          console.error(`   🔗 ERROR DE FK: Móvil no existe en base de datos`);

          // Intentar crear los móviles faltantes
          const missingMoviles = await this.createMissingMoviles(batch);
          if (missingMoviles.length > 0) {
            gpsLog(`   ✅ Creados ${missingMoviles.length} móviles nuevos`);
            // Forzar un reintento adicional después de crear los móviles
            if (attempt === this.MAX_RETRIES) {
              gpsLog(`   🔄 Permitiendo un reintento adicional después de crear móviles`);
              attempt--; // Decrementar para permitir un reintento más
            }
          }
        }

        if (attempt < this.MAX_RETRIES) {
          const delay = this.RETRY_DELAY * Math.pow(2, attempt - 1); // Exponential backoff
          gpsLog(`⏳ Esperando ${delay}ms antes de reintentar...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          console.error(`💥 BATCH FALLIDO después de ${this.MAX_RETRIES} intentos`);
          console.error(`   - Registros: ${batch.length} re-encolados al frente`);
          console.error(`   - Error final:`, message);
        }
      }
    }

    if (!success) {
      // Re-encolar al frente para no perder records y propagar el error
      // para que el caller pueda decidir (typicamente el siguiente flush
      // por timer los reintentara).
      this.queue.unshift(...batch);
      throw lastError ?? new Error('GPS batch flush failed');
    }
  }

  /**
   * Forzar flush inmediato (usado al cerrar la app)
   */
  async forceFlush(): Promise<void> {
    if (this.queue.length > 0) {
      gpsLog(`\n🚨 Force flush: ${this.queue.length} registros pendientes`);
      await this.flush();
    }
  }

  /**
   * Iniciar timer de flush automático
   */
  private startFlushTimer(): void {
    this.flushTimer = setInterval(() => {
      if (this.queue.length > 0) {
        gpsLog(`⏰ Flush automático por timeout (${this.queue.length} registros)`);
        this.flush();
      }
    }, this.FLUSH_INTERVAL);
  }

  /**
   * Obtener estadísticas de la cola
   */
  getStats() {
    return {
      queueSize: this.queue.length,
      isProcessing: this.flushPromise !== null,
      batchSize: this.BATCH_SIZE,
      flushInterval: this.FLUSH_INTERVAL,
    };
  }

  /**
   * Crear móviles faltantes usando el endpoint de importación
   */
  private async createMissingMoviles(batch: GPSRecord[]): Promise<string[]> {
    try {
      // Obtener IDs únicos de móviles en el batch
      const movilIds = [...new Set(batch.map(record => record.movil_id))];
      gpsLog(`🔍 Verificando ${movilIds.length} móviles únicos...`);
      
      // Verificar cuáles NO existen en Supabase
      const { data: existingMoviles } = await supabase
        .from('moviles')
        .select('movil_id')
        .in('movil_id', movilIds);
      
      const existingIds = new Set(existingMoviles?.map(m => m.movil_id) || []);
      const missingIds = movilIds.filter(id => !existingIds.has(id));
      
      if (missingIds.length === 0) {
        gpsLog(`   ✅ Todos los móviles ya existen`);
        return [];
      }
      
      gpsLog(`   ⚠️ Móviles faltantes: ${missingIds.join(', ')}`);
      gpsLog(`   🔄 Creando móviles vía endpoint de importación...`);
      
      // Crear cada móvil faltante usando el endpoint interno
      const createdMoviles: string[] = [];
      
      // Base URL configurable: en prod no podemos asumir localhost:3002.
      // Cae a localhost:3000 (default Next dev) si no esta seteada.
      const baseUrl = process.env.APP_BASE_URL ?? 'http://localhost:3000';
      const internalApiKey = process.env.INTERNAL_API_KEY;

      for (const movilId of missingIds) {
        try {
          gpsLog(`   📤 Creando móvil ${movilId}...`);

          const headers: Record<string, string> = {
            'Content-Type': 'application/json',
          };
          // Solo enviamos x-api-key si la env esta seteada para no romper
          // setups locales sin auth interno.
          if (internalApiKey) {
            headers['x-api-key'] = internalApiKey;
          }

          // Llamar al endpoint interno de importación
          const response = await fetch(`${baseUrl}/api/import/moviles`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              EscenarioId: 1000,
              IdentificadorId: parseInt(movilId),
              Accion: 'Publicar',
              Entidad: 'Moviles',
              ProcesarEn: 1,
            }),
          });
          
          if (!response.ok) {
            const errorText = await response.text();
            console.error(`   ❌ Error al crear móvil ${movilId}: ${response.status} - ${errorText}`);
            continue;
          }
          
          const result = await response.json();
          gpsLog(`   ✅ Móvil ${movilId} creado:`, result);
          
          // Esperar un momento para que se propague a Supabase
          await new Promise(resolve => setTimeout(resolve, 500));
          
          // Verificar que el móvil ahora existe en Supabase
          const { data: verifyMovil } = await supabase
            .from('moviles')
            .select('movil_id')
            .eq('movil_id', movilId)
            .single();
          
          if (verifyMovil) {
            gpsLog(`   ✅ Móvil ${movilId} verificado en Supabase`);
            createdMoviles.push(movilId);
          } else {
            console.error(`   ⚠️ Móvil ${movilId} no encontrado en Supabase después de crear`);
          }
          
        } catch (error: any) {
          console.error(`   ❌ Error al crear móvil ${movilId}:`, error.message);
        }
      }
      
      if (createdMoviles.length > 0) {
        gpsLog(`   ✅ Total móviles creados y verificados: ${createdMoviles.join(', ')}`);
      }
      
      return createdMoviles;
      
    } catch (error: any) {
      console.error(`   ❌ Error en createMissingMoviles:`, error.message);
      return [];
    }
  }
}

// Singleton: una sola instancia global
let queueInstance: GPSBatchQueue | null = null;

export function getGPSQueue(): GPSBatchQueue {
  if (!queueInstance) {
    queueInstance = new GPSBatchQueue();
  }
  return queueInstance;
}

export type { GPSRecord };
