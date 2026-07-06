const config = require('../config');
const { readJson, writeJson } = require('../storage/jsonFile');

// SECTION: 用户数据兼容
// NOTE: 早期 users.json 可能是数组，也可能包在 { users } 下，这里统一成数组。
const normalizeUsers = (data) => {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.users)) return data.users;
  return [];
};

// SECTION: 用户读取
// NOTE: 新账号只保存 passwordHash；旧 password 字段由登录流程完成一次性迁移。
const readUsers = () => normalizeUsers(readJson(config.paths.usersFile, []));

// SECTION: 用户写入
// NOTE: 统一走 JSON 临时文件写入，保持和角色/存档一致的落盘方式。
const writeUsers = (users) => {
  writeJson(config.paths.usersFile, users);
};

// SECTION: 按账号查找
// NOTE: username 是登录唯一 ID，不再承担游戏内昵称职责。
const findByUsername = (username) => {
  return readUsers().find((user) => user.username === username);
};

// SECTION: 创建账号
// NOTE: nickname 字段只为兼容旧结构保留，游戏内展示名统一来自角色卡。
const createUser = ({ username, nickname, passwordHash }) => {
  const users = readUsers();
  if (users.find((user) => user.username === username)) {
    const error = new Error('该登录账号已被其他调查员注册！');
    error.statusCode = 400;
    throw error;
  }

  const newUser = {
    username,
    nickname,
    passwordHash,
    characterCard: null,
  };
  users.push(newUser);
  writeUsers(users);
  return newUser;
};

const migratePasswordHash = (username, passwordHash) => {
  const users = readUsers();
  const userIndex = users.findIndex((user) => user.username === username);
  if (userIndex === -1) return false;

  users[userIndex] = { ...users[userIndex], passwordHash };
  delete users[userIndex].password;
  writeUsers(users);
  return true;
};

module.exports = {
  readUsers,
  findByUsername,
  createUser,
  migratePasswordHash,
};
