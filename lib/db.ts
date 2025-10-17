import { MovilCoordinate } from '@/types';

const API_URL = process.env.EXTERNAL_API_URL;

if (!API_URL) {
  throw new Error('EXTERNAL_API_URL no está configurado en .env.local');
}

export async function getMovilCoordinates(
  movilId: number,
  startDate?: string,
  limit: number = 100
): Promise<MovilCoordinate[]> {
  
  console.log(`🔴 Connecting to external API: ${API_URL}`);
  
  const dateFilter = startDate || new Date().toISOString().split('T')[0];
  const url = `${API_URL}/coordinates?movilId=${movilId}&startDate=${dateFilter}&limit=${limit}`;
  
  console.log(`📡 Fetching: ${url}`);
  
  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(30000), // Timeout de 30 segundos
  });
  
  if (!response.ok) {
    throw new Error(`API error: ${response.status} ${response.statusText}`);
  }
  
  const result = await response.json();
  console.log(`✅ API Response:`, result);
  
  // La API devuelve {success, data: [...]}
  const data = result.data || [];
  console.log(`✅ Retrieved ${data.length} coordinates from AS400`);
  
  return data.map((item: any) => {
    const coordXRaw = String(item.coordx || item.coordX || '').trim();
    const coordYRaw = String(item.coordy || item.coordY || '').trim();
    
    console.log('🔍 Coordenadas raw:', { coordXRaw, coordYRaw });
    
    return {
      identificador: Number(item.identificador),
      origen: String(item.origen || '').trim(),
      coordX: Number(coordXRaw),
      coordY: Number(coordYRaw),
      fechaInsLog: String(item.fechainslog || item.fechaInsLog),
      auxIn2: String(item.auxin2 || item.auxIn2 || '').trim(),
      distRecorrida: Number(item.distrecorrida || item.distRecorrida) || 0,
      // Nuevos campos para pedidos/servicios completados
      obs: item.obs ? String(item.obs).trim() : undefined,
      pedidoId: item.pedidoid || item.pedidoId ? Number(item.pedidoid || item.pedidoId) : undefined,
      clienteX: item.clientex || item.clienteX ? Number(String(item.clientex || item.clienteX).trim()) : undefined,
      clienteY: item.clientey || item.clienteY ? Number(String(item.clientey || item.clienteY).trim()) : undefined,
    };
  });
}

export async function getLatestPosition(movilId: number): Promise<MovilCoordinate | null> {
  const coordinates = await getMovilCoordinates(movilId, undefined, 1);
  return coordinates[0] || null;
}

export async function getAllMovilesLatestPositions(
  movilIds?: number[]
): Promise<Map<number, MovilCoordinate>> {
  console.log(`🔴 Fetching ALL latest positions from API`);
  
  const dateFilter = new Date().toISOString().split('T')[0];
  let url = `${API_URL}/latest-positions?startDate=${dateFilter}`;
  
  // Si se especifican IDs específicos, agregarlos al query
  if (movilIds && movilIds.length > 0) {
    url += `&movilIds=${movilIds.join(',')}`;
    console.log(`📡 Filtering by móviles: ${movilIds.join(',')}`);
  } else {
    console.log(`📡 No filter - fetching ALL móviles`);
  }
  
  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(30000),
  });
  
  if (!response.ok) {
    throw new Error(`API error: ${response.status} ${response.statusText}`);
  }
  
  const result = await response.json();
  console.log(`✅ Retrieved ${result.count} móviles from AS400`);
  
  const positions = new Map<number, MovilCoordinate>();
  
  const data = result.data || [];
  data.forEach((item: any) => {
    const coordXRaw = String(item.coordx || item.coordX || '').trim();
    const coordYRaw = String(item.coordy || item.coordY || '').trim();
    
    const coordinate: MovilCoordinate = {
      identificador: Number(item.identificador),
      origen: String(item.origen || '').trim(),
      coordX: Number(coordXRaw),
      coordY: Number(coordYRaw),
      fechaInsLog: String(item.fechainslog || item.fechaInsLog),
      auxIn2: String(item.auxin2 || item.auxIn2 || '').trim(),
      distRecorrida: Number(item.distrecorrida || item.distRecorrida) || 0,
    };
    
    // Filtrar coordenadas inválidas (0,0)
    if (coordinate.coordX !== 0 && coordinate.coordY !== 0) {
      positions.set(coordinate.identificador, coordinate);
    }
  });
  
  console.log(`✅ Loaded ${positions.size} valid móviles (filtered out invalid coordinates)`);
  
  return positions;
}

/**
 * Obtener lista de empresas fleteras desde AS400
 */
