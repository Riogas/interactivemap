'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { isRoot } from '@/lib/auth-scope';

/**
 * Layout guard del portal de documentación de APIs.
 *
 * ⚠ ESTO NO ES SEGURIDAD. Este archivo es 'use client': corre en el navegador, con
 * datos que el navegador controla (`useAuth` lee el usuario de sessionStorage). Se
 * puede saltear con las devtools abiertas en treinta segundos. Es UX — evitar que un
 * no-root llegue a una pantalla que no le sirve — y nada más.
 *
 * El gate REAL es server-side y está en GET /api/docs/spec (lib/docs/root-guard.ts:
 * firma del JWT verificada con JWT_SECRET + consulta a SecuritySuite, fail-closed).
 * Y alcanza con eso porque **la página no tiene catálogo propio**: todo lo que muestra
 * se lo pide a ese endpoint. Quien fuerce este guard desde el navegador ve el cascarón
 * vacío y un 401/403.
 *
 * Corolario para el que venga después: si algún día esta página trae contenido que no
 * pase por /api/docs/spec (aunque sea una lista de paths hardcodeada), este guard deja
 * de alcanzar y hay que mover el gate al servidor. No agregues datos sensibles acá
 * confiando en este `if`.
 *
 * Por qué el guard de la página no es server-side hoy: el JWT de SecuritySuite vive en
 * sessionStorage (lib/auth-storage.ts), no en una cookie, así que un Server Component
 * no lo ve. Cambiar dónde se guarda el token es tocar la autenticación de toda la app
 * y queda fuera de esta fase.
 */
export default function DocsLayout({ children }: { children: React.ReactNode }) {
  const { user, isAuthenticated } = useAuth();
  const router = useRouter();

  // Cosmético: el dato sale del cliente. La autorización de verdad la hace el servidor
  // en /api/docs/spec (ver el docblock de arriba).
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
