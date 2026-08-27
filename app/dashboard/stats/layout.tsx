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
    // Sin sesión → al login, ACÁ MISMO.
    //
    // No es "todavía cargando": el AuthProvider no renderiza a sus hijos hasta
    // terminar de rehidratar (contexts/AuthContext.tsx, `if (isLoading) return
    // <spinner>`), así que si este layout llegó a montarse el auth ya está
    // resuelto y `!isAuthenticated` significa que no hay sesión (o que la
    // acaban de cerrar por token rechazado).
    //
    // Antes esto devolvía un spinner y NO renderizaba children, de modo que el
    // <ProtectedRoute> que redirige al login —que vive debajo, adentro de
    // page.tsx— nunca se montaba: la pantalla de pared quedaba en spinner
    // infinito, sin cartel y sin salida. Por eso el redirect se hace en el
    // layout, que es quien corta el árbol.
    if (!isAuthenticated) {
      router.replace('/login');
      return;
    }
    if (!canAccess) {
      router.replace('/dashboard');
    }
  }, [isAuthenticated, canAccess, router]);

  // Sin sesión: cartel legible (no un spinner) mientras se procesa el redirect.
  // En un kiosko de pared el toast ya se fue y no hay nadie mirando; el cartel
  // tiene que explicarse solo.
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
