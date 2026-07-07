const path = require('path');

module.exports = {
  apps: [
    {
      name: 'hakugyokurou-server',
      cwd: path.resolve(__dirname, '../ai-trpg-server'),
      script: 'app.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '512M',
      time: true,
      env: {
        NODE_ENV: 'development',
      },
      env_production: {
        NODE_ENV: 'production',
      },
    },
  ],
};
