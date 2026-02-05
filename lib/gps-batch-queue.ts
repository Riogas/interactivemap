/**
 * 🔄 GPS Batch Queue System
 * 
 * Sistema de cola para inserción de coordenadas GPS en lotes.
 * Reduce la carga a Supabase agrupando múltiples inserciones en una sola operación.
 * 
 * Características:
 * - ✅ Acumula coordenadas en memoria
 * - ✅ Flush automático cada 5 segundos o 50 registros
 * - ✅ Retry automático con exponential backoff
 * - ✅ Evita sobrecarga de Supabase
 * - ✅ Logging detallado para debugging
 * - ✅ Timeout de 15 segundos en requests a Supabase
 * - ✅ Fallback a archivo si falla después de 3 reintentos
 */

import { createClient } from '@supabase/supabase-js';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';

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
  escenario: string | null;
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
  private isProcessing: boolean = false;
  private flushTimer: NodeJS.Timeout | null = null;
  
  // Configuración
  private readonly BATCH_SIZE = 50;        // Flush cada 50 registros
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
    
    console.log('🔄 GPS Batch Queue iniciado');
    console.log(`   - Batch size: ${this.BATCH_SIZE} registros`);
    console.log(`   - Flush interval: ${this.FLUSH_INTERVAL}ms`);
  }

  /**
   * Agregar un registro GPS a la cola
   */
  async add(record: GPSRecord): Promise<void> {
    this.queue.push(record);
    
    console.log(`📦 GPS agregado a cola (${this.queue.length}/${this.BATCH_SIZE})`);
    
    // Si alcanzamos el tamaño del batch, flush inmediato
    if (this.queue.length >= this.BATCH_SIZE) {
      console.log(`🚀 Batch size alcanzado (${this.BATCH_SIZE}), flush inmediato`);
      await this.flush();
    }
  }

  /**
   * Agregar múltiples registros GPS a la cola
   */
  async addBatch(records: GPSRecord[]): Promise<void> {
    this.queue.push(...records);
    
    console.log(`📦 ${records.length} GPS agregados a cola (${this.queue.length}/${this.BATCH_SIZE})`);
    
    // Si alcanzamos el tamaño del batch, flush inmediato
    if (this.queue.length >= this.BATCH_SIZE) {
      console.log(`🚀 Batch size alcanzado (${this.BATCH_SIZE}), flush inmediato`);
      await this.flush();
    }
  }

  /**
   * Procesar la cola e insertar en Supabase
   */
  private async flush(): Promise<void> {
    // Si ya estamos procesando o la cola está vacía, salir
    if (this.isProcessing || this.queue.length === 0) {
      return;
    }

    this.isProcessing = true;
    
    // Tomar los registros a procesar y limpiar la cola
    const batch = [...this.queue];
    this.queue = [];
    
    console.log(`\n${'═'.repeat(80)}`);
    console.log(`🔄 INICIANDO FLUSH DE GPS BATCH`);
    console.log(`${'═'.repeat(80)}`);
    console.log(`📊 Registros a insertar: ${batch.length}`);
    console.log(`⏰ Timestamp: ${new Date().toISOString()}`);

    let attempt = 0;
    let success = false;

    while (attempt < this.MAX_RETRIES && !success) {
      attempt++;
      
      try {
        console.log(`\n🔧 Intento ${attempt}/${this.MAX_RETRIES}`);
        
        const startTime = Date.now();
        
        // Insertar en Supabase
        const { data, error } = await supabase
          .from('gps_tracking_extended')
          .insert(batch);

        const duration = Date.now() - startTime;

        if (error) {
          throw new Error(`Supabase error: ${error.message}`);
        }

        success = true;
        
        console.log(`✅ Batch insertado exitosamente`);
        console.log(`   - Registros: ${batch.length}`);
        console.log(`   - Duración: ${duration}ms`);
        console.log(`   - Velocidad: ${(batch.length / (duration / 1000)).toFixed(2)} reg/s`);
        console.log(`${'═'.repeat(80)}\n`);

      } catch (error: any) {
        console.error(`❌ Error en intento ${attempt}/${this.MAX_RETRIES}:`);
        console.error(`   - Mensaje: ${error.message}`);
        console.error(`   - Tipo: ${error.name}`);
        console.error(`   - Código: ${error.code || 'N/A'}`);
        console.error(`   - Causa: ${error.cause || 'N/A'}`);
        
        // Detectar tipo de error
        const isTimeout = error.name === 'AbortError' || error.message.includes('timeout');
        const isNetwork = error.message.includes('fetch failed') || error.message.includes('ECONNREFUSED');
        
        if (isTimeout) {
          console.error(`   ⏱️ TIMEOUT: Supabase no respondió en 15 segundos`);
        } else if (isNetwork) {
          console.error(`   🌐 ERROR DE RED: No se pudo conectar a Supabase`);
        }

        if (attempt < this.MAX_RETRIES) {
          const delay = this.RETRY_DELAY * Math.pow(2, attempt - 1); // Exponential backoff
          console.log(`⏳ Esperando ${delay}ms antes de reintentar...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          console.error(`💥 BATCH FALLIDO después de ${this.MAX_RETRIES} intentos`);
          console.error(`   - Registros perdidos: ${batch.length}`);
          console.error(`   - Error final:`, error.message);
          
          // Guardar en archivo para recuperación manual
          await this.saveFailedBatch(batch);
        }
      }
    }

    this.isProcessing = false;
  }

  /**
   * Forzar flush inmediato (usado al cerrar la app)
   */
  async forceFlush(): Promise<void> {
    if (this.queue.length > 0) {
      console.log(`\n🚨 Force flush: ${this.queue.length} registros pendientes`);
      await this.flush();
    }
  }

  /**
   * Iniciar timer de flush automático
   */
  private startFlushTimer(): void {
    this.flushTimer = setInterval(() => {
      if (this.queue.length > 0) {
        console.log(`⏰ Flush automático por timeout (${this.queue.length} registros)`);
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
      isProcessing: this.isProcessing,
      batchSize: this.BATCH_SIZE,
      flushInterval: this.FLUSH_INTERVAL,
    };
  }

  /**
   * Guardar batch fallido en archivo
   */
  private async saveFailedBatch(batch: GPSRecord[]): Promise<void> {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `failed-batch-${timestamp}.json`;
      
      // Crear directorio si no existe
      const failedDir = join(process.cwd(), 'failed-batches');
      await mkdir(failedDir, { recursive: true });
      
      const filepath = join(failedDir, filename);
      
      // Guardar batch con metadata
      const data = {
        timestamp: new Date().toISOString(),
        records: batch,
        count: batch.length,
        reason: 'Failed after 3 retry attempts',
      };
      
      await writeFile(filepath, JSON.stringify(data, null, 2));
      
      console.log(`💾 Batch guardado en: ${filepath}`);
      console.log(`   - Para recuperar: Importar manualmente a Supabase`);
    } catch (error: any) {
      console.error(`❌ Error al guardar batch fallido:`, error.message);
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
