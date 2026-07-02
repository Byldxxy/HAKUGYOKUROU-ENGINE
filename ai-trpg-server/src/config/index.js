const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

// SECTION: 服务根目录
// NOTE: 所有本地 JSON、JSONL、存档路径都从 serverRoot 派生，避免启动目录变化导致写错位置。
const serverRoot = path.resolve(__dirname, '../..');

// SECTION: CORS 白名单解析
// NOTE: 支持逗号分隔多个来源；* 只建议用于本地开发。
const parseOrigins = (value) => {
  if (!value || value === '*') return '*';
  return value.split(',').map((origin) => origin.trim()).filter(Boolean);
};

// SECTION: 统一配置对象
// NOTE: 业务代码只读取 config，不直接读取 process.env，方便之后做配置校验。
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
    // NOTE: 当前原型使用本地文件；上线迁数据库时，仓储层可以替换实现而不改路由。
    usersFile: path.join(serverRoot, 'users.json'),
    charactersFile: path.join(serverRoot, 'characters.json'),
    logsDir: path.join(serverRoot, 'logs'),
    savesDir: path.join(serverRoot, 'saves'),
    savesMetaFile: path.join(serverRoot, 'saves', 'meta.json'),
    notebooksFile: path.join(serverRoot, 'notebooks.json'),
  },
};

module.exports = config;
