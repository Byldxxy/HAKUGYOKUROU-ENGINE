const express = require('express');
const characterRepository = require('../repositories/characterRepository');

const router = express.Router();

router.get('/', (req, res) => {
  const { username } = req.query;
  if (!username) return res.json({ success: false, cards: [] });

  res.json({ success: true, cards: characterRepository.listByUsername(username) });
});

router.post('/', (req, res, next) => {
  try {
    const { username, cardData } = req.body;
    if (!username || !cardData) {
      return res.status(400).json({ success: false, message: '缺少账号或卡片数据' });
    }

    const { card, created } = characterRepository.saveForUsername(username, cardData);
    console.log(`[数据库] 账号 ${username} ${created ? '录入了新档案' : '更新了档案'}: ${card.name}`);
    res.json({ success: true, message: '保存成功', card });
  } catch (error) {
    next(error);
  }
});

router.delete('/:username/:id', (req, res) => {
  const { username, id } = req.params;
  const deleted = characterRepository.deleteForUsername(username, id);

  if (!deleted) {
    return res.status(404).json({ success: false, message: '账号或档案不存在' });
  }

  console.log(`[数据库] 账号 ${username} 删除了档案: ${id}`);
  res.json({ success: true });
});

module.exports = router;
