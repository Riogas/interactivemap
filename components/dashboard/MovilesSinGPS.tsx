'use client';

import { MovilData } from '@/types';
import { motion } from 'framer-motion';

interface MovilesSinGPSProps {
  moviles: MovilData[];
}

export default function MovilesSinGPS({ moviles }: MovilesSinGPSProps) {
  // Filtrar móviles sin posición GPS
  const movilesSinGPS = moviles.filter(m => !m.currentPosition);

  if (movilesSinGPS.length === 0) {
    return null;
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-yellow-50 border-l-4 border-yellow-400 p-4 rounded-lg shadow-sm"
    >
      <div className="flex items-start">
        <div className="flex-shrink-0">
          <svg
            className="h-5 w-5 text-yellow-400"
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path
              fillRule="evenodd"
              d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
              clipRule="evenodd"
            />
          </svg>
        </div>
        <div className="ml-3 flex-1">
          <h3 className="text-sm font-medium text-yellow-800">
            Móviles sin datos GPS ({movilesSinGPS.length})
          </h3>
          <div className="mt-2 text-sm text-yellow-700">
            <p className="mb-2">
              Los siguientes móviles no tienen reportes GPS para la fecha seleccionada:
            </p>
            <ul className="list-disc list-inside space-y-1">
              {movilesSinGPS.map((movil) => (
                <li key={movil.id} className="flex items-center gap-2">
                  <span
                    className="inline-block w-3 h-3 rounded-full"
                    style={{ backgroundColor: movil.color }}
                  />
                  <span className="font-medium">{movil.name}</span>
                  <span className="text-xs text-gray-500">(ID: {movil.id})</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-yellow-600">
              💡 Estos móviles podrían:
              <br />
              • No haber reportado posición hoy
              <br />
              • Tener la app móvil apagada
              <br />
              • Estar fuera de cobertura
              <br />• No estar operativos
            </p>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
