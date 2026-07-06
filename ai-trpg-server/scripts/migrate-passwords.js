const config = require('../src/config');
const securityService = require('../src/services/securityService');
const { readJson, writeJson } = require('../src/storage/jsonFile');

const source = readJson(config.paths.usersFile, []);
const users = Array.isArray(source) ? source : (Array.isArray(source?.users) ? source.users : []);
let migratedCount = 0;

const migratedUsers = users.map((user) => {
  if (user.passwordHash || typeof user.password !== 'string') return user;
  const migratedUser = {
    ...user,
    passwordHash: securityService.hashPassword(user.password),
  };
  delete migratedUser.password;
  migratedCount += 1;
  return migratedUser;
});

writeJson(config.paths.usersFile, migratedUsers);
console.log(`密码迁移完成：${migratedCount} 个旧账号已转换为 scrypt 哈希。`);
