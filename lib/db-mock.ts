import { MovilCoordinate } from '@/types';

// Coordenadas de ejemplo en Asunción, Paraguay
const MOCK_COORDINATES: Record<number, MovilCoordinate[]> = {
  693: [
    {
      identificador: 693,
      origen: 'GPS',
      coordX: -57.5759,
      coordY: -25.2637,
      fechaInsLog: new Date().toISOString(),
      auxIn2: 'PRIMERA',
      distRecorrida: 12.5,
    },
  ],
  251: [
    {
      identificador: 251,
      origen: 'GPS',
      coordX: -57.5859,
      coordY: -25.2737,
      fechaInsLog: new Date().toISOString(),
      auxIn2: 'QUIETO',
      distRecorrida: 8.3,
    },
  ],
  337: [
    {
      identificador: 337,
      origen: 'GPS',
      coordX: -57.5659,
      coordY: -25.2537,
      fechaInsLog: new Date().toISOString(),
      auxIn2: 'QUIETO',
      distRecorrida: 15.7,
    },
  ],
};

// Simula movimiento aleatorio
function getRandomOffset(max: number = 0.001): number {
  return (Math.random() - 0.5) * max;
}

export async function getMovilCoordinates(
  movilId: number,
  startDate?: string,
  limit: number = 100
): Promise<MovilCoordinate[]> {
  // Simula delay de red
  await new Promise(resolve => setTimeout(resolve, 100));
  
  const baseCoords = MOCK_COORDINATES[movilId] || [];
  
  if (baseCoords.length === 0) return [];
  
  const base = baseCoords[0];
  
  // Genera historial con movimiento simulado
  return Array.from({ length: Math.min(limit, 10) }, (_, i) => ({
    ...base,
    coordX: base.coordX + getRandomOffset(),
    coordY: base.coordY + getRandomOffset(),
    fechaInsLog: new Date(Date.now() - i * 60000).toISOString(),
    distRecorrida: base.distRecorrida + (i * 0.1),
  }));
}

export async function getLatestPosition(movilId: number): Promise<MovilCoordinate | null> {
  await new Promise(resolve => setTimeout(resolve, 50));
  
  const base = MOCK_COORDINATES[movilId]?.[0];
  
  if (!base) return null;
  
  // Simula movimiento en tiempo real
  return {
    ...base,
    coordX: base.coordX + getRandomOffset(0.0005),
    coordY: base.coordY + getRandomOffset(0.0005),
    fechaInsLog: new Date().toISOString(),
    distRecorrida: base.distRecorrida + Math.random() * 0.5,
  };
}

export async function getAllMovilesLatestPositions(
  movilIds: number[]
): Promise<Map<number, MovilCoordinate>> {
  const positions = new Map<number, MovilCoordinate>();
  
  await Promise.all(
    movilIds.map(async (id) => {
      const position = await getLatestPosition(id);
      if (position) {
        positions.set(id, position);
      }
    })
  );
  
  return positions;
}
