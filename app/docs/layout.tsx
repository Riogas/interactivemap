'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { isRoot } from '@/lib/auth-scope';

/**
 * Layout guard del portal de documentación de APIs.
 *
 * Sigue el patrón de app/dashboard/stats/layout.tsx, pero con una diferencia que
 * importa: acá el guard de UI es SOLO cosmético. El gate real es server-side y vive
 * en GET /api/docs/spec (lib/docs/root-guard.ts, verificado contra SecuritySuite).
 * La página no tiene catálogo propio: todo lo que muestra se lo pide a ese endpoint,
 * así que alguien que fuerce este guard desde el navegador ve una pantalla vacía.
 *
 * Por qué el guard de la página no puede ser server-side: el JWT de SecuritySuite vive
 * en sessionStorage (lib/auth-storage.ts), no en una cookie, así que un Server
 * Component no lo ve. Cambiar dónde se guarda el token es tocar la autenticación de
 * toda la app y queda fuera de esta fase.
 */
export default function DocsLayout({ children }: { children: React.ReactNode }) {
  const { user, isAuthenticated } = useAuth();
  const router = useRouter();

  const puedeVer = isRoot(user);

  useEffect(() => {
    if (!isAuthenticated) return;
    if (!puedeVer) router.replace('/dashboard');
  }, [isAuthenticated, puedeVer, router]);

  if (!isAuthenticated) {
    return (
      <div className="h-full flex items-center justify-center bg-stats-background">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-stats-info" />
      </div>
    );
  }

  if (!puedeVer) {
    return (
      <div className="h-full flex items-center justify-center bg-stats-background">
        <p className="text-stats-muted-fg text-sm">No tenés permiso para ver esta página.</p>
      </div>
    );
  }

  return <>{children}</>;
}
