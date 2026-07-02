const fs = require('fs');
const path = require('path');

const ensureDir = (dirPath) => {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
};

const ensureJsonFile = (filePath, fallbackValue) => {
  ensureDir(path.dirname(filePath));
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(fallbackValue, null, 2));
  }
};

const readJson = (filePath, fallbackValue) => {
  ensureJsonFile(filePath, fallbackValue);
  const content = fs.readFileSync(filePath, 'utf-8').trim();
  if (!content) return fallbackValue;
  return JSON.parse(content);
};

const writeJson = (filePath, data) => {
  ensureDir(path.dirname(filePath));
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2));
  fs.renameSync(tempPath, filePath);
};

const appendJsonLine = (filePath, data) => {
  ensureDir(path.dirname(filePath));
  fs.appendFileSync(filePath, `${JSON.stringify(data)}\n`);
};

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
