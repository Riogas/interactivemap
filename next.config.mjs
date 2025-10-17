/** @type {import('next').NextConfig} */
const nextConfig = {
  // Permite importaciones de módulos externos
  serverExternalPackages: ['odbc'],
  
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
