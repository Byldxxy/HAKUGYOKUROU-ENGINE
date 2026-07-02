const config = require('../config');
const { readJson, writeJson } = require('../storage/jsonFile');

const normalizeUsers = (data) => {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.users)) return data.users;
  return [];
};

const readUsers = () => normalizeUsers(readJson(config.paths.usersFile, []));

const writeUsers = (users) => {
  writeJson(config.paths.usersFile, users);
};

const findByUsername = (username) => {
  return readUsers().find((user) => user.username === username);
};

const createUser = ({ username, nickname, password }) => {
  const users = readUsers();
  if (users.find((user) => user.username === username)) {
    const error = new Error('该登录账号已被其他调查员注册！');
    error.statusCode = 400;
    throw error;
  }

  const newUser = {
    username,
    nickname,
    password,
    characterCard: null,
  };
  users.push(newUser);
  writeUsers(users);
  return newUser;
};

module.exports = {
  readUsers,
  findByUsername,
  createUser,
};
