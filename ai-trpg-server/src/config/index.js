const path = require('path');
const dotenv = require('dotenv');

// SECTION: 服务根目录
// NOTE: 所有本地 JSON、JSONL、存档路径都从 serverRoot 派生，避免启动目录变化导致写错位置。
const serverRoot = path.resolve(__dirname, '../..');
const requestedNodeEnv = process.env.NODE_ENV || 'development';
const envFileName = requestedNodeEnv === 'production' ? '.env.production' : '.env';
dotenv.config({ path: path.join(serverRoot, envFileName) });
const nodeEnv = process.env.NODE_ENV || requestedNodeEnv;
const isProduction = nodeEnv === 'production';

const parseBoolean = (value, fallback) => {
  if (value === undefined || value === '') return fallback;
  return value === 'true';
};

// SECTION: CORS 白名单解析
// NOTE: 支持逗号分隔多个来源；* 只建议用于本地开发。
const parseOrigins = (value) => {
  if (!value) return [];
  if (value === '*') return '*';
  return value.split(',').map((origin) => origin.trim()).filter(Boolean);
};

// SECTION: 统一配置对象
// NOTE: 业务代码只读取 config，不直接读取 process.env，方便之后做配置校验。
const config = {
  serverRoot,
  envFileName,
  nodeEnv,
  isProduction,
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || '127.0.0.1',
  trustProxy: process.env.TRUST_PROXY === 'true' ? 1 : false,
  corsOrigin: parseOrigins(
    process.env.CORS_ORIGIN || (isProduction ? '' : 'http://localhost:5174')
  ),
  session: {
    secret: process.env.SESSION_SECRET || 'development-only-change-me',
    maxAgeSeconds: Number(process.env.SESSION_MAX_AGE_SECONDS || 60 * 60 * 24 * 7),
    secureCookie: parseBoolean(process.env.COOKIE_SECURE, isProduction),
  },
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

if (config.isProduction && (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32)) {
  throw new Error('生产环境必须配置至少 32 字符的 SESSION_SECRET。');
}

if (config.isProduction && config.corsOrigin === '*') {
  throw new Error('生产环境禁止使用 CORS_ORIGIN=*，请填写实际 HTTPS 域名。');
}

if (config.isProduction && config.corsOrigin.length === 0) {
  throw new Error('生产环境必须配置 CORS_ORIGIN=https://你的域名。');
}

if (config.isProduction && !config.openai.apiKey) {
  throw new Error('生产环境必须配置 API_KEY。');
}

module.exports = config;
