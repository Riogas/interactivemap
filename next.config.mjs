/** @type {import('next').NextConfig} */
const nextConfig = {
  // ✅ IMPORTANTE: Necesario para Docker
  output: 'standalone',
  
  // Deshabilitar type-checking en build de producción (Docker)
  typescript: {
    // ⚠️ ADVERTENCIA: Esto deshabilita type-checking en producción
    // Solo para build de Docker temporal
    ignoreBuildErrors: true,
  },
  
  // Permite importaciones de módulos externos
  serverExternalPackages: ['odbc'],
  
  // Configuración de Turbopack para Next.js 16
  turbopack: {
    // Configuración vacía para silenciar warning
    // Añade configuraciones específicas aquí si es necesario
  },
  
  // Configurar root de output para silenciar warning de múltiples lockfiles
  outputFileTracingRoot: process.cwd(),

  // 🔒 SECURITY HEADERS
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'X-Frame-Options',
            value: 'SAMEORIGIN',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(self)',
          },
          {
            key: 'X-DNS-Prefetch-Control',
            value: 'on',
          },
        ],
      },
    ];
  },
  
  // Evita warnings de Leaflet en SSR
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
      };
    }
    return config;
  },
};

export default nextConfig;
