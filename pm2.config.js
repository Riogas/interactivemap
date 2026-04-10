module.exports = {
  apps: [
    {
      name: 'track',
      script: 'node_modules/next/dist/bin/next',
      args: 'start',
      
      // 🏗️ Arquitectura
      exec_mode: 'fork',           // Modo fork (una sola instancia)
      instances: 1,
      autorestart: true,
      watch: false,
      
      // 🔄 Gestión de Reinicio
      max_memory_restart: '2G',    // Aumentado para 100+ móviles con batching GPS
      min_uptime: '30s',           // Tiempo mínimo para considerar "estable" (aumentado)
      max_restarts: 10,            // Reintentos antes de rendirse (reducido - si falla 10 veces, hay un bug)
      restart_delay: 5000,         // Esperar 5s entre reinicios
      exp_backoff_restart_delay: 1000, // Backoff exponencial más agresivo
      
      // ⏱️ Timeouts
      kill_timeout: 15000,         // 15s para flush de queue con 100+ móviles
      listen_timeout: 10000,       // Timeout para que la app esté lista (Next.js puede tardar)
      
      // 🌍 Variables de Entorno
      env: {
        NODE_ENV: 'production',
        PORT: 3002,
        HOSTNAME: '0.0.0.0',
        TZ: 'America/Montevideo',
        // NODE_TLS_REJECT_UNAUTHORIZED: '0',  // REMOVIDO POR SEGURIDAD — habilitar solo si el cert es auto-firmado
        UV_THREADPOOL_SIZE: 8,              // Aumentado para 100+ móviles (más I/O paralelo)
        NODE_OPTIONS: '--max-old-space-size=2048', // Límite heap V8 (2GB) para alta carga
      },
      
      // 📝 Logs
      error_file: 'logs/pm2-error.log',
      out_file: 'logs/pm2-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      
      // Cargar variables de entorno desde .env.production
      env_file: '.env.production'
    }
  ]
};
