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
  allowedEscenarios: number[] | null; // null = root/sin restricción, array = IDs permitidos
}

type PreferenciaEntry = { nombre: string; valor: number };

function parsePreferencia(
  prefs: Array<{ atributo: string; valor: string }> | undefined,
  atributo: string
): PreferenciaEntry[] {
  if (!Array.isArray(prefs)) return [];
  const p = prefs.find((x) => x.atributo === atributo);
  if (!p?.valor) return [];
  try {
    const parsed = JSON.parse(p.valor);

    // Formato A (array): [{ Nombre: "...", Valor: 70 }, ...]
    if (Array.isArray(parsed)) {
      return parsed
        .map((x: { Nombre?: string; Valor?: number | string }) => ({
          nombre: String(x.Nombre ?? ''),
          valor: Number(x.Valor),
        }))
        .filter((x) => Number.isFinite(x.valor));
    }

    // Formato B (objeto): { "Nombre1": "70", "Nombre2": "80" }
    // El Security Suite devuelve este shape para algunos usuarios.
    if (parsed && typeof parsed === 'object') {
      return Object.entries(parsed as Record<string, unknown>)
        .map(([nombre, valor]) => ({
          nombre,
          valor: Number(valor),
        }))
        .filter((x) => Number.isFinite(x.valor));
    }

    return [];
  } catch (e) {
    console.warn(`⚠️ Error parseando preferencia "${atributo}":`, e);
    return [];
  }
}

