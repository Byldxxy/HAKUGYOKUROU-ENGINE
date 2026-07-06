const express = require('express');
const saveRepository = require('../repositories/saveRepository');
const { isValidRoomId, normalizeText } = require('../domain/validation');

const router = express.Router();

// SECTION: 存档列表
// NOTE: username 为空时返回空数组，方便前端在未登录边界下安全渲染。
router.get('/', (req, res) => {
  res.json({ success: true, saves: saveRepository.listByUsername(req.user.username) });
});

// SECTION: 创建存档
// NOTE: 存档本质是复制当前房间 JSONL 日志，而不是序列化前端内存状态。
router.post('/', (req, res, next) => {
  try {
    const { roomId, saveName } = req.body;
    if (!isValidRoomId(roomId)) {
      return res.status(400).json({ error: '缺少房间号。' });
    }

    saveRepository.createSave({
      username: req.user.username,
      roomId,
      saveName: normalizeText(saveName, 80),
    });
    res.json({ success: true, message: '战役已成功封存！' });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
