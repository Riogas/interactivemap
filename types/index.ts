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
  currentPosition?: MovilCoordinate;
  history?: MovilCoordinate[];
  pedidosPendientes?: number;
  serviciosPendientes?: number;
  pendientes?: PedidoServicio[];
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
