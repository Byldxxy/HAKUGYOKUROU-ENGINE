const express = require('express');
const saveRepository = require('../repositories/saveRepository');

const router = express.Router();

router.get('/', (req, res) => {
  const { username } = req.query;
  res.json({ success: true, saves: username ? saveRepository.listByUsername(username) : [] });
});

router.post('/', (req, res, next) => {
  try {
    const { username, roomId, saveName } = req.body;
    if (!username || !roomId) {
      return res.status(400).json({ error: '缺少账号或房间号。' });
    }

    saveRepository.createSave({ username, roomId, saveName });
    res.json({ success: true, message: '战役已成功封存！' });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
