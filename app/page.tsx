'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { resolveLandingRoute } from '@/lib/role-attributes';

export default function Home() {
  const router = useRouter();
  const { isAuthenticated, user } = useAuth();

  useEffect(() => {
    if (isAuthenticated) {
      router.push(resolveLandingRoute(user));
    } else {
      router.push('/login');
    }
  }, [isAuthenticated, user, router]);

  return (
    <div className="h-full w-full flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">
      <div className="text-center">
        <div className="animate-spin rounded-full h-16 w-16 border-t-4 border-b-4 border-blue-600 mx-auto mb-4"></div>
        <p className="text-gray-600 text-lg">Cargando TrackMovil...</p>
      </div>
    </div>
  );
}
