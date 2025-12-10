'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { authService, ParsedLoginResponse } from '@/lib/api/auth';

interface User {
  id: string;
  username: string;
  email: string;
  nombre: string;
  isRoot: string;
  roles: Array<{
    RolId: string;
    RolNombre: string;
    RolTipo: string;
  }>;
  loginTime: string;
  token: string;
}

interface AuthContextType {
  user: User | null;
  login: (username: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Cargar sesión desde localStorage al iniciar
  useEffect(() => {
    const savedUser = localStorage.getItem('trackmovil_user');
    const savedToken = localStorage.getItem('trackmovil_token');
    
    if (savedUser && savedToken) {
      try {
        // Validar que savedUser sea JSON válido
        if (!savedUser.startsWith('{')) {
          throw new Error('Invalid user data format');
        }
        
        const parsedUser = JSON.parse(savedUser);
        
        // Validar que tenga campos mínimos requeridos
        if (!parsedUser.username || !parsedUser.id) {
          throw new Error('Invalid user data structure');
        }
        
        setUser({
          ...parsedUser,
          token: savedToken,
        });
      } catch (e) {
        console.error('Error al cargar sesión, limpiando localStorage:', e);
        // Limpiar datos corruptos
        localStorage.removeItem('trackmovil_user');
        localStorage.removeItem('trackmovil_token');
      }
    }
    setIsLoading(false);
  }, []);

  const login = async (username: string, password: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const response: ParsedLoginResponse = await authService.login(username, password);
      
      // El login es exitoso SOLO si success=true Y viene el objeto user
      if (response.success && response.user && response.user.id && response.user.username) {
        const newUser: User = {
          id: response.user.id,
          username: response.user.username,
          email: response.user.email || '',
          nombre: response.user.nombre || response.user.username,
          isRoot: response.user.isRoot || 'N',
          roles: response.user.roles || [],
          loginTime: new Date().toISOString(),
          token: response.token,
        };
        
        setUser(newUser);
        return { success: true };
      } else if (response.success && !response.user) {
        // Si success=true pero no hay usuario, es credencial inválida
        return { 
          success: false, 
          error: 'Usuario o contraseña incorrectos' 
        };
      } else {
        return { 
          success: false, 
          error: response.message || 'Usuario o contraseña incorrectos' 
        };
      }
    } catch (error) {
      console.error('Error en login:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Error de conexión con el servidor' 
      };
    }
  };

  const logout = () => {
    setUser(null);
    authService.logout();
  };

  const value = {
    user,
    login,
    logout,
    isAuthenticated: !!user,
  };

  if (isLoading) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">
        <div className="animate-spin rounded-full h-16 w-16 border-t-4 border-b-4 border-blue-600"></div>
      </div>
    );
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth debe ser usado dentro de un AuthProvider');
  }
  return context;
}
