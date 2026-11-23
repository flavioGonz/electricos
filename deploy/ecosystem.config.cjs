// PM2: pm2 start deploy/ecosystem.config.cjs && pm2 save
module.exports = {
  apps: [
    {
      name: 'electricos',
      cwd: __dirname + '/../server',
      script: 'src/start.js',
      node_args: '--env-file=.env',
      env: { NODE_ENV: 'production' },
      max_memory_restart: '400M',
      kill_timeout: 5000,
    },
  ],
};