interface AuthContextType {
  user: User | null;
  escenarioId: number;
  login: (username: string, password: string, escenarioId?: number) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [escenarioId, setEscenarioId] = useState<number>(1000);
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
    localStorage.removeItem('trackmovil_allowed_escenarios');
    setUser(null);
  };

  // Limpieza proactiva de cookies legacy de Supabase (sb-*-auth-token).
  // Antes usábamos sync-session con anonymous sign-ins; eso dejaba cookies
  // que ahora pueden estar expiradas y hacer que Realtime quede colgado.
  // Como ya no sincronizamos sesión con Supabase, estas cookies no sirven
  // para nada y conviene borrarlas al arranque.
  useEffect(() => {
    try {
      const cookies = document.cookie.split(';');
      for (const c of cookies) {
        const name = c.split('=')[0].trim();
        if (name.startsWith('sb-') && name.endsWith('-auth-token')) {
          document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
          document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=${window.location.hostname}`;
        }
      }
    } catch {
      // no-op: cookies HttpOnly no se pueden limpiar client-side
    }
  }, []);

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

        // Cargar escenarios permitidos desde localStorage
        const savedEscenarios = localStorage.getItem('trackmovil_allowed_escenarios');
        let allowedEscenarios: number[] | null = null;
        if (savedEscenarios) {
          try {
            allowedEscenarios = JSON.parse(savedEscenarios);
          } catch (e) {
            console.warn('⚠️ Error parsing allowed escenarios:', e);
          }
        }

        // Cargar escenario persistido
        const savedEscenario = localStorage.getItem('trackmovil_escenario_id');
        if (savedEscenario) setEscenarioId(parseInt(savedEscenario, 10));

        setUser({
          ...parsedUser,
          token: savedToken,
          allowedEmpresas,
          allowedEscenarios,
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

  const login = async (username: string, password: string, selectedEscenarioId: number = 1000): Promise<{ success: boolean; error?: string }> => {
    try {
      console.log('🔐 Iniciando login en GeneXus...');
      const response: ParsedLoginResponse = await authService.login(username, password);
      
      // El login es exitoso SOLO si success=true Y viene el objeto user
      if (response.success && response.user && response.user.id && response.user.username) {
        console.log('✅ Login GeneXus exitoso');

        const isRoot = response.user.isRoot === 'S';

        // 🔑 Parsear preferencias del response (nuevo formato SecuritySuite)
        const empFleteras = parsePreferencia(response.preferencias, 'EmpFletera');
        const escenarios = parsePreferencia(response.preferencias, 'Escenario');

        let allowedEmpresas: number[] | null = null;
        let allowedEscenarios: number[] | null = null;

        // Rol Despacho: trato igual a root (acceso completo, sin restricción de
        // escenarios ni empresas). El rol viene de SecuritySuite via el flag
        // isDespacho del LDAP/AS400, materializado en response.roles cuando se
        // ejecuta el upsert correspondiente en PG.
        //
        // Detección robusta: chequea rolId === 49 (DESPACHO_ROL_ID por convención)
        // OR que el nombre contenga 'despacho' (matchea 'Despacho', 'DESPACHO',
        // 'Despacho Móvil', etc.). lib/auth-scope.ts usa el mismo criterio.
        const tieneRolDespacho = (response.roles || []).some((r) => {
          if (Number(r.rolId) === 49) return true;
          const nombre = String(r.rolNombre || '').trim().toLowerCase();
          return nombre.includes('despacho');
        });

        if (isRoot || tieneRolDespacho) {
          console.log(
            isRoot
              ? '👑 Usuario root - acceso a todas las empresas y escenarios'
              : '🚪 Rol Despacho - acceso completo (mismo trato que root)',
          );
          localStorage.removeItem('trackmovil_allowed_empresas');
          localStorage.removeItem('trackmovil_allowed_escenarios');
        } else {
          // Validar escenarios: debe tener al menos uno y el del login debe matchear
          if (escenarios.length === 0) {
            console.log('❌ Login bloqueado: usuario no-root/no-despacho sin escenarios asignados');
            return {
              success: false,
              error: 'El usuario no tiene escenarios asignados. Contacte al administrador.',
            };
          }

          allowedEscenarios = escenarios.map((e) => e.valor);
          if (!allowedEscenarios.includes(selectedEscenarioId)) {
            console.log(`❌ Login bloqueado: escenario ${selectedEscenarioId} no está en los permitidos [${allowedEscenarios.join(', ')}]`);
            return {
              success: false,
              error: 'No tiene acceso al escenario seleccionado.',
            };
          }

          allowedEmpresas = empFleteras.map((e) => e.valor);
          console.log(`✅ Empresas permitidas: ${allowedEmpresas.join(', ') || '(ninguna)'}`);
          console.log(`✅ Escenarios permitidos: ${allowedEscenarios.join(', ')}`);
          localStorage.setItem('trackmovil_allowed_empresas', JSON.stringify(allowedEmpresas));
          localStorage.setItem('trackmovil_allowed_escenarios', JSON.stringify(allowedEscenarios));
        }

        // Mapear roles del shape nuevo (rolId, rolNombre, aplicacionId, funcionalidades)
        // al shape viejo (RolId, RolNombre, RolTipo) que espera el consumo downstream
        // (componentes/hooks que leen user.roles).
        const mappedRoles = (response.roles || []).map((r) => ({
          RolId: String(r.rolId),
          RolNombre: r.rolNombre,
          RolTipo: '',
        }));

        const newUser: User = {
          id: response.user.id,
          username: response.user.username,
          email: response.user.email || '',
          nombre: response.user.nombre || response.user.username,
          isRoot: response.user.isRoot || 'N',
          roles: mappedRoles,
          loginTime: new Date().toISOString(),
          token: response.token,
          allowedEmpresas,
          allowedEscenarios,
        };

        // Guardar en localStorage el newUser completo (incluye loginTime para validar expiración en F5)
        localStorage.setItem('trackmovil_user', JSON.stringify(newUser));
        localStorage.setItem('trackmovil_token', newUser.token);
        localStorage.setItem('trackmovil_escenario_id', String(selectedEscenarioId));

        setUser(newUser);
        setEscenarioId(selectedEscenarioId);
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

    // 1. Limpiar cookies residuales de Supabase (por si hay alguna HttpOnly).
    //    El endpoint hace Set-Cookie con Max-Age=0 desde el server.
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // no-op: si falla, seguimos con el logout local
    }

    // 2. Cerrar sesión local (GeneXus)
    console.log('🔐 Limpiando sesión local...');
    setUser(null);
    authService.logout();
    localStorage.removeItem('trackmovil_allowed_empresas');
    localStorage.removeItem('trackmovil_allowed_escenarios');
    localStorage.removeItem('trackmovil_escenario_id');
    setEscenarioId(1000);
    console.log('✅ Sesión cerrada completamente');
  };

  const value = {
    user,
    escenarioId,
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
