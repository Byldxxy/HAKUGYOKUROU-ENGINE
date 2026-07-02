const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const serverRoot = path.resolve(__dirname, '../..');

const parseOrigins = (value) => {
  if (!value || value === '*') return '*';
  return value.split(',').map((origin) => origin.trim()).filter(Boolean);
};

const config = {
  serverRoot,
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || '0.0.0.0',
  corsOrigin: parseOrigins(process.env.CORS_ORIGIN || '*'),
  openai: {
    apiKey: process.env.API_KEY,
    baseURL: process.env.BASE_URL || 'https://api.openai.com/v1',
    model: process.env.MODEL_NAME || 'gpt-3.5-turbo',
    timeout: Number(process.env.AI_TIMEOUT_MS || 30000),
  },
  paths: {
    usersFile: path.join(serverRoot, 'users.json'),
    charactersFile: path.join(serverRoot, 'characters.json'),
    logsDir: path.join(serverRoot, 'logs'),
    savesDir: path.join(serverRoot, 'saves'),
    savesMetaFile: path.join(serverRoot, 'saves', 'meta.json'),
    notebooksFile: path.join(serverRoot, 'notebooks.json'),
  },
};

module.exports = config;
