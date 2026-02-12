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
  // 🔥 NUEVO: Datos extendidos desde Supabase
  tamanoLote?: number;        // Capacidad del móvil (desde tabla moviles)
  pedidosAsignados?: number;  // Cantidad de pedidos asignados (count desde tabla pedidos)
  matricula?: string;         // Matrícula del móvil
  estadoDesc?: string;        // Descripción del estado (ACTIVO, INACTIVO, etc.)
  terminalId?: string;        // ID de la terminal del móvil (ej: abbc5d30f70f8cc4)
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
export type ServiceSupabase = Database['public']['Tables']['services']['Row'];
export type EmpresaFleteraSupabase = Database['public']['Tables']['empresas_fleteras']['Row'];
export type GPSTrackingSupabase = Database['public']['Tables']['gps_tracking_extended']['Row'];

// Tipos para inserciones
export type MovilInsert = Database['public']['Tables']['moviles']['Insert'];
export type PedidoInsert = Database['public']['Tables']['pedidos']['Insert'];
export type ServiceInsert = Database['public']['Tables']['services']['Insert'];
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

// ========== TIPOS EXTENDIDOS PARA CAPAS DEL MAPA ==========

// Móvil extendido con información adicional para display
export interface MovilExtended extends MovilData {
  pedidosAsignados: number;  // Cantidad de pedidos asignados
  capacidadMovil: number;     // Capacidad total del móvil
  numeroCelular?: string;     // Número de teléfono del móvil
}

// Service (Servicio)
export interface ServiceData {
  id: number;
  nroService: string;
  nroTelCliente: string;
  fechaEntregaComprometida: Date;
  fechaEntregaReal?: Date;
  estado: 'pendiente' | 'en_proceso' | 'completado' | 'atrasado';
  diasAtraso: number;  // Calculado: hoy - fechaEntregaComprometida
  latitud: number;
  longitud: number;
  clienteNombre: string;
  observaciones?: string;
}

// Pedido
export interface PedidoData {
  id: number;
  nroPedido: string;
  nroTelCliente: string;
  fechaEntregaComprometida: Date;
  fechaEntregaReal?: Date;
  estado: 'pendiente' | 'en_proceso' | 'completado' | 'atrasado';
  tipoServicio: 'urgente' | 'especial' | 'normal';
  diasAtraso: number;  // Calculado: hoy - fechaEntregaComprometida
  latitud: number;
  longitud: number;
  clienteNombre: string;
  movilAsignado?: number;  // ID del móvil asignado
  observaciones?: string;
}

// Marcador Personalizado (Cliente - LocalStorage)
export interface CustomMarker {
  id: string;  // UUID generado localmente
  nombre: string;
  observacion: string;
  icono: string;  // Emoji
  latitud: number;
  longitud: number;
  creadoPor?: string;  // ID o nombre del usuario creador
  fechaCreacion: string;  // ISO date string
  visible: boolean;  // Si está visible en el mapa
}

// Punto de Interés (Supabase - Persistente)
export interface PuntoInteresSupabase {
  id: number;
  nombre: string;
  descripcion: string | null;
  icono: string;
  latitud: number; // Stored as DECIMAL in DB
  longitud: number; // Stored as DECIMAL in DB
  tipo: 'publico' | 'privado';
  visible: boolean;
  usuario_id: string; // UUID
  usuario_email: string | null;
  created_at: string;
  updated_at: string;
}

// Punto de Interés (legacy, mantener por compatibilidad)
export interface PuntoInteresData {
  id: number;
  nombre: string;
  observaciones?: string;
  icono: string;  // Emoji o nombre de icono
  latitud: number;
  longitud: number;
  tipo: 'publico' | 'privado';  // Público (admin) o Privado (usuario)
  creadoPor?: string;  // ID o nombre del usuario creador
  fechaCreacion: Date;
  visible: boolean;  // Si está visible en el mapa
}

// Filtros para cada categoría
export interface MovilFilters {
  capacidad: 'all' | '1-3' | '4-6' | '7-10' | '10+';
  estado: string[]; // Filtro multi-selección de estados
}

export interface ServiceFilters {
  atraso: string[]; // Multi-selección: 'en_hora' | 'limite_cercana' | 'atrasado' | 'muy_atrasado' | 'sin_hora'
}

export interface PedidoFilters {
  atraso: string[]; // Multi-selección: 'en_hora' | 'limite_cercana' | 'atrasado' | 'muy_atrasado' | 'sin_hora'
  tipoServicio: 'all' | 'urgente' | 'especial' | 'normal';
}
