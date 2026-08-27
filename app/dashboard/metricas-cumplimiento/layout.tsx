'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { isRoot } from '@/lib/auth-scope';
import { hasFuncionalidad } from '@/lib/role-funcionalidades';

/**
 * Layout guard para /dashboard/metricas-cumplimiento.
 *
 * Protege contra acceso directo por URL a usuarios que no son root y no
 * tienen la funcionalidad 'Estadisticas Cumplimiento' (se da de alta en
 * SecuritySuite, fuera de alcance de este run — ver docs/METRICAS_CUMPLIMIENTO.md).
 *
 * Clon de app/dashboard/stats/layout.tsx (mismo patrón, distinta funcionalidad).
 * Se usa layout.tsx en vez de embeber el check en page.tsx para no acoplar
 * el guard a otros runs que puedan tocar la página en paralelo.
 */
export default function MetricasCumplimientoLayout({ children }: { children: React.ReactNode }) {
  const { user, isAuthenticated } = useAuth();
  const router = useRouter();

  const canAccess = isRoot(user) || hasFuncionalidad(user?.roles, 'Estadisticas Cumplimiento');

  useEffect(() => {
    // Sin sesión → al login, ACÁ MISMO. Mismo razonamiento que en
    // app/dashboard/stats/layout.tsx: el AuthProvider no renderiza children
    // mientras rehidrata, así que `!isAuthenticated` acá no es "cargando" sino
    // "no hay sesión". Devolver un spinner sin renderizar children dejaba al
    // <ProtectedRoute> de la page sin montar y el redirect no ocurría nunca.
    if (!isAuthenticated) {
      router.replace('/login');
      return;
    }
    if (!canAccess) {
      router.replace('/dashboard');
    }
  }, [isAuthenticated, canAccess, router]);

  // Sin sesión: cartel legible (no un spinner) mientras se procesa el redirect.
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-stats-background dark:bg-gray-900">
        <p className="text-stats-muted-fg dark:text-gray-400 text-sm">
          Tu sesión no está activa. Redirigiendo al inicio de sesión…
        </p>
      </div>
    );
  }

  // Sin acceso: no renderizar nada mientras el redirect se procesa.
  if (!canAccess) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-stats-background dark:bg-gray-900">
        <p className="text-stats-muted-fg dark:text-gray-400 text-sm">No tenés permiso para ver esta página.</p>
      </div>
    );
  }

  return <>{children}</>;
}
