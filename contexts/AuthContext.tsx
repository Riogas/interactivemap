'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { authService, ParsedLoginResponse } from '@/lib/api/auth';
import { authStorage } from '@/lib/auth-storage';

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
    /** Atributos del rol propagados desde el SecuritySuite (HistoricoMaxCoords, HistoricoMaxPedidos, Escenario, etc.) */
    atributos?: Array<{ atributo: string; valor: string }>;
    /** Funcionalidades del rol — usado por gates de UI tipo "Capa Capacidad de Entrega". */
    funcionalidades?: Array<{ funcionalidadId: number; nombre: string }>;
  }>;
  loginTime: string;
  token: string;
  allowedEmpresas: number[] | null; // null = root/sin restricción, array = IDs permitidos
  allowedEscenarios: number[] | null; // null = root/sin restricción, array = IDs permitidos
  /** True si EmpFletera = {"TODAS":"*"} → ve todas las empresas (reemplaza el hardcodeo de roles). */
  verTodasEmpresas: boolean;
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

/**
 * Detecta si el usuario tiene acceso a TODAS las empresas vía el atributo
 * `EmpFletera` con el valor especial {"TODAS":"*"} (o "*").
 *
 * Reemplaza el hardcodeo de roles privilegiados (48/49/50). Cualquier usuario
 * con este valor en EmpFletera ve todas las empresas, sin importar su rol.
 */
function tieneVerTodasEmpresas(
  prefs: Array<{ atributo: string; valor: string }> | undefined,
): boolean {
  if (!Array.isArray(prefs)) return false;
  const p = prefs.find((x) => x.atributo === 'EmpFletera');
  if (!p?.valor) return false;
  try {
    const parsed = JSON.parse(p.valor);
    if (parsed === '*') return true;
    if (parsed && typeof parsed === 'object') {
      // Acepta { "TODAS": "*" } (clave canónica) o cualquier valor "*".
      if (String((parsed as Record<string, unknown>).TODAS ?? '').trim() === '*') return true;
      return Object.values(parsed as Record<string, unknown>).some(
        (v) => String(v ?? '').trim() === '*',
      );
    }
    return false;
  } catch {
    return false;
  }
}

// Acciones de permisos consultadas al Security Suite
const PERMISOS_A_CONSULTAR = [
  { ObjetoKey: 'dashboard', AccionKey: 'stats' },
  { ObjetoKey: 'dashboard', AccionKey: 'date' },
  { ObjetoKey: 'dashboard', AccionKey: 'updptsventa' },
  { ObjetoKey: 'dashboard', AccionKey: 'asigmovil' },
  { ObjetoKey: 'dashboard', AccionKey: 'configzonaemp' },
  { ObjetoKey: 'dashboard', AccionKey: 'ranking' },
];

async function fetchPermisos(token: string): Promise<Set<string>> {
  try {
    const res = await fetch('/api/auth/permisos', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        aplicacion: 'RiogasTracking',
        permisos: PERMISOS_A_CONSULTAR,
      }),
    });

    if (!res.ok) {
      console.warn('⚠️ fetchPermisos: respuesta no OK', res.status);
      return new Set();
    }

    const data = await res.json();
    const granted = new Set<string>();

    if (Array.isArray(data.resultados)) {
      for (const r of data.resultados) {
        if (r.permitido === 'GRANTED') {
          granted.add(r.accionKey as string);
        }
      }
    }

    console.log('✅ Permisos cargados:', [...granted]);
    return granted;
  } catch (e) {
    console.warn('⚠️ Error al cargar permisos:', e);
    return new Set();
  }
}

