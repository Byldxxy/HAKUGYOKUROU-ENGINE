const fs = require('fs');
const path = require('path');

// SECTION: 目录准备
// NOTE: 所有 JSON/JSONL 写入前都先确保目录存在，避免首次启动缺目录报错。
const ensureDir = (dirPath) => {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
};

// SECTION: JSON 文件初始化
// NOTE: 读取前自动创建 fallback 文件，让开发环境不需要手动准备空 JSON。
const ensureJsonFile = (filePath, fallbackValue) => {
  ensureDir(path.dirname(filePath));
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(fallbackValue, null, 2));
  }
};

// SECTION: JSON 读取
// NOTE: 空文件按 fallback 处理；损坏 JSON 仍会抛错，方便尽早发现数据问题。
const readJson = (filePath, fallbackValue) => {
  ensureJsonFile(filePath, fallbackValue);
  const content = fs.readFileSync(filePath, 'utf-8').trim();
  if (!content) return fallbackValue;
  return JSON.parse(content);
};

// SECTION: JSON 写入
// NOTE: 先写临时文件再 rename，降低写入中断导致主文件半截损坏的概率。
const writeJson = (filePath, data) => {
  ensureDir(path.dirname(filePath));
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2));
  fs.renameSync(tempPath, filePath);
};

// SECTION: JSONL 追加
// NOTE: 房间日志采用一行一事件，追加成本低，也便于后续做回放和存档复制。
const appendJsonLine = (filePath, data) => {
  ensureDir(path.dirname(filePath));
  fs.appendFileSync(filePath, `${JSON.stringify(data)}\n`);
};

// SECTION: JSONL 读取
// NOTE: 空日志表示新房间；每一行独立 JSON，某行损坏时会显式抛错。
const readJsonLines = (filePath) => {
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, 'utf-8').trim();
  if (!content) return [];

  return content
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
};

module.exports = {
  ensureDir,
  ensureJsonFile,
  readJson,
  writeJson,
  appendJsonLine,
  readJsonLines,
};
