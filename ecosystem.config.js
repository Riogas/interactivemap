module.exports = {
  apps: [
    {
      name: 'trackmovil',
      script: 'node_modules/next/dist/bin/next',
      args: 'start',
      cwd: '/home/riogas/trackmovil',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: 3001,
        HOSTNAME: '0.0.0.0'
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
