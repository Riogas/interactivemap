import { apiClient } from './auth';

/**
 * Ejemplo de servicio para otras APIs
 * Puedes crear servicios similares para diferentes módulos
 */

// ============================================
// EJEMPLO: Servicio de Vehículos/Móviles
// ============================================

interface Movil {
  id: number;
  nombre: string;
  // ... otros campos
}

export const movilService = {
  /**
   * Obtener todos los móviles
   */
  getAll: async (): Promise<Movil[]> => {
    const response = await apiClient.get('/puestos/gestion/moviles');
    return response.data;
  },

  /**
   * Obtener un móvil por ID
   */
  getById: async (id: number): Promise<Movil> => {
    const response = await apiClient.get(`/puestos/gestion/moviles/${id}`);
    return response.data;
  },

  /**
   * Crear un nuevo móvil
   */
  create: async (data: Partial<Movil>): Promise<Movil> => {
    const response = await apiClient.post('/puestos/gestion/moviles', data);
    return response.data;
  },

  /**
   * Actualizar un móvil
   */
  update: async (id: number, data: Partial<Movil>): Promise<Movil> => {
    const response = await apiClient.put(`/puestos/gestion/moviles/${id}`, data);
    return response.data;
  },

  /**
   * Eliminar un móvil
   */
  delete: async (id: number): Promise<void> => {
    await apiClient.delete(`/puestos/gestion/moviles/${id}`);
  },
};

// ============================================
// EJEMPLO: Servicio de Pedidos
// ============================================

interface Pedido {
  id: number;
  movilId: number;
  // ... otros campos
}

export const pedidoService = {
  /**
   * Obtener pedidos por móvil
   */
  getByMovil: async (movilId: number): Promise<Pedido[]> => {
    const response = await apiClient.get(`/puestos/gestion/pedidos/movil/${movilId}`);
    return response.data;
  },

  /**
   * Obtener pedidos pendientes
   */
  getPendientes: async (movilId: number): Promise<Pedido[]> => {
    const response = await apiClient.get(`/puestos/gestion/pedidos/pendientes/${movilId}`);
    return response.data;
  },

  /**
   * Crear un pedido
   */
  create: async (data: Partial<Pedido>): Promise<Pedido> => {
    const response = await apiClient.post('/puestos/gestion/pedidos', data);
    return response.data;
  },
};

// ============================================
// EJEMPLO: Servicio de GPS/Coordenadas
// ============================================

interface Coordenada {
  lat: number;
  lng: number;
  timestamp: string;
  // ... otros campos
}

export const gpsService = {
  /**
   * Obtener última posición de un móvil
   */
  getLatestPosition: async (movilId: number): Promise<Coordenada> => {
    const response = await apiClient.get(`/puestos/gestion/gps/latest/${movilId}`);
    return response.data;
  },

  /**
   * Obtener historial de posiciones
   */
  getHistory: async (
    movilId: number, 
    startDate: string, 
    endDate: string
  ): Promise<Coordenada[]> => {
    const response = await apiClient.get(`/puestos/gestion/gps/history/${movilId}`, {
      params: { startDate, endDate }
    });
    return response.data;
  },
};

// ============================================
// EJEMPLO: Servicio de Empresas Fleteras
// ============================================

interface EmpresaFletera {
  id: number;
  nombre: string;
  // ... otros campos
}

export const empresaService = {
  /**
   * Obtener todas las empresas fleteras
   */
  getAll: async (): Promise<EmpresaFletera[]> => {
    const response = await apiClient.get('/puestos/gestion/empresas');
    return response.data;
  },

  /**
   * Obtener empresa por ID
   */
  getById: async (id: number): Promise<EmpresaFletera> => {
    const response = await apiClient.get(`/puestos/gestion/empresas/${id}`);
    return response.data;
  },
};

// ============================================
// EJEMPLO: Manejo de Errores Personalizado
// ============================================

/**
 * Wrapper para manejar errores de manera consistente
 */
export const handleApiError = (error: any): string => {
  if (error.response) {
    // Error de respuesta del servidor
    return error.response.data?.message || 'Error en el servidor';
  } else if (error.request) {
    // No se recibió respuesta
    return 'No se pudo conectar con el servidor';
  } else {
    // Error al configurar la petición
    return error.message || 'Error desconocido';
  }
};

// ============================================
// EJEMPLO DE USO EN COMPONENTES
// ============================================

/*

// En un componente React:

import { movilService, handleApiError } from '@/lib/api/services';

const MiComponente = () => {
  const [moviles, setMoviles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const fetchMoviles = async () => {
    setLoading(true);
    setError('');
    
    try {
      const data = await movilService.getAll();
      setMoviles(data);
    } catch (err) {
      setError(handleApiError(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMoviles();
  }, []);

  if (loading) return <div>Cargando...</div>;
  if (error) return <div>Error: {error}</div>;

  return (
    <div>
      {moviles.map(movil => (
        <div key={movil.id}>{movil.nombre}</div>
      ))}
    </div>
  );
};

*/

// ============================================
// EJEMPLO: Servicio con Parámetros Complejos
// ============================================

export const reporteService = {
  /**
   * Obtener reporte con múltiples filtros
   */
  getReporte: async (params: {
    empresaId?: number;
    fechaInicio: string;
    fechaFin: string;
    tipo?: 'completo' | 'resumido';
    incluirInactivos?: boolean;
  }) => {
    const response = await apiClient.get('/puestos/gestion/reportes', {
      params
    });
    return response.data;
  },

  /**
   * Descargar reporte en PDF
   */
  downloadPDF: async (reporteId: number): Promise<Blob> => {
    const response = await apiClient.get(`/puestos/gestion/reportes/${reporteId}/pdf`, {
      responseType: 'blob'
    });
    return response.data;
  },
};

// ============================================
// EJEMPLO: Servicio con FormData (Subir Archivos)
// ============================================

export const fileService = {
  /**
   * Subir archivo
   */
  upload: async (file: File, tipo: string): Promise<{ url: string }> => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('tipo', tipo);

    const response = await apiClient.post('/puestos/gestion/files/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return response.data;
  },
};
