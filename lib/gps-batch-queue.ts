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
 * - ✅ Fallback a archivo si falla después de 3 reintentos
 * - ✅ Auto-creación de móviles si no existen (FK constraint)
 * 
 * Rendimiento estimado con 100 móviles:
 * - 100 coords/segundo → 500 coords cada 5s → 5 batches de 100/minuto
 * - Reducción de carga: 6,000 requests/min → 60 requests/min (99% reducción)
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
  private isProcessing: boolean = false;
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
          .from('gps_tracking_history')
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
        const isForeignKey = error.message.includes('violates foreign key constraint') && error.message.includes('fk_gps_movil');
        
        if (isTimeout) {
          console.error(`   ⏱️ TIMEOUT: Supabase no respondió en 15 segundos`);
        } else if (isNetwork) {
          console.error(`   🌐 ERROR DE RED: No se pudo conectar a Supabase`);
        } else if (isForeignKey) {
          console.error(`   🔗 ERROR DE FK: Móvil no existe en base de datos`);
          
          // Intentar crear los móviles faltantes
          const missingMoviles = await this.createMissingMoviles(batch);
          if (missingMoviles.length > 0) {
            console.log(`   ✅ Creados ${missingMoviles.length} móviles nuevos`);
            // Forzar un reintento adicional después de crear los móviles
            if (attempt === this.MAX_RETRIES) {
              console.log(`   🔄 Permitiendo un reintento adicional después de crear móviles`);
              attempt--; // Decrementar para permitir un reintento más
            }
          }
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
   * Crear móviles faltantes usando el endpoint de importación
   */
  private async createMissingMoviles(batch: GPSRecord[]): Promise<string[]> {
    try {
      // Obtener IDs únicos de móviles en el batch
      const movilIds = [...new Set(batch.map(record => record.movil_id))];
      console.log(`🔍 Verificando ${movilIds.length} móviles únicos...`);
      
      // Verificar cuáles NO existen en Supabase
      const { data: existingMoviles } = await supabase
        .from('moviles')
        .select('movil_id')
        .in('movil_id', movilIds);
      
      const existingIds = new Set(existingMoviles?.map(m => m.movil_id) || []);
      const missingIds = movilIds.filter(id => !existingIds.has(id));
      
      if (missingIds.length === 0) {
        console.log(`   ✅ Todos los móviles ya existen`);
        return [];
      }
      
      console.log(`   ⚠️ Móviles faltantes: ${missingIds.join(', ')}`);
      console.log(`   🔄 Creando móviles vía endpoint de importación...`);
      
      // Crear cada móvil faltante usando el endpoint interno
      const createdMoviles: string[] = [];
      
      for (const movilId of missingIds) {
        try {
          console.log(`   📤 Creando móvil ${movilId}...`);
          
          // Llamar al endpoint interno de importación
          const response = await fetch('http://localhost:3002/api/import/moviles', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
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
          console.log(`   ✅ Móvil ${movilId} creado:`, result);
          
          // Esperar un momento para que se propague a Supabase
          await new Promise(resolve => setTimeout(resolve, 500));
          
          // Verificar que el móvil ahora existe en Supabase
          const { data: verifyMovil } = await supabase
            .from('moviles')
            .select('movil_id')
            .eq('movil_id', movilId)
            .single();
          
          if (verifyMovil) {
            console.log(`   ✅ Móvil ${movilId} verificado en Supabase`);
            createdMoviles.push(movilId);
          } else {
            console.error(`   ⚠️ Móvil ${movilId} no encontrado en Supabase después de crear`);
          }
          
        } catch (error: any) {
          console.error(`   ❌ Error al crear móvil ${movilId}:`, error.message);
        }
      }
      
      if (createdMoviles.length > 0) {
        console.log(`   ✅ Total móviles creados y verificados: ${createdMoviles.join(', ')}`);
      }
      
      return createdMoviles;
      
    } catch (error: any) {
      console.error(`   ❌ Error en createMissingMoviles:`, error.message);
      return [];
    }
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
