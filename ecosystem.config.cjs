/**
 * PM2 process file for the Ubuntu VPS.
 *   pm2 start ecosystem.config.cjs
 *   pm2 save && pm2 startup   # survive reboots
 */
module.exports = {
  apps: [
    {
      name: 'gmb-tracker',
      script: 'node_modules/next/dist/bin/next',
      args: `start -p ${process.env.PORT || 3000}`,
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        PORT: Number(process.env.PORT || 3000),
      },
      out_file: 'logs/pm2-out.log',
      error_file: 'logs/pm2-error.log',
      merge_logs: true,
      time: true,
    },
  ],
};