interface AuthContextType {
  user: User | null;
  escenarioId: number;
  permisos: Set<string>;
  hasPermiso: (accionKey: string) => boolean;
  login: (username: string, password: string, escenarioId?: number) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [escenarioId, setEscenarioId] = useState<number>(1000);
  const [permisos, setPermisos] = useState<Set<string>>(new Set());
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
    authStorage.removeItem('trackmovil_user');
    authStorage.removeItem('trackmovil_token');
    authStorage.removeItem('trackmovil_allowed_empresas');
    authStorage.removeItem('trackmovil_allowed_escenarios');
    authStorage.removeItem('trackmovil_permisos');
    setUser(null);
    setPermisos(new Set());
  };

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
    const savedUser = authStorage.getItem('trackmovil_user');
    const savedToken = authStorage.getItem('trackmovil_token');

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
        const savedEmpresas = authStorage.getItem('trackmovil_allowed_empresas');
        let allowedEmpresas: number[] | null = null;
        if (savedEmpresas) {
          try {
            allowedEmpresas = JSON.parse(savedEmpresas);
          } catch (e) {
            console.warn('⚠️ Error parsing allowed empresas:', e);
          }
        }

        // Cargar escenarios permitidos desde localStorage
        const savedEscenarios = authStorage.getItem('trackmovil_allowed_escenarios');
        let allowedEscenarios: number[] | null = null;
        if (savedEscenarios) {
          try {
            allowedEscenarios = JSON.parse(savedEscenarios);
          } catch (e) {
            console.warn('⚠️ Error parsing allowed escenarios:', e);
          }
        }

        // Cargar escenario persistido
        const savedEscenario = authStorage.getItem('trackmovil_escenario_id');
        if (savedEscenario) setEscenarioId(parseInt(savedEscenario, 10));

        // Cargar permisos persistidos
        const savedPermisos = authStorage.getItem('trackmovil_permisos');
        if (savedPermisos) {
          try {
            const arr: string[] = JSON.parse(savedPermisos);
            setPermisos(new Set(arr));
          } catch {
            // ignore: se recargarán si el usuario hace algo
          }
        }

        setUser({
          ...parsedUser,
          token: savedToken,
          allowedEmpresas,
          allowedEscenarios,
        });
      } catch (e) {
        console.error('Error al cargar sesión, limpiando localStorage:', e);
        // Limpiar datos corruptos
        authStorage.removeItem('trackmovil_user');
        authStorage.removeItem('trackmovil_token');
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

  const login = async (username: string, password: string, selectedEscenarioId: number = 1000): Promise<{ success: boolean; error?: string; warning?: string }> => {
    try {
      console.log('🔐 Iniciando login en GeneXus...');
      const response: ParsedLoginResponse = await authService.login(username, password, selectedEscenarioId);

      // El login es exitoso SOLO si success=true Y viene el objeto user
      if (response.success && response.user && response.user.id && response.user.username) {
        console.log('✅ Login GeneXus exitoso');

        const isRoot = response.user.isRoot === 'S' ||
          (response.roles || []).some((r) => String(r.rolNombre ?? '').trim() === 'Root');

        // 🚪 Gate de funcionalidad "PermiteLogin": un usuario no-root debe tener
        // al menos un rol con una funcionalidad de nombre "PermiteLogin" para
        // poder entrar. Root pasa siempre (preferencia explicita del usuario).
        // Se chequea por NOMBRE de funcionalidad, no por id — el id puede variar
        // entre entornos pero el nombre es canonico desde el SecuritySuite.
        if (!isRoot) {
          const tienePermiteLogin = (response.roles || []).some((r) =>
            (r.funcionalidades || []).some(
              (f) => String(f?.nombre ?? '').trim() === 'PermiteLogin',
            ),
          );
          if (!tienePermiteLogin) {
            console.log('❌ Login bloqueado: usuario sin funcionalidad PermiteLogin');
            return {
              success: false,
              error: 'Usuario sin privilegios para acceder al sistema.',
            };
          }
        }

        // 🔑 Parsear preferencias del response (nuevo formato SecuritySuite)
        const empFleteras = parsePreferencia(response.preferencias, 'EmpFletera');
        const escenarios = parsePreferencia(response.preferencias, 'Escenario');

        let allowedEmpresas: number[] | null = null;
        let allowedEscenarios: number[] | null = null;

        // Acceso total a empresas/escenarios: data-driven vía EmpFletera {"TODAS":"*"}.
        // Reemplaza el hardcodeo de roles privilegiados (48/49/50). Un usuario con
        // este atributo se trata igual que root para el scope (empresas + escenarios).
        const verTodasEmpresas = tieneVerTodasEmpresas(response.preferencias);

        // 🚪 Gate de perfil completo: un usuario no-root DEBE tener el atributo
        // EmpFletera cargado (sea TODAS:* o un listado de empresas). Si no tiene
        // nada, su perfil está incompleto y no puede operar (todo el scope depende
        // de EmpFletera). Root queda exento (bypassa el scope).
        if (!isRoot && !verTodasEmpresas && empFleteras.length === 0) {
          console.log('❌ Login bloqueado: usuario sin atributo EmpFletera (perfil incompleto)');
          return {
            success: false,
            error: 'Perfil de usuario incompleto',
          };
        }

        if (isRoot || verTodasEmpresas) {
          console.log(
            isRoot
              ? '👑 Usuario root - acceso a todas las empresas y escenarios'
              : '🌐 EmpFletera TODAS:* - acceso completo a empresas y escenarios',
          );
          authStorage.removeItem('trackmovil_allowed_empresas');
          authStorage.removeItem('trackmovil_allowed_escenarios');
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
          authStorage.setItem('trackmovil_allowed_empresas', JSON.stringify(allowedEmpresas));
          authStorage.setItem('trackmovil_allowed_escenarios', JSON.stringify(allowedEscenarios));
        }

        // Mapear roles del shape nuevo (rolId, rolNombre, aplicacionId, funcionalidades, atributos)
        // al shape del User (RolId, RolNombre, RolTipo, atributos, funcionalidades).
        // Atributos y funcionalidades se propagan para que helpers downstream
        // (getMaxRoleAttribute, hasFuncionalidad) puedan consultarlos.
        const mappedRoles = (response.roles || []).map((r) => ({
          RolId: String(r.rolId),
          RolNombre: r.rolNombre,
          RolTipo: '',
          ...(r.atributos ? { atributos: r.atributos } : {}),
          ...(r.funcionalidades ? { funcionalidades: r.funcionalidades } : {}),
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
          verTodasEmpresas,
        };

        // Guardar en localStorage el newUser completo (incluye loginTime para validar expiración en F5)
        authStorage.setItem('trackmovil_user', JSON.stringify(newUser));
        authStorage.setItem('trackmovil_token', newUser.token);
        authStorage.setItem('trackmovil_escenario_id', String(selectedEscenarioId));

        // Cargar permisos del Security Suite
        const grantedPermisos = await fetchPermisos(newUser.token);
        setPermisos(grantedPermisos);
        authStorage.setItem('trackmovil_permisos', JSON.stringify([...grantedPermisos]));

        setUser(newUser);
        setEscenarioId(selectedEscenarioId);
        // Propagar warning del endpoint de seguridad (ej. USER_EQ_PASS) al consumidor
        const warning = (response as { warning?: string }).warning;
        return warning ? { success: true, warning } : { success: true };
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
    setPermisos(new Set());
    authService.logout();
    authStorage.removeItem('trackmovil_allowed_empresas');
    authStorage.removeItem('trackmovil_allowed_escenarios');
    authStorage.removeItem('trackmovil_escenario_id');
    authStorage.removeItem('trackmovil_permisos');
    // Limpiar fecha seleccionada de sessionStorage — al relogi debe arrancar en hoy.
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem('trackmovil:selectedDate');
      // Limpiar selecciones de móviles por fecha (trackmovil:selectedMoviles:<fecha>)
      const keysToRemove: string[] = [];
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (key && key.startsWith('trackmovil:selectedMoviles:')) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach(key => sessionStorage.removeItem(key));
    }
    setEscenarioId(1000);
    console.log('✅ Sesión cerrada completamente');
  };

  const hasPermiso = (accionKey: string): boolean => permisos.has(accionKey);

  const value = {
    user,
    escenarioId,
    permisos,
    hasPermiso,
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
