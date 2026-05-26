'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { isRoot } from '@/lib/auth-scope';
import { hasFuncionalidad } from '@/lib/role-funcionalidades';

/**
 * Layout guard para /dashboard/stats.
 *
 * Protege contra acceso directo por URL a usuarios que no tienen la
 * funcionalidad 'Estadistica Global RiogasTracking' y no son root.
 *
 * Se usa layout.tsx (en vez de editar stats/page.tsx) para evitar
 * conflictos con otros runs que tocan ese archivo en paralelo.
 */
export default function StatsLayout({ children }: { children: React.ReactNode }) {
  const { user, isAuthenticated } = useAuth();
  const router = useRouter();

  const canAccess = isRoot(user) || hasFuncionalidad(user?.roles, 'Estadistica Global RiogasTracking');

  useEffect(() => {
    // Esperar a que el contexto de auth esté resuelto antes de evaluar.
    // Si user es null pero isAuthenticated tampoco es true, aún está cargando.
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
