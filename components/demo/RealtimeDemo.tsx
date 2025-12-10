'use client';

import { useEffect, useState } from 'react';
import { useGPSTracking, usePedidos, useMoviles } from '@/lib/hooks/useRealtimeSubscriptions';

/**
 * Componente de ejemplo para demostrar Supabase Realtime
 * 
 * Este componente muestra:
 * - Estado de conexión de Realtime
 * - Últimas posiciones GPS recibidas
 * - Actualizaciones de móviles
 * - Cambios en pedidos
 */
export default function RealtimeDemo() {
  const [escenarioId] = useState(1);
  const [logs, setLogs] = useState<string[]>([]);
  
  // Hook de GPS Tracking
  const { 
    positions: gpsPositions, 
    isConnected: gpsConnected, 
    error: gpsError 
  } = useGPSTracking(escenarioId, undefined, (newPosition) => {
    addLog(`📍 GPS: Móvil ${newPosition.movil} - Lat: ${newPosition.latitud}, Lon: ${newPosition.longitud}`);
  });
  
  // Hook de Móviles
  const { 
    moviles, 
    isConnected: movilesConnected 
  } = useMoviles(escenarioId, undefined, (movil) => {
    addLog(`🚗 Móvil actualizado: ${movil.movil} - Matrícula: ${movil.matricula}`);
  });
  
  // Hook de Pedidos
  const { 
    pedidos, 
    isConnected: pedidosConnected 
  } = usePedidos(escenarioId, undefined, (pedido) => {
    addLog(`📦 Pedido ${pedido.pedido_id} - Estado: ${pedido.estado} - Cliente: ${pedido.cliente_nombre}`);
  });
  
  const addLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [`[${timestamp}] ${message}`, ...prev.slice(0, 49)]); // Mantener últimos 50
  };
  
  useEffect(() => {
    addLog('🚀 Componente iniciado - Esperando eventos de Realtime...');
  }, []);
  
  return (
    <div className="p-6 max-w-7xl mx-auto">
      <h1 className="text-3xl font-bold mb-6">
        🔴 Demo de Supabase Realtime
      </h1>
      
      {/* Estado de Conexiones */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <StatusCard 
          title="GPS Tracking" 
          isConnected={gpsConnected} 
          count={gpsPositions.size}
          error={gpsError}
        />
        <StatusCard 
          title="Móviles" 
          isConnected={movilesConnected} 
          count={moviles.length}
        />
        <StatusCard 
          title="Pedidos" 
          isConnected={pedidosConnected} 
          count={pedidos.length}
        />
      </div>
      
      {/* Datos en Tiempo Real */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Log de Eventos */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
            📝 Log de Eventos en Tiempo Real
            <span className="text-sm text-gray-500">({logs.length})</span>
          </h2>
          <div className="h-96 overflow-y-auto bg-gray-50 rounded p-4 font-mono text-sm">
            {logs.length === 0 ? (
              <div className="text-gray-400 text-center py-8">
                Esperando eventos...
                <br />
                <span className="text-xs">
                  Ejecuta un INSERT en Supabase para ver actualizaciones
                </span>
              </div>
            ) : (
              logs.map((log, index) => (
                <div 
                  key={index} 
                  className="mb-1 pb-1 border-b border-gray-200 last:border-0"
                >
                  {log}
                </div>
              ))
            )}
          </div>
        </div>
        
        {/* Últimas Posiciones GPS */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold mb-4">
            📍 Últimas Posiciones GPS
          </h2>
          <div className="h-96 overflow-y-auto">
            {Array.from(gpsPositions.entries()).length === 0 ? (
              <div className="text-gray-400 text-center py-8">
                No hay posiciones GPS aún
              </div>
            ) : (
              <div className="space-y-2">
                {Array.from(gpsPositions.entries()).map(([movilId, position]) => (
                  <div 
                    key={movilId}
                    className="p-3 bg-blue-50 rounded border border-blue-200"
                  >
                    <div className="font-semibold text-blue-900">
                      Móvil {movilId}
                    </div>
                    <div className="text-sm text-gray-600 mt-1">
                      <div>📐 Lat: {position.latitud}, Lon: {position.longitud}</div>
                      <div>🕐 {new Date(position.fecha_hora).toLocaleString()}</div>
                      {position.velocidad && (
                        <div>🚗 Velocidad: {position.velocidad} km/h</div>
                      )}
                      {position.battery_level && (
                        <div>🔋 Batería: {position.battery_level}%</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      
      {/* Instrucciones */}
      <div className="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-6">
        <h3 className="text-lg font-semibold text-blue-900 mb-3">
          💡 Cómo Probar
        </h3>
        <ol className="list-decimal list-inside space-y-2 text-sm text-gray-700">
          <li>
            Abre el SQL Editor en Supabase:{' '}
            <a 
              href="https://supabase.com/dashboard/project/lgniuhelyyizoursmsmi/sql" 
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:underline"
            >
              Dashboard SQL
            </a>
          </li>
          <li>
            Ejecuta este comando:
            <pre className="bg-white p-2 mt-1 rounded border text-xs overflow-x-auto">
{`INSERT INTO gps_tracking_extended (
  movil, escenario_id, latitud, longitud, fecha_hora
) VALUES (
  '101', 1, -34.9011, -56.1645, NOW()
);`}
            </pre>
          </li>
          <li>
            ¡Observa cómo aparece la actualización en tiempo real en esta página! 🎉
          </li>
        </ol>
      </div>
      
      {/* Información Adicional */}
      <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
        <InfoCard 
          title="📊 Estadísticas"
          items={[
            `Total móviles: ${moviles.length}`,
            `Total pedidos: ${pedidos.length}`,
            `Posiciones GPS: ${gpsPositions.size}`,
            `Eventos registrados: ${logs.length}`
          ]}
        />
        <InfoCard 
          title="🔗 Estado de Conexión"
          items={[
            `GPS Tracking: ${gpsConnected ? '🟢 Conectado' : '🔴 Desconectado'}`,
            `Móviles: ${movilesConnected ? '🟢 Conectado' : '🔴 Desconectado'}`,
            `Pedidos: ${pedidosConnected ? '🟢 Conectado' : '🔴 Desconectado'}`,
            `Escenario ID: ${escenarioId}`
          ]}
        />
      </div>
    </div>
  );
}

// Componente auxiliar para tarjetas de estado
function StatusCard({ 
  title, 
  isConnected, 
  count, 
  error 
}: { 
  title: string; 
  isConnected: boolean; 
  count: number;
  error?: string | null;
}) {
  return (
    <div className={`p-4 rounded-lg border-2 ${
      isConnected ? 'bg-green-50 border-green-300' : 'bg-red-50 border-red-300'
    }`}>
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-semibold">{title}</h3>
        <span className="text-2xl">{isConnected ? '🟢' : '🔴'}</span>
      </div>
      <div className="text-sm text-gray-600">
        Estado: {isConnected ? 'Conectado' : 'Desconectado'}
      </div>
      <div className="text-lg font-bold mt-2">
        {count} {count === 1 ? 'registro' : 'registros'}
      </div>
      {error && (
        <div className="text-xs text-red-600 mt-2">
          Error: {error}
        </div>
      )}
    </div>
  );
}

// Componente auxiliar para tarjetas de información
function InfoCard({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="bg-white rounded-lg shadow p-4">
      <h3 className="font-semibold mb-3">{title}</h3>
      <ul className="space-y-1 text-sm">
        {items.map((item, index) => (
          <li key={index} className="text-gray-700">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
