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
    // Esperar a que el contexto de auth esté resuelto antes de evaluar.
    if (!isAuthenticated) return;
    if (!canAccess) {
      router.replace('/dashboard');
    }
  }, [isAuthenticated, canAccess, router]);

  // Mientras el auth no está listo, mostrar spinner neutro.
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-stats-background dark:bg-gray-900">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-stats-info" />
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
