/** @type {import('next').NextConfig} */
const nextConfig = {
  // ✅ IMPORTANTE: Necesario para Docker
  output: 'standalone',
  
  // Type-checking habilitado en build de producción
  typescript: {
    ignoreBuildErrors: false,
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

  // Excluir directorios de runtime que no deben ser traceados en el bundle
  // (evita el warning "The file pattern '/ROOT/failed-batches' matches N files")
  outputFileTracingExcludes: {
    '*': ['failed-batches/**', 'logs/**', 'tmp/**'],
  },

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
