import axios, { AxiosInstance } from 'axios';
import { PROXY_BASE_URL } from './config';
import { authStorage } from '@/lib/auth-storage';

// URL base de la API - Ahora usa el proxy de Next.js para evitar CORS
const API_BASE_URL = PROXY_BASE_URL;

// Interfaz para la respuesta de login
interface LoginResponse {
  RespuestaLogin: string; // JSON string que contiene la respuesta real
}

// Interfaz para el contenido parseado de RespuestaLogin
interface ParsedLoginResponse {
  expiresIn: string;
  message: string;
  requireIdentity: boolean;
  success: boolean;
  token: string;
  user?: {  // Ahora es opcional porque a veces no viene en la respuesta
    email: string;
    id: string;
    isRoot: string;
    nombre: string;
    username: string;
  };
  roles?: Array<{
    rolId: number;
    rolNombre: string;
    aplicacionId: number;
    funcionalidades: Array<{
      funcionalidadId: number;
      nombre: string;
    }>;
    /** Atributos del rol — incluye HistoricoMaxCoords, HistoricoMaxPedidos y Escenario */
    atributos?: Array<{
      atributo: string;
      valor: string;
    }>;
  }>;
  preferencias?: Array<{
    atributo: string;
    valor: string;
  }>;
  accesos?: unknown[];
  verifiedBy: string;
}

// Interfaz para las credenciales de login
interface LoginCredentials {
  UserName: string;
  Password: string;
  EscenarioId?: number;
  Sistema?: string;
}

// Crear instancia de axios con configuración base
const apiClient: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 10000, // 10 segundos
});

// Interceptor para agregar el token a las peticiones si existe
apiClient.interceptors.request.use(
  (config) => {
    const token = authStorage.getItem('trackmovil_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Interceptor para manejar respuestas y errores
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Token expirado o inválido
      authStorage.removeItem('trackmovil_token');
      authStorage.removeItem('trackmovil_user');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

/**
 * Servicio de autenticación
 */
export const authService = {
  /**
   * Login de usuario
   * @param username - Nombre de usuario
   * @param password - Contraseña
   * @param escenarioId - ID del escenario seleccionado (opcional, default omitido para que runLoginSecurity use null)
   * @returns Datos del usuario y token
   */
  login: async (username: string, password: string, escenarioId?: number): Promise<ParsedLoginResponse> => {
    try {
      const credentials: LoginCredentials = {
        UserName: username,
        Password: password,
        ...(escenarioId !== undefined ? { EscenarioId: escenarioId } : {}),
      };

      // Llamar al nuevo endpoint de login (secapi.riogas.com.uy)
      const response = await axios.post<ParsedLoginResponse>(
        '/api/auth/login',
        credentials
      );

      // La ruta /api/auth/login ya maneja el parseo de RespuestaLogin si aplica
      const parsedResponse: ParsedLoginResponse = response.data;

      if (!parsedResponse.success) {
        throw new Error(parsedResponse.message || 'Error en el login');
      }

      // Solo guardar si hay usuario válido
      if (parsedResponse.user && parsedResponse.user.id && parsedResponse.user.username) {
        // Guardar token y datos de usuario en localStorage
        authStorage.setItem('trackmovil_token', parsedResponse.token);
        authStorage.setItem('trackmovil_user', JSON.stringify(parsedResponse.user));
      } else {
        // Si no hay usuario, no guardar nada
        console.warn('⚠️ Login success=true pero sin datos de usuario. Considerando como login inválido.');
      }

      return parsedResponse;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(
          error.response?.data?.message ||
          'Error de conexión con el servidor'
        );
      }
      throw error;
    }
  },

  /**
   * Logout de usuario
   */
  logout: () => {
    authStorage.removeItem('trackmovil_token');
    authStorage.removeItem('trackmovil_user');
  },

  /**
   * Obtener usuario actual del localStorage
   */
  getCurrentUser: (): ParsedLoginResponse['user'] | null => {
    const userJson = authStorage.getItem('trackmovil_user');
    if (!userJson) return null;

    try {
      return JSON.parse(userJson);
    } catch {
      return null;
    }
  },

  /**
   * Obtener token actual del localStorage
   */
  getToken: (): string | null => {
    return authStorage.getItem('trackmovil_token');
  },

  /**
   * Verificar si el usuario está autenticado
   */
  isAuthenticated: (): boolean => {
    return !!authStorage.getItem('trackmovil_token');
  },
};

/**
 * Cliente API genérico para otras peticiones
 */
export { apiClient };

/**
 * Tipos exportados
 */
export type { LoginCredentials, LoginResponse, ParsedLoginResponse };