export async function getEmpresasFleteras() {
  console.log(`🏢 Fetching empresas fleteras from: ${API_URL}/empresas-fleteras`);
  
  const response = await fetch(`${API_URL}/empresas-fleteras`, {
    headers: {
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(30000),
  });
  
  if (!response.ok) {
    throw new Error(`API error: ${response.status} ${response.statusText}`);
  }
  
  const result = await response.json();
  console.log(`✅ Retrieved ${result.count} empresas fleteras`);
  
  return result.data || [];
}

/**
 * Obtener móviles de una empresa fletera específica
 */
export async function getMovilesByEmpresa(empresaId: number) {
  console.log(`🚗 Fetching móviles for empresa ${empresaId}`);
  
  const response = await fetch(`${API_URL}/moviles-por-empresa?empresaId=${empresaId}`, {
    headers: {
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(30000),
  });
  
  if (!response.ok) {
    throw new Error(`API error: ${response.status} ${response.statusText}`);
  }
  
  const result = await response.json();
  console.log(`✅ Retrieved ${result.count} móviles for empresa ${empresaId}`);
  
  return result.data || [];
}

/**
 * Obtener últimas posiciones de todos los móviles, opcionalmente filtradas por empresas fleteras
 */
export async function getAllMovilesLatestPositionsByEmpresas(
  startDate?: string,
  empresaIds?: number[]
): Promise<Map<number, MovilCoordinate>> {
  const dateFilter = startDate || new Date().toISOString().split('T')[0];
  
  // Construir URL con filtro de empresas si se proporciona
  let url = `${API_URL}/latest-positions?startDate=${dateFilter}`;
  if (empresaIds && empresaIds.length > 0) {
    url += `&empresaIds=${empresaIds.join(',')}`;
  }
  
  console.log(`🔍 Fetching latest positions (filtered by empresas): ${url}`);
  
  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(30000),
  });
  
  if (!response.ok) {
    throw new Error(`API error: ${response.status} ${response.statusText}`);
  }
  
  const result = await response.json();
  const data = result.data || [];
  
  console.log(`✅ Retrieved ${data.length} coordinates from AS400`);
  
  // Convertir a Map para fácil acceso por ID
  const positions = new Map<number, MovilCoordinate>();
  
  data.forEach((item: any) => {
    const coordXRaw = String(item.coordx || item.coordX || '').trim();
    const coordYRaw = String(item.coordy || item.coordY || '').trim();
    
    const coordinate: MovilCoordinate = {
      identificador: Number(item.identificador),
      origen: String(item.origen || '').trim(),
      coordX: Number(coordXRaw),
      coordY: Number(coordYRaw),
      fechaInsLog: String(item.fechainslog || item.fechaInsLog),
      auxIn2: String(item.auxin2 || item.auxIn2 || '').trim(),
      distRecorrida: Number(item.distrecorrida || item.distRecorrida) || 0,
    };
    
    // Filtrar coordenadas inválidas (0,0)
    if (coordinate.coordX !== 0 && coordinate.coordY !== 0) {
      positions.set(coordinate.identificador, coordinate);
    }
  });
  
  console.log(`✅ Loaded ${positions.size} valid móviles for selected empresas`);
  
  return positions;
}

/**
 * Obtener pedidos y servicios de un móvil
 */
export async function getPedidosServiciosMovil(
  movilId: number,
  fechaDesde?: string
) {
  const dateFilter = fechaDesde || new Date().toISOString().split('T')[0] + ' 00:00:00';
  const url = `${API_URL}/pedidos-servicios/${movilId}?fecha_desde=${encodeURIComponent(dateFilter)}`;
  
  console.log(`📦 Fetching pedidos/servicios: ${url}`);
  
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(30000),
  });
  
  if (!response.ok) {
    throw new Error(`API error: ${response.status} ${response.statusText}`);
  }
  
  const result = await response.json();
  console.log(`✅ Retrieved ${result.count} pedidos/servicios`);
  
  return result;
}

/**
 * Obtener solo pedidos y servicios PENDIENTES de un móvil
 */
export async function getPedidosServiciosPendientes(
  movilId: number,
  fechaDesde?: string
) {
  const dateFilter = fechaDesde || new Date().toISOString().split('T')[0] + ' 00:00:00';
  const url = `${API_URL}/pedidos-servicios-pendientes/${movilId}?fecha_desde=${encodeURIComponent(dateFilter)}`;
  
  console.log(`⏳ Fetching pendientes: ${url}`);
  
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(30000),
  });
  
  if (!response.ok) {
    throw new Error(`API error: ${response.status} ${response.statusText}`);
  }
  
  const result = await response.json();
  console.log(`✅ Retrieved ${result.total} pendientes (${result.pedidosPendientes} pedidos, ${result.serviciosPendientes} servicios)`);
  
  return result;
}
