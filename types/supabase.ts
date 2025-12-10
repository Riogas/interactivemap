// Tipos generados automáticamente basados en las tablas de Supabase

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      moviles: {
        Row: {
          id: string
          descripcion: string
          detalle_html: string | null
          distancia_max_mts_cump_pedidos: number | null
          empresa_fletera_id: number
          empresa_fletera_nom: string | null
          estado_desc: string | null
          estado_nro: number | null
          fch_hora_mov: string | null
          fch_hora_upd_firestore: string | null
          matricula: string | null
          mostrar_en_mapa: boolean | null
          nro: number | null
          obs: string | null
          pedidos_pendientes: number | null
          permite_baja_momentanea: boolean | null
          print_screen: boolean | null
          se_puede_activar_desde_la_app: boolean | null
          se_puede_desactivar_desde_la_app: boolean | null
          tamano_lote: number | null
          visible_en_app: boolean | null
          debug_mode: boolean | null
          gps_n8n: boolean | null
          grabar_pantalla: boolean | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id: string
          descripcion: string
          detalle_html?: string | null
          distancia_max_mts_cump_pedidos?: number | null
          empresa_fletera_id: number
          empresa_fletera_nom?: string | null
          estado_desc?: string | null
          estado_nro?: number | null
          fch_hora_mov?: string | null
          fch_hora_upd_firestore?: string | null
          matricula?: string | null
          mostrar_en_mapa?: boolean | null
          nro?: number | null
          obs?: string | null
          pedidos_pendientes?: number | null
          permite_baja_momentanea?: boolean | null
          print_screen?: boolean | null
          se_puede_activar_desde_la_app?: boolean | null
          se_puede_desactivar_desde_la_app?: boolean | null
          tamano_lote?: number | null
          visible_en_app?: boolean | null
          debug_mode?: boolean | null
          gps_n8n?: boolean | null
          grabar_pantalla?: boolean | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          descripcion?: string
          detalle_html?: string | null
          distancia_max_mts_cump_pedidos?: number | null
          empresa_fletera_id?: number
          empresa_fletera_nom?: string | null
          estado_desc?: string | null
          estado_nro?: number | null
          fch_hora_mov?: string | null
          fch_hora_upd_firestore?: string | null
          matricula?: string | null
          mostrar_en_mapa?: boolean | null
          nro?: number | null
          obs?: string | null
          pedidos_pendientes?: number | null
          permite_baja_momentanea?: boolean | null
          print_screen?: boolean | null
          se_puede_activar_desde_la_app?: boolean | null
          se_puede_desactivar_desde_la_app?: boolean | null
          tamano_lote?: number | null
          visible_en_app?: boolean | null
          debug_mode?: boolean | null
          gps_n8n?: boolean | null
          grabar_pantalla?: boolean | null
          created_at?: string | null
          updated_at?: string | null
        }
      }
      pedidos: {
        Row: {
          id: number
          escenario_id: number
          movil_id: number | null
          estado: number | null
          latitud: number | null
          longitud: number | null
          zona: number | null
          tipo: string | null
          nombre_servicio: string | null
          producto_codigo: string | null
          producto_nombre: string | null
          producto_cantidad: number | null
          producto_precio: number | null
          prioridad: number | null
          observacion: string | null
          importe_flete: number | null
          importe_bruto: number | null
          fecha_para: string | null
          fecha_hora_max_comp: string | null
          fecha_hora_para: string | null
          fecha_hora_asignado: string | null
          fecha_hora_cumplido: string | null
          cliente_nombre: string | null
          cliente_direccion: string | null
          cliente_nro: string | null
          cliente_telefono: string | null
          cliente_observacion: string | null
          aux1: string | null
          created_at: string | null
          updated_at: string | null
          empresa_fletera_id: number | null
        }
        Insert: {
          id: number
          escenario_id: number
          movil_id?: number | null
          estado?: number | null
          latitud?: number | null
          longitud?: number | null
          zona?: number | null
          tipo?: string | null
          nombre_servicio?: string | null
          producto_codigo?: string | null
          producto_nombre?: string | null
          producto_cantidad?: number | null
          producto_precio?: number | null
          prioridad?: number | null
          observacion?: string | null
          importe_flete?: number | null
          importe_bruto?: number | null
          fecha_para?: string | null
          fecha_hora_max_comp?: string | null
          fecha_hora_para?: string | null
          fecha_hora_asignado?: string | null
          fecha_hora_cumplido?: string | null
          cliente_nombre?: string | null
          cliente_direccion?: string | null
          cliente_nro?: string | null
          cliente_telefono?: string | null
          cliente_observacion?: string | null
          aux1?: string | null
          created_at?: string | null
          updated_at?: string | null
          empresa_fletera_id?: number | null
        }
        Update: {
          id?: number
          escenario_id?: number
          movil_id?: number | null
          estado?: number | null
          latitud?: number | null
          longitud?: number | null
          zona?: number | null
          tipo?: string | null
          nombre_servicio?: string | null
          producto_codigo?: string | null
          producto_nombre?: string | null
          producto_cantidad?: number | null
          producto_precio?: number | null
          prioridad?: number | null
          observacion?: string | null
          importe_flete?: number | null
          importe_bruto?: number | null
          fecha_para?: string | null
          fecha_hora_max_comp?: string | null
          fecha_hora_para?: string | null
          fecha_hora_asignado?: string | null
          fecha_hora_cumplido?: string | null
          cliente_nombre?: string | null
          cliente_direccion?: string | null
          cliente_nro?: string | null
          cliente_telefono?: string | null
          cliente_observacion?: string | null
          aux1?: string | null
          created_at?: string | null
          updated_at?: string | null
          empresa_fletera_id?: number | null
        }
      }
      empresas_fleteras: {
        Row: {
          empresa_fletera_id: number
          escenario_id: number
          nombre: string
          razon_social: string | null
          rut: string | null
          direccion: string | null
          telefono: string | null
          email: string | null
          contacto_nombre: string | null
          contacto_telefono: string | null
          estado: number | null
          observaciones: string | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          empresa_fletera_id?: number
          escenario_id: number
          nombre: string
          razon_social?: string | null
          rut?: string | null
          direccion?: string | null
          telefono?: string | null
          email?: string | null
          contacto_nombre?: string | null
          contacto_telefono?: string | null
          estado?: number | null
          observaciones?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          empresa_fletera_id?: number
          escenario_id?: number
          nombre?: string
          razon_social?: string | null
          rut?: string | null
          direccion?: string | null
          telefono?: string | null
          email?: string | null
          contacto_nombre?: string | null
          contacto_telefono?: string | null
          estado?: number | null
          observaciones?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
      }
      gps_tracking_extended: {
        Row: {
          id: number
          movil_id: string
          pedido_id: number | null
          device_id: string | null
          usuario: string | null
          escenario_id: number | null
          latitud: number
          longitud: number
          utm_x: number | null
          utm_y: number | null
          accuracy: number | null
          altitude: number | null
          bearing: number | null
          provider: string | null
          speed_accuracy: number | null
          is_mock_location: boolean | null
          location_age_ms: number | null
          satellites_used: number | null
          satellites_total: number | null
          satellites_avg_snr: number | null
          velocidad: number | null
          distancia_recorrida: number | null
          movement_type: string | null
          app_state: string | null
          app_version: string | null
          permission_fine_location: boolean | null
          permission_coarse_location: boolean | null
          permission_background_location: boolean | null
          notifications_enabled: boolean | null
          gps_enabled: boolean | null
          battery_level: number | null
          battery_charging: boolean | null
          battery_status: string | null
          battery_saver_on: boolean | null
          battery_optimization_ignored: boolean | null
          doze_mode_active: boolean | null
          network_type: string | null
          network_connected: boolean | null
          device_manufacturer: string | null
          device_model: string | null
          device_brand: string | null
          android_version: number | null
          android_release: string | null
          memory_available_mb: number | null
          memory_total_mb: number | null
          memory_low: boolean | null
          execution_counter: number | null
          last_reset_reason: string | null
          fecha_hora: string
          timestamp_local: string | null
          timestamp_utc: string | null
          created_at: string | null
        }
        Insert: {
          id?: number
          movil_id: string
          pedido_id?: number | null
          device_id?: string | null
          usuario?: string | null
          escenario_id?: number | null
          latitud: number
          longitud: number
          utm_x?: number | null
          utm_y?: number | null
          accuracy?: number | null
          altitude?: number | null
          bearing?: number | null
          provider?: string | null
          speed_accuracy?: number | null
          is_mock_location?: boolean | null
          location_age_ms?: number | null
          satellites_used?: number | null
          satellites_total?: number | null
          satellites_avg_snr?: number | null
          velocidad?: number | null
          distancia_recorrida?: number | null
          movement_type?: string | null
          app_state?: string | null
          app_version?: string | null
          permission_fine_location?: boolean | null
          permission_coarse_location?: boolean | null
          permission_background_location?: boolean | null
          notifications_enabled?: boolean | null
          gps_enabled?: boolean | null
          battery_level?: number | null
          battery_charging?: boolean | null
          battery_status?: string | null
          battery_saver_on?: boolean | null
          battery_optimization_ignored?: boolean | null
          doze_mode_active?: boolean | null
          network_type?: string | null
          network_connected?: boolean | null
          device_manufacturer?: string | null
          device_model?: string | null
          device_brand?: string | null
          android_version?: number | null
          android_release?: string | null
          memory_available_mb?: number | null
          memory_total_mb?: number | null
          memory_low?: boolean | null
          execution_counter?: number | null
          last_reset_reason?: string | null
          fecha_hora: string
          timestamp_local?: string | null
          timestamp_utc?: string | null
          created_at?: string | null
        }
        Update: {
          id?: number
          movil_id?: string
          pedido_id?: number | null
          device_id?: string | null
          usuario?: string | null
          escenario_id?: number | null
          latitud?: number
          longitud?: number
          utm_x?: number | null
          utm_y?: number | null
          accuracy?: number | null
          altitude?: number | null
          bearing?: number | null
          provider?: string | null
          speed_accuracy?: number | null
          is_mock_location?: boolean | null
          location_age_ms?: number | null
          satellites_used?: number | null
          satellites_total?: number | null
          satellites_avg_snr?: number | null
          velocidad?: number | null
          distancia_recorrida?: number | null
          movement_type?: string | null
          app_state?: string | null
          app_version?: string | null
          permission_fine_location?: boolean | null
          permission_coarse_location?: boolean | null
          permission_background_location?: boolean | null
          notifications_enabled?: boolean | null
          gps_enabled?: boolean | null
          battery_level?: number | null
          battery_charging?: boolean | null
          battery_status?: string | null
          battery_saver_on?: boolean | null
          battery_optimization_ignored?: boolean | null
          doze_mode_active?: boolean | null
          network_type?: string | null
          network_connected?: boolean | null
          device_manufacturer?: string | null
          device_model?: string | null
          device_brand?: string | null
          android_version?: number | null
          android_release?: string | null
          memory_available_mb?: number | null
          memory_total_mb?: number | null
          memory_low?: boolean | null
          execution_counter?: number | null
          last_reset_reason?: string | null
          fecha_hora?: string
          timestamp_local?: string | null
          timestamp_utc?: string | null
          created_at?: string | null
        }
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
  }
}
