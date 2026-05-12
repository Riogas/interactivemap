// Tipos generados automaticamente basados en las tablas de Supabase

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
          escenario_id: number
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
          pto_vta_lat: number | null
          pto_vta_lng: number | null
          created_at: string | null
          updated_at: string | null
          // Contadores de carga en tiempo real (migration 2026-05-12)
          cant_ped: number
          cant_serv: number
          capacidad: number
        }
        Insert: {
          id: string
          escenario_id?: number
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
          pto_vta_lat?: number | null
          pto_vta_lng?: number | null
          created_at?: string | null
          updated_at?: string | null
          cant_ped?: number
          cant_serv?: number
          capacidad?: number
        }
        Update: {
          id?: string
          escenario_id?: number
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
          pto_vta_lat?: number | null
          pto_vta_lng?: number | null
          created_at?: string | null
          updated_at?: string | null
          cant_ped?: number
          cant_serv?: number
          capacidad?: number
        }
      }
      pedidos: {
        Row: {
          id: number
          escenario: number
          cliente_ciudad: string | null
          cliente_direccion: string | null
          cliente_direccion_esq1: string | null
          cliente_direccion_obs: string | null
          cliente_nombre: string | null
          cliente_nro: number | null
          cliente_obs: string | null
          cliente_tel: string | null
          demora_informada: number | null
          detalle_html: string | null
          empresa_fletera_id: number | null
          empresa_fletera_nom: string | null
          estado_nro: number | null
          fpago_obs1: string | null
          fch_hora_max_ent_comp: string | null
          fch_hora_mov: string | null
          fch_hora_finalizacion: string | null
          fch_hora_para: string | null
          fch_hora_upd_firestore: string | null
          fch_para: string | null
          google_maps_url: string | null
          imp_bruto: number | null
          imp_flete: number | null
          movil: number | null
          orden_cancelacion: string | null
          otros_productos: string | null
          pedido_obs: string | null
          precio: number | null
          prioridad: number | null
          prodsadicionales: string | null
          campana: string | null
          obsfletero: string | null
          fletero: string | null
          producto_cant: number | null
          producto_cod: string | null
          producto_nom: string | null
          servicio_nombre: string | null
          sub_estado_desc: string | null
          sub_estado_nro: number | null
          tipo: string | null
          visible_en_app: string | null
          waze_url: string | null
          zona_nro: number | null
          ubicacion: string | null
          created_at: string | null
          updated_at: string | null
          latitud: number | null
          longitud: number | null
          pedido_hijo: number | null
          atraso_cump_mins: number | null
          demora_movil_desde_asignacion_mins: number | null
        }
        Insert: {
          id: number
          escenario: number
          cliente_ciudad?: string | null
          cliente_direccion?: string | null
          cliente_direccion_esq1?: string | null
          cliente_direccion_obs?: string | null
          cliente_nombre?: string | null
          cliente_nro?: number | null
          cliente_obs?: string | null
          cliente_tel?: string | null
          demora_informada?: number | null
          detalle_html?: string | null
          empresa_fletera_id?: number | null
          empresa_fletera_nom?: string | null
          estado_nro?: number | null
          fpago_obs1?: string | null
          fch_hora_max_ent_comp?: string | null
          fch_hora_mov?: string | null
          fch_hora_finalizacion?: string | null
          fch_hora_para?: string | null
          fch_hora_upd_firestore?: string | null
          fch_para?: string | null
          google_maps_url?: string | null
          imp_bruto?: number | null
          imp_flete?: number | null
          movil?: number | null
          orden_cancelacion?: string | null
          otros_productos?: string | null
          pedido_obs?: string | null
          precio?: number | null
          prioridad?: number | null
          prodsadicionales?: string | null
          campana?: string | null
          obsfletero?: string | null
          fletero?: string | null
          producto_cant?: number | null
          producto_cod?: string | null
          producto_nom?: string | null
          servicio_nombre?: string | null
          sub_estado_desc?: string | null
          sub_estado_nro?: number | null
          tipo?: string | null
          visible_en_app?: string | null
          waze_url?: string | null
          zona_nro?: number | null
          ubicacion?: string | null
          created_at?: string | null
          updated_at?: string | null
          latitud?: number | null
          longitud?: number | null
          pedido_hijo?: number | null
          atraso_cump_mins?: number | null
          demora_movil_desde_asignacion_mins?: number | null
        }
        Update: {
          id?: number
          escenario?: number
          cliente_ciudad?: string | null
          cliente_direccion?: string | null
          cliente_direccion_esq1?: string | null
          cliente_direccion_obs?: string | null
          cliente_nombre?: string | null
          cliente_nro?: number | null
          cliente_obs?: string | null
          cliente_tel?: string | null
          demora_informada?: number | null
          detalle_html?: string | null
          empresa_fletera_id?: number | null
          empresa_fletera_nom?: string | null
          estado_nro?: number | null
          fpago_obs1?: string | null
          fch_hora_max_ent_comp?: string | null
          fch_hora_mov?: string | null
          fch_hora_finalizacion?: string | null
          fch_hora_para?: string | null
          fch_hora_upd_firestore?: string | null
          fch_para?: string | null
          google_maps_url?: string | null
          imp_bruto?: number | null
          imp_flete?: number | null
          movil?: number | null
          orden_cancelacion?: string | null
          otros_productos?: string | null
          pedido_obs?: string | null
          precio?: number | null
          prioridad?: number | null
          prodsadicionales?: string | null
          campana?: string | null
          obsfletero?: string | null
          fletero?: string | null
          producto_cant?: number | null
          producto_cod?: string | null
          producto_nom?: string | null
          servicio_nombre?: string | null
          sub_estado_desc?: string | null
          sub_estado_nro?: number | null
          tipo?: string | null
          visible_en_app?: string | null
          waze_url?: string | null
          zona_nro?: number | null
          ubicacion?: string | null
          created_at?: string | null
          updated_at?: string | null
          latitud?: number | null
          longitud?: number | null
          pedido_hijo?: number | null
          atraso_cump_mins?: number | null
          demora_movil_desde_asignacion_mins?: number | null
        }
      }
      services: {
        Row: {
          id: number
          escenario: number
          cliente_ciudad: string | null
          cliente_direccion: string | null
          cliente_direccion_esq1: string | null
          cliente_direccion_obs: string | null
          cliente_nombre: string | null
          cliente_nro: number | null
          cliente_obs: string | null
          cliente_tel: string | null
          defecto: string | null
          demora_informada: number | null
          detalle_html: string | null
          empresa_fletera_id: number | null
          empresa_fletera_nom: string | null
          estado_nro: number | null
          fpago_obs1: string | null
          fch_hora_max_ent_comp: string | null
          fch_hora_mov: string | null
          fch_hora_finalizacion: string | null
          fch_hora_para: string | null
          fch_hora_upd_firestore: string | null
          fch_para: string | null
          google_maps_url: string | null
          imp_bruto: number | null
          imp_flete: number | null
          movil: number | null
          orden_cancelacion: string | null
          otros_productos: string | null
          pedido_obs: string | null
          precio: number | null
          prioridad: number | null
          producto_cant: number | null
          producto_cod: string | null
          producto_nom: string | null
          servicio_nombre: string | null
          sub_estado_desc: string | null
          sub_estado_nro: number | null
          tipo: string | null
          visible_en_app: string | null
          waze_url: string | null
          zona_nro: number | null
          ubicacion: string | null
          latitud: number | null
          longitud: number | null
          fletero: string | null
          atraso_cump_mins: number | null
          demora_movil_desde_asignacion_mins: number | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id: number
          escenario: number
          cliente_ciudad?: string | null
          cliente_direccion?: string | null
          cliente_direccion_esq1?: string | null
          cliente_direccion_obs?: string | null
          cliente_nombre?: string | null
          cliente_nro?: number | null
          cliente_obs?: string | null
          cliente_tel?: string | null
          defecto?: string | null
          demora_informada?: number | null
          detalle_html?: string | null
          empresa_fletera_id?: number | null
          empresa_fletera_nom?: string | null
          estado_nro?: number | null
          fpago_obs1?: string | null
          fch_hora_max_ent_comp?: string | null
          fch_hora_mov?: string | null
          fch_hora_finalizacion?: string | null
          fch_hora_para?: string | null
          fch_hora_upd_firestore?: string | null
          fch_para?: string | null
          google_maps_url?: string | null
          imp_bruto?: number | null
          imp_flete?: number | null
          movil?: number | null
          orden_cancelacion?: string | null
          otros_productos?: string | null
          pedido_obs?: string | null
          precio?: number | null
          prioridad?: number | null
          producto_cant?: number | null
          producto_cod?: string | null
          producto_nom?: string | null
          servicio_nombre?: string | null
          sub_estado_desc?: string | null
          sub_estado_nro?: number | null
          tipo?: string | null
          visible_en_app?: string | null
          waze_url?: string | null
          zona_nro?: number | null
          ubicacion?: string | null
          latitud?: number | null
          longitud?: number | null
          fletero?: string | null
          atraso_cump_mins?: number | null
          demora_movil_desde_asignacion_mins?: number | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: number
          escenario?: number
          cliente_ciudad?: string | null
          cliente_direccion?: string | null
          cliente_direccion_esq1?: string | null
          cliente_direccion_obs?: string | null
          cliente_nombre?: string | null
          cliente_nro?: number | null
          cliente_obs?: string | null
          cliente_tel?: string | null
          defecto?: string | null
          demora_informada?: number | null
          detalle_html?: string | null
          empresa_fletera_id?: number | null
          empresa_fletera_nom?: string | null
          estado_nro?: number | null
          fpago_obs1?: string | null
          fch_hora_max_ent_comp?: string | null
          fch_hora_mov?: string | null
          fch_hora_finalizacion?: string | null
          fch_hora_para?: string | null
          fch_hora_upd_firestore?: string | null
          fch_para?: string | null
          google_maps_url?: string | null
          imp_bruto?: number | null
          imp_flete?: number | null
          movil?: number | null
          orden_cancelacion?: string | null
          otros_productos?: string | null
          pedido_obs?: string | null
          precio?: number | null
          prioridad?: number | null
          producto_cant?: number | null
          producto_cod?: string | null
          producto_nom?: string | null
          servicio_nombre?: string | null
          sub_estado_desc?: string | null
          sub_estado_nro?: number | null
          tipo?: string | null
          visible_en_app?: string | null
          waze_url?: string | null
          zona_nro?: number | null
          ubicacion?: string | null
          latitud?: number | null
          longitud?: number | null
          fletero?: string | null
          atraso_cump_mins?: number | null
          demora_movil_desde_asignacion_mins?: number | null
          created_at?: string | null
          updated_at?: string | null
        }
      }
      fleteras_zonas: {
        Row: {
          escenario_id: number
          tipo_de_zona: string
          empresa_fletera_id: number
          tipo_de_servicio: string
          zonas: Json
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          escenario_id: number
          tipo_de_zona: string
          empresa_fletera_id: number
          tipo_de_servicio: string
          zonas: Json
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          escenario_id?: number
          tipo_de_zona?: string
          empresa_fletera_id?: number
          tipo_de_servicio?: string
          zonas?: Json
          created_at?: string | null
          updated_at?: string | null
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
      gps_tracking_history: {
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
      gps_latest_positions: {
        Row: {
          movil_id: string
          history_id: number | null
          escenario_id: number | null
          latitud: number
          longitud: number
          velocidad: number | null
          bearing: number | null
          accuracy: number | null
          altitude: number | null
          battery_level: number | null
          distancia_recorrida: number | null
          movement_type: string | null
          device_id: string | null
          app_version: string | null
          network_type: string | null
          network_connected: boolean | null
          fecha_hora: string
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          movil_id: string
          history_id?: number | null
          escenario_id?: number | null
          latitud: number
          longitud: number
          velocidad?: number | null
          bearing?: number | null
          accuracy?: number | null
          altitude?: number | null
          battery_level?: number | null
          distancia_recorrida?: number | null
          movement_type?: string | null
          device_id?: string | null
          app_version?: string | null
          network_type?: string | null
          network_connected?: boolean | null
          fecha_hora: string
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          movil_id?: string
          history_id?: number | null
          escenario_id?: number | null
          latitud?: number
          longitud?: number
          velocidad?: number | null
          bearing?: number | null
          accuracy?: number | null
          altitude?: number | null
          battery_level?: number | null
          distancia_recorrida?: number | null
          movement_type?: string | null
          device_id?: string | null
          app_version?: string | null
          network_type?: string | null
          network_connected?: boolean | null
          fecha_hora?: string
          created_at?: string | null
          updated_at?: string | null
        }
      }
      escenario_settings: {
        Row: {
          escenario_id: number
          pedidos_sa_minutos_antes: number | null
          aplica_serv_nocturno: boolean | null
          hora_ini_nocturno: string | null
          hora_fin_nocturno: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          escenario_id: number
          pedidos_sa_minutos_antes?: number | null
          aplica_serv_nocturno?: boolean | null
          hora_ini_nocturno?: string | null
          hora_fin_nocturno?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          escenario_id?: number
          pedidos_sa_minutos_antes?: number | null
          aplica_serv_nocturno?: boolean | null
          hora_ini_nocturno?: string | null
          hora_fin_nocturno?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      login_attempts: {
        Row: {
          id: number
          ts: string
          escenario_id: number | null
          username: string
          ip: string
          user_agent: string | null
          estado: 'success' | 'fail' | 'blocked_user' | 'blocked_ip' | 'user_eq_pass'
          blocked_until: string | null
          whitelisted: boolean
          extra: Json | null
        }
        Insert: {
          id?: never
          ts?: string
          escenario_id?: number | null
          username: string
          ip: string
          user_agent?: string | null
          estado: 'success' | 'fail' | 'blocked_user' | 'blocked_ip' | 'user_eq_pass'
          blocked_until?: string | null
          whitelisted?: boolean
          extra?: Json | null
        }
        Update: {
          id?: never
          ts?: string
          escenario_id?: number | null
          username?: string
          ip?: string
          user_agent?: string | null
          estado?: 'success' | 'fail' | 'blocked_user' | 'blocked_ip' | 'user_eq_pass'
          blocked_until?: string | null
          whitelisted?: boolean
          extra?: Json | null
        }
      }
      login_blocks: {
        Row: {
          id: number
          block_type: 'user' | 'ip'
          key: string
          blocked_until: string
          created_at: string
          reason: string | null
        }
        Insert: {
          id?: never
          block_type: 'user' | 'ip'
          key: string
          blocked_until: string
          created_at?: string
          reason?: string | null
        }
        Update: {
          id?: never
          block_type?: 'user' | 'ip'
          key?: string
          blocked_until?: string
          created_at?: string
          reason?: string | null
        }
      }
      zonas_cap_entrega: {
        Row: {
          escenario: number
          zona: number
          tipo_servicio: string
          movil: number
          emp_fletera_id: number
          lote_disponible: number
          updated_at: string
        }
        Insert: {
          escenario: number
          zona: number
          tipo_servicio: string
          movil: number
          emp_fletera_id: number
          lote_disponible: number
          updated_at?: string
        }
        Update: {
          escenario?: number
          zona?: number
          tipo_servicio?: string
          movil?: number
          emp_fletera_id?: number
          lote_disponible?: number
          updated_at?: string
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
