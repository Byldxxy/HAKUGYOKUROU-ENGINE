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
const dataRoot = path.resolve(process.env.TRPG_DATA_DIR || serverRoot);
const graceMs = Number(process.env.RECONNECT_GRACE_MS || 30_000);

function integerSetting(name, fallback, minimum, maximum) {
  const text = process.env[name];
  if (!text) return fallback;
  const value = Number(text);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} 必须为 ${minimum} 到 ${maximum} 的整数。`);
  }
  return value;
}

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
    timeout: integerSetting('AI_TIMEOUT_MS', 30000, 1, 2_147_483_647),
    customTimeout: integerSetting('CUSTOM_AI_TIMEOUT_MS', 90000, 1, 2_147_483_647),
    siteConcurrency: integerSetting('AI_SITE_CONCURRENCY', 4, 1, 128),
    customConcurrency: integerSetting('AI_CUSTOM_CONCURRENCY', 8, 1, 128),
    queueSize: integerSetting('AI_QUEUE_SIZE', 24, 0, 1024),
    inputBudget: integerSetting('AI_INPUT_TOKEN_BUDGET', 32768, 1024, 1048576),
    outputBudget: integerSetting('AI_OUTPUT_TOKEN_BUDGET', 4096, 256, 65536),
    debugRaw: parseBoolean(process.env.AI_DEBUG_RAW, !isProduction),
  },
  metricsInterval: integerSetting('PERF_METRICS_INTERVAL_MS', 60000, 0, 2_147_483_647),
  // Node timers outside this integer range can fire after only one millisecond.
  reconnectGraceMs: Number.isInteger(graceMs) && graceMs >= 0 && graceMs <= 2_147_483_647 ? graceMs : 30_000,
  paths: {
    roomsFile: path.join(dataRoot, 'rooms.json'),
    // NOTE: 当前原型使用本地文件；上线迁数据库时，仓储层可以替换实现而不改路由。
    usersFile: path.join(dataRoot, 'users.json'),
    charactersFile: path.join(dataRoot, 'characters.json'),
    logsDir: path.join(dataRoot, 'logs'),
    savesDir: path.join(dataRoot, 'saves'),
    scenarioRevisionsDir: path.join(dataRoot, 'scenario-revisions'),
    savesMetaFile: path.join(dataRoot, 'saves', 'meta.json'),
    notebooksFile: path.join(dataRoot, 'notebooks.json'),
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
