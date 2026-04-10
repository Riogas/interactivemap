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
  allowedEmpresas: number[] | null; // null = root/sin restricción, array = IDs permitidos
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

  // ⏰ Duración máxima de sesión: 8 horas (en milisegundos)
  const SESSION_MAX_AGE_MS = 8 * 60 * 60 * 1000;

  /** Verificar si la sesión ha expirado por tiempo */
  const isSessionExpired = (loginTime: string | undefined): boolean => {
    if (!loginTime) return true;
    const elapsed = Date.now() - new Date(loginTime).getTime();
    return elapsed > SESSION_MAX_AGE_MS;
  };

  /** Limpiar sesión expirada de localStorage */
  const clearExpiredSession = () => {
    console.log('⏰ Sesión expirada (>8h) — cerrando sesión automáticamente');
    localStorage.removeItem('trackmovil_user');
    localStorage.removeItem('trackmovil_token');
    localStorage.removeItem('trackmovil_allowed_empresas');
    setUser(null);
  };

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

        // ⏰ Verificar expiración de sesión (8 horas)
        if (isSessionExpired(parsedUser.loginTime)) {
          clearExpiredSession();
          setIsLoading(false);
          return;
        }
        
        // Cargar empresas permitidas desde localStorage
        const savedEmpresas = localStorage.getItem('trackmovil_allowed_empresas');
        let allowedEmpresas: number[] | null = null;
        if (savedEmpresas) {
          try {
            allowedEmpresas = JSON.parse(savedEmpresas);
          } catch (e) {
            console.warn('⚠️ Error parsing allowed empresas:', e);
          }
        }
        
        setUser({
          ...parsedUser,
          token: savedToken,
          allowedEmpresas,
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

  // ⏰ Chequeo periódico: expirar sesión mientras la app está abierta
  useEffect(() => {
    if (!user?.loginTime) return;

    const checkExpiration = () => {
      if (isSessionExpired(user.loginTime)) {
        clearExpiredSession();
      }
    };

    // Verificar cada 5 minutos
    const intervalId = setInterval(checkExpiration, 5 * 60 * 1000);
    return () => clearInterval(intervalId);
  }, [user?.loginTime]);

  const login = async (username: string, password: string): Promise<{ success: boolean; error?: string }> => {
    try {
      console.log('🔐 Iniciando login en GeneXus...');
      const response: ParsedLoginResponse = await authService.login(username, password);
      
      // El login es exitoso SOLO si success=true Y viene el objeto user
      if (response.success && response.user && response.user.id && response.user.username) {
        console.log('✅ Login GeneXus exitoso');
        
        const isRoot = response.user.isRoot === 'S';
        
        // 🔑 Si NO es root, obtener empresas permitidas de getAtributos
        let allowedEmpresas: number[] | null = null;
        if (!isRoot) {
          try {
            console.log('🔑 Usuario no es root, obteniendo atributos...');
            const attrResponse = await fetch('/api/user-atributos', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${response.token}`,
              },
              body: JSON.stringify({ User: username }),
            });
            
            if (attrResponse.ok) {
              const attrData = await attrResponse.json();
              if (attrData.success && attrData.allowedEmpresas) {
                allowedEmpresas = attrData.allowedEmpresas.map((e: { id: number }) => e.id);
                console.log(`✅ Empresas permitidas: ${allowedEmpresas?.join(', ')}`);
                localStorage.setItem('trackmovil_allowed_empresas', JSON.stringify(allowedEmpresas));
              } else {
                console.warn('⚠️ No se obtuvieron empresas del atributo, cargando todas');
                localStorage.removeItem('trackmovil_allowed_empresas');
              }
            } else {
              console.warn('⚠️ Error obteniendo atributos, cargando todas las empresas');
              localStorage.removeItem('trackmovil_allowed_empresas');
            }
          } catch (attrError) {
            console.warn('⚠️ Error obteniendo atributos:', attrError);
            localStorage.removeItem('trackmovil_allowed_empresas');
          }
        } else {
          console.log('👑 Usuario root - acceso a todas las empresas');
          localStorage.removeItem('trackmovil_allowed_empresas');
        }
        
        const newUser: User = {
          id: response.user.id,
          username: response.user.username,
          email: response.user.email || '',
          nombre: response.user.nombre || response.user.username,
          isRoot: response.user.isRoot || 'N',
          roles: response.user.roles || [],
          loginTime: new Date().toISOString(),
          token: response.token,
          allowedEmpresas,
        };
        
        // 🔄 SINCRONIZAR CON SUPABASE
        console.log('🔄 Sincronizando sesión con Supabase...');
        try {
          const syncResponse = await fetch('/api/auth/sync-session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              token: response.token,
              user: newUser,
            }),
          });

          if (!syncResponse.ok) {
            const errorData = await syncResponse.json();
            console.warn('⚠️ No se pudo sincronizar sesión con Supabase:', errorData);
            // No fallar el login si Supabase falla - permitir continuar
          } else {
            const syncData = await syncResponse.json();
            console.log('✅ Sesión sincronizada con Supabase exitosamente');
            console.log('   User ID:', syncData.supabase_session?.user_id);
          }
        } catch (syncError) {
          console.warn('⚠️ Error sincronizando sesión con Supabase:', syncError);
          // No fallar el login si Supabase falla - permitir continuar
        }
        
        // Guardar en localStorage el newUser completo (incluye loginTime para validar expiración en F5)
        localStorage.setItem('trackmovil_user', JSON.stringify(newUser));
        localStorage.setItem('trackmovil_token', newUser.token);

        setUser(newUser);
        return { success: true };
      } else if (response.success && !response.user) {
        // Si success=true pero no hay usuario, es credencial inválida
        console.log('❌ Login falló: no hay datos de usuario');
        return { 
          success: false, 
          error: 'Usuario o contraseña incorrectos' 
        };
      } else {
        console.log('❌ Login falló:', response.message);
        return { 
          success: false, 
          error: response.message || 'Usuario o contraseña incorrectos' 
        };
      }
    } catch (error) {
      console.error('❌ Error en login:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Error de conexión con el servidor' 
      };
    }
  };

  const logout = async () => {
    console.log('🚪 Cerrando sesión...');
    
    // 1. Cerrar sesión de Supabase
    try {
      console.log('🔐 Cerrando sesión de Supabase...');
      const response = await fetch('/api/auth/logout', {
        method: 'POST',
      });
      
      if (response.ok) {
        console.log('✅ Sesión de Supabase cerrada');
      } else {
        console.warn('⚠️ No se pudo cerrar sesión de Supabase');
      }
    } catch (error) {
      console.warn('⚠️ Error cerrando sesión de Supabase:', error);
    }
    
    // 2. Cerrar sesión local (GeneXus)
    console.log('🔐 Limpiando sesión local...');
    setUser(null);
    authService.logout();
    localStorage.removeItem('trackmovil_allowed_empresas');
    console.log('✅ Sesión cerrada completamente');
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
