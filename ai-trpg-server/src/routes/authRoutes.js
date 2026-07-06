const express = require('express');
const userRepository = require('../repositories/userRepository');
const securityService = require('../services/securityService');
const { requireAuth } = require('../middleware/authenticate');
const createRateLimit = require('../middleware/rateLimit');

const router = express.Router();
const authRateLimit = createRateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: '登录或注册尝试过于频繁，请 15 分钟后再试。',
});

const normalizeUsername = (value) => String(value || '').trim();
const isValidUsername = (value) => /^[A-Za-z0-9_.-]{3,32}$/.test(value);
const isValidPassword = (value) => typeof value === 'string' && value.length >= 10 && value.length <= 128;

// SECTION: 注册接口
// NOTE: 注册只创建登录账号；游戏内昵称已改为角色卡姓名。
router.post('/register', authRateLimit, (req, res, next) => {
  try {
    const username = normalizeUsername(req.body.username);
    const { nickname, password } = req.body;
    if (!isValidUsername(username)) {
      return res.status(400).json({ error: '账号需为 3-32 位字母、数字、点、横线或下划线。' });
    }
    if (!isValidPassword(password)) {
      return res.status(400).json({ error: '密码长度需为 10-128 位。' });
    }

    // NOTE: nickname 仅兼容旧字段，前端欢迎语不再展示它。
    const displayName = nickname || username;
    const newUser = userRepository.createUser({
      username,
      nickname: displayName,
      passwordHash: securityService.hashPassword(password),
    });
    console.log(`📝 新调查员建档成功: ${displayName} (${username})`);
    res.setHeader('Set-Cookie', securityService.createLoginCookie(newUser.username));
    res.json({ success: true, username: newUser.username, nickname: newUser.nickname });
  } catch (error) {
    next(error);
  }
});

// SECTION: 登录接口
// NOTE: 新账号使用 scrypt 哈希；旧明文记录仅在首次成功登录时迁移。
router.post('/login', authRateLimit, (req, res) => {
  const username = normalizeUsername(req.body.username);
  const { password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: '请输入完整的账号和密码。' });
  }

  const user = userRepository.findByUsername(username);
  const validHashedPassword = user && securityService.verifyPassword(password, user.passwordHash);
  const legacyStored = user && !user.passwordHash && typeof user.password === 'string'
    ? Buffer.from(user.password)
    : null;
  const legacyProvided = typeof password === 'string' ? Buffer.from(password) : null;
  const validLegacyPassword = Boolean(
    legacyStored && legacyProvided && legacyStored.length === legacyProvided.length
    && require('crypto').timingSafeEqual(legacyStored, legacyProvided)
  );

  if (validHashedPassword || validLegacyPassword) {
    if (validLegacyPassword) {
      userRepository.migratePasswordHash(username, securityService.hashPassword(password));
      console.log(`🔐 账号 ${username} 已从明文密码迁移到 scrypt 哈希`);
    }
    console.log(`🔑 调查员登录成功: ${user.nickname}`);
    res.setHeader('Set-Cookie', securityService.createLoginCookie(user.username));
    return res.json({ success: true, username: user.username, nickname: user.nickname });
  }

  res.status(401).json({ error: '安全密钥错误或档案不存在！' });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ success: true, username: req.user.username });
});

router.post('/logout', (req, res) => {
  res.setHeader('Set-Cookie', securityService.createLogoutCookie());
  res.json({ success: true });
});

module.exports = router;
