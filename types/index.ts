// ========== TIPOS LEGACY (AS400) ==========
export interface MovilCoordinate {
  identificador: number;
  origen: string;
  coordX: number;
  coordY: number;
  fechaInsLog: string;
  auxIn2: string;
  distRecorrida: number;
  obs?: string;          // 'SERVICES' or 'PEDIDOS'
  pedidoId?: number;     // ID from LOGCOORDMOVILpedid
  clienteX?: number;     // from logcoordmovilcoordclix
  clienteY?: number;     // from logcoordmovilcoordcliy
}

export interface MovilData {
  id: number;
  name: string;
  color: string;
  empresaFleteraId?: number; // ID de la empresa fletera a la que pertenece
  currentPosition?: MovilCoordinate;
  history?: MovilCoordinate[];
  pedidosPendientes?: number;
  serviciosPendientes?: number;
  pendientes?: PedidoServicio[];
  isInactive?: boolean; // Móvil con coordenadas muy antiguas
}

export interface EmpresaFletera {
  eflid: number;
  eflnom: string;
  eflestado: string;
}

export interface MovilEmpresa {
  movid: number;
  eflid: number;
  movestcod: string;
}

export interface PedidoServicio {
  tipo: 'PEDIDO' | 'SERVICIO';
  id: number;
  cliid: number;
  clinom: string;
  fecha: string;
  x: number;
  y: number;
  estado: number;
  subestado: number;
}

export interface PedidosServiciosResponse {
  success: boolean;
  movilId: number;
  fechaDesde: string;
  count: number;
  data: PedidoServicio[];
}

export interface PedidosServiciosPendientesResponse {
  success: boolean;
  movilId: number;
  fechaDesde: string;
  total: number;
  pedidosPendientes: number;
  serviciosPendientes: number;
  data: PedidoServicio[];
}

// ========== TIPOS SUPABASE ==========
import type { Database } from './supabase';

// Tipos de las tablas de Supabase
export type MovilSupabase = Database['public']['Tables']['moviles']['Row'];
export type PedidoSupabase = Database['public']['Tables']['pedidos']['Row'];
export type EmpresaFleteraSupabase = Database['public']['Tables']['empresas_fleteras']['Row'];
export type GPSTrackingSupabase = Database['public']['Tables']['gps_tracking_extended']['Row'];

// Tipos para inserciones
export type MovilInsert = Database['public']['Tables']['moviles']['Insert'];
export type PedidoInsert = Database['public']['Tables']['pedidos']['Insert'];
export type EmpresaFleteraInsert = Database['public']['Tables']['empresas_fleteras']['Insert'];
export type GPSTrackingInsert = Database['public']['Tables']['gps_tracking_extended']['Insert'];

// Tipos unificados para la UI (combina ambos sistemas)
export interface MovilUnified {
  id: number;
  name: string;
  matricula?: string;
  color: string;
  empresa_fletera_id: number;
  escenario_id: number;
  estado: number | null;
  mostrar_en_mapa: boolean;
  currentPosition?: GPSPosition;
  history?: GPSPosition[];
  pedidosPendientes?: number;
  serviciosPendientes?: number;
  pedidos?: PedidoSupabase[];
}

export interface GPSPosition {
  id: number;
  movil: string;
  latitud: number;
  longitud: number;
  fecha_hora: string;
  velocidad?: number | null;
  bearing?: number | null;
  accuracy?: number | null;
  battery_level?: number | null;
  distancia_recorrida?: number | null;
}

export interface PedidoWithDetails extends PedidoSupabase {
  distance?: number; // Para ordenamiento por distancia
}

// Interface para pedidos pendientes en el mapa
export interface PedidoPendiente {
  pedido_id: number;
  escenario_id: number;
  movil: number;
  estado: number | null;
  latitud: number;
  longitud: number;
  zona: number | null;
  tipo: string | null;
  nombre_servicio: string | null;
  producto_codigo: string | null;
  producto_nombre: string | null;
  producto_cantidad: number | null;
  producto_precio: number | null;
  prioridad: number;
  observacion: string | null;
  importe_flete: number | null;
  importe_bruto: number | null;
  fecha_para: string | null;
  fecha_hora_max_comp: string | null;
  fecha_hora_para: string | null;
  fecha_hora_asignado: string | null;
  fecha_hora_cumplido: string | null;
  cliente_nombre: string | null;
  cliente_direccion: string | null;
  cliente_nro: string | null;
  cliente_telefono: string | null;
  cliente_observacion: string | null;
  empresa_fletera_id: number | null;
}

// Colores para asignar a los móviles dinámicamente
export const MOVIL_COLORS = [
  '#3b82f6', // blue
  '#ef4444', // red
  '#10b981', // green
  '#f59e0b', // amber
  '#8b5cf6', // purple
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#f97316', // orange
  '#14b8a6', // teal
  '#a855f7', // violet
];

export function getMovilColor(index: number): string {
  return MOVIL_COLORS[index % MOVIL_COLORS.length];
}
