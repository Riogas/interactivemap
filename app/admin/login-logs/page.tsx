'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';

type LoginAttempt = {
  id: number;
  ts: string;
  escenario_id: number | null;
  username: string;
  ip: string;
  user_agent: string | null;
  estado: 'success' | 'fail' | 'blocked_user' | 'blocked_ip' | 'user_eq_pass';
  whitelisted: boolean;
};

type LoginBlock = {
  id: number;
  block_type: 'user' | 'ip';
  key: string;
  blocked_until: string;
  created_at: string;
  reason: string | null;
};

export default function LoginLogsPage() {
  const { user } = useAuth();
  const router = useRouter();

  const [attempts, setAttempts] = useState<LoginAttempt[]>([]);
  const [blocks, setBlocks] = useState<LoginBlock[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Filtros
  const [usernameFilter, setUsernameFilter] = useState('');
  const [ipFilter, setIpFilter] = useState('');
  const [estadoFilter, setEstadoFilter] = useState('');
  const [limit, setLimit] = useState(100);

  useEffect(() => {
    if (!user) {
      router.push('/login');
      return;
    }

    if (user.isRoot !== 'S') {
      router.push('/dashboard');
      return;
    }

    fetchData();
  }, [user, router, usernameFilter, ipFilter, estadoFilter, limit]);

  const fetchData = async () => {
    setLoading(true);
    setError('');

    try {
      // Fetch attempts
      const params = new URLSearchParams();
      if (usernameFilter) params.append('username', usernameFilter);
      if (ipFilter) params.append('ip', ipFilter);
      if (estadoFilter) params.append('estado', estadoFilter);
      params.append('limit', String(limit));

      const attemptsRes = await fetch(`/api/admin/login-logs?${params}`);
      const attemptsData = await attemptsRes.json();

      if (attemptsData.attempts) {
        setAttempts(attemptsData.attempts);
      }

      // Fetch blocks
      const blocksRes = await fetch('/api/admin/login-blocks');
      const blocksData = await blocksRes.json();

      if (blocksData.blocks) {
        setBlocks(blocksData.blocks);
      }
    } catch (err) {
      setError('Error al cargar los datos');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleUnblock = async (id: number) => {
    if (!confirm('¿Confirmar desbloqueo manual?')) return;

    try {
      const res = await fetch(`/api/admin/login-blocks/${id}`, {
        method: 'DELETE',
      });

      if (res.ok) {
        await fetchData();
      } else {
        alert('Error al desbloquear');
      }
    } catch (err) {
      alert('Error al desbloquear');
      console.error(err);
    }
  };

  const getEstadoBadgeClass = (estado: string) => {
    switch (estado) {
      case 'success':
        return 'bg-green-100 text-green-800 border-green-200';
      case 'fail':
        return 'bg-red-100 text-red-800 border-red-200';
      case 'blocked_user':
      case 'blocked_ip':
        return 'bg-orange-100 text-orange-800 border-orange-200';
      case 'user_eq_pass':
        return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-lg">Cargando...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-900 mb-6">Logs de Login</h1>

        {error && (
          <div className="bg-red-100 border border-red-300 text-red-800 p-4 rounded-lg mb-6">
            {error}
          </div>
        )}

        {/* Sección de bloqueos activos */}
        <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Bloqueos Activos</h2>
          {blocks.length === 0 ? (
            <p className="text-gray-500">No hay bloqueos activos</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Tipo</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Key</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Bloqueado Hasta</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Razón</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Acción</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {blocks.map((block) => (
                    <tr key={block.id}>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={`px-2 py-1 text-xs font-medium rounded border ${
                          block.block_type === 'user' ? 'bg-blue-100 text-blue-800 border-blue-200' : 'bg-purple-100 text-purple-800 border-purple-200'
                        }`}>
                          {block.block_type}
                        </span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">{block.key}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                        {new Date(block.blocked_until).toLocaleString('es-UY')}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">{block.reason || '-'}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm">
                        <button
                          onClick={() => handleUnblock(block.id)}
                          className="bg-red-500 hover:bg-red-600 text-white px-3 py-1 rounded text-xs font-medium transition"
                        >
                          Desbloquear
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Sección de intentos */}
        <div className="bg-white rounded-lg shadow-lg p-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Intentos de Login</h2>

          {/* Filtros */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Usuario</label>
              <input
                type="text"
                value={usernameFilter}
                onChange={(e) => setUsernameFilter(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="Filtrar por usuario"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">IP</label>
              <input
                type="text"
                value={ipFilter}
                onChange={(e) => setIpFilter(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="Filtrar por IP"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Estado</label>
              <select
                value={estadoFilter}
                onChange={(e) => setEstadoFilter(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="">Todos</option>
                <option value="success">Success</option>
                <option value="fail">Fail</option>
                <option value="blocked_user">Blocked User</option>
                <option value="blocked_ip">Blocked IP</option>
                <option value="user_eq_pass">User = Pass</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Límite</label>
              <select
                value={limit}
                onChange={(e) => setLimit(Number(e.target.value))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="50">50</option>
                <option value="100">100</option>
                <option value="200">200</option>
                <option value="500">500</option>
              </select>
            </div>
          </div>

          {/* Tabla de intentos */}
          {attempts.length === 0 ? (
            <p className="text-gray-500">No hay intentos que coincidan con los filtros</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Fecha/Hora</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Usuario</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">IP</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Escenario</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Estado</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">User-Agent</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {attempts.map((attempt) => (
                    <tr key={attempt.id}>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                        {new Date(attempt.ts).toLocaleString('es-UY')}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                        {attempt.username}
                        {attempt.whitelisted && (
                          <span className="ml-2 px-2 py-0.5 text-xs font-medium bg-green-100 text-green-800 rounded">WL</span>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">{attempt.ip}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">{attempt.escenario_id || '-'}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={`px-2 py-1 text-xs font-medium rounded border ${getEstadoBadgeClass(attempt.estado)}`}>
                          {attempt.estado}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500 max-w-xs truncate">
                        {attempt.user_agent || '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
