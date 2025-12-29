import axios, { AxiosInstance } from 'axios';
import { PROXY_BASE_URL } from './config';

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
    roles: Array<{
      RolId: string;
      RolNombre: string;
      RolTipo: string;
    }>;
    username: string;
  };
  verifiedBy: string;
}

// Interfaz para las credenciales de login
interface LoginCredentials {
  UserName: string;
  Password: string;
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
    const token = localStorage.getItem('trackmovil_token');
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
      localStorage.removeItem('trackmovil_token');
      localStorage.removeItem('trackmovil_user');
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
   * @returns Datos del usuario y token
   */
  login: async (username: string, password: string): Promise<ParsedLoginResponse> => {
    try {
      const credentials: LoginCredentials = {
        UserName: username,
        Password: password,
      };

      const response = await apiClient.post<LoginResponse>(
        '/gestion/login',
        credentials
      );

      // La API devuelve un JSON string dentro de RespuestaLogin
      const parsedResponse: ParsedLoginResponse = JSON.parse(
        response.data.RespuestaLogin
      );

      if (!parsedResponse.success) {
        throw new Error(parsedResponse.message || 'Error en el login');
      }

      // Solo guardar si hay usuario válido
      if (parsedResponse.user && parsedResponse.user.id && parsedResponse.user.username) {
        // Guardar token y datos de usuario en localStorage
        localStorage.setItem('trackmovil_token', parsedResponse.token);
        localStorage.setItem('trackmovil_user', JSON.stringify(parsedResponse.user));
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
    localStorage.removeItem('trackmovil_token');
    localStorage.removeItem('trackmovil_user');
  },

  /**
   * Obtener usuario actual del localStorage
   */
  getCurrentUser: (): ParsedLoginResponse['user'] | null => {
    const userJson = localStorage.getItem('trackmovil_user');
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
    return localStorage.getItem('trackmovil_token');
  },

  /**
   * Verificar si el usuario está autenticado
   */
  isAuthenticated: (): boolean => {
    return !!localStorage.getItem('trackmovil_token');
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
