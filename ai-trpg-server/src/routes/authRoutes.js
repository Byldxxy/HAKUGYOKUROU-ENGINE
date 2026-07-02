const express = require('express');
const userRepository = require('../repositories/userRepository');

const router = express.Router();

// SECTION: 注册接口
// NOTE: 注册只创建登录账号；游戏内昵称已改为角色卡姓名。
router.post('/register', (req, res, next) => {
  try {
    const { username, nickname, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: '请填写完整的注册信息。' });
    }

    // NOTE: nickname 仅兼容旧字段，前端欢迎语不再展示它。
    const displayName = nickname || username;
    const newUser = userRepository.createUser({ username, nickname: displayName, password });
    console.log(`📝 新调查员建档成功: ${displayName} (${username})`);
    res.json({ success: true, username: newUser.username, nickname: newUser.nickname });
  } catch (error) {
    next(error);
  }
});

// SECTION: 登录接口
// NOTE: 当前为本地原型明文密码校验；上线前必须换成密码哈希和会话/JWT。
router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: '请输入完整的账号和密码。' });
  }

  // NOTE: 登录成功返回 username，用于前端读取角色卡、存档和个人笔记。
  const user = userRepository.findByUsername(username);
  if (user && user.password === password) {
    console.log(`🔑 调查员登录成功: ${user.nickname}`);
    return res.json({ success: true, username: user.username, nickname: user.nickname });
  }

  res.status(401).json({ error: '安全密钥错误或档案不存在！' });
});

module.exports = router;
