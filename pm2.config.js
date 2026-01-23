module.exports = {
  apps: [
    {
      name: 'track',
      script: 'node_modules/next/dist/bin/next',
      args: 'start',
      exec_mode: 'fork',           // Modo fork (una sola instancia)
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      min_uptime: '10s',           // Tiempo mínimo antes de considerar "iniciado"
      max_restarts: 50,            // Reintentos antes de rendirse (aumentado)
      restart_delay: 4000,         // Esperar 4s entre reinicios
      kill_timeout: 5000,          // Esperar 5s antes de forzar cierre
      listen_timeout: 5000,        // Timeout para que la app esté lista
      exp_backoff_restart_delay: 100, // Backoff exponencial en reinicios
      env: {
        NODE_ENV: 'production',
        PORT: 3002,
        HOSTNAME: '0.0.0.0',
        NODE_TLS_REJECT_UNAUTHORIZED: '0',  // Ignorar errores de certificado SSL
        UV_THREADPOOL_SIZE: 2  // Limitar el tamaño del threadpool de libuv
      },
      error_file: 'logs/pm2-error.log',
      out_file: 'logs/pm2-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      // Cargar variables de entorno desde .env.production
      env_file: '.env.production'
    }
  ]
};
