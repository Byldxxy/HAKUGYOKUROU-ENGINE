const express = require('express');
const characterRepository = require('../repositories/characterRepository');

const router = express.Router();

// SECTION: 角色卡列表
// NOTE: username 来自登录账号，用于区分不同玩家的角色档案。
router.get('/', (req, res) => {
  const { username } = req.query;
  if (!username) return res.json({ success: false, cards: [] });

  res.json({ success: true, cards: characterRepository.listByUsername(username) });
});

// SECTION: 保存角色卡
// NOTE: 同一个接口同时处理新建和编辑，是否更新由 cardData.id 判断。
router.post('/', (req, res, next) => {
  try {
    const { username, cardData } = req.body;
    if (!username || !cardData) {
      return res.status(400).json({ success: false, message: '缺少账号或卡片数据' });
    }

    // NOTE: repository 会返回归一化后的摘要，前端用它刷新大厅角色下拉框。
    const { card, created } = characterRepository.saveForUsername(username, cardData);
    console.log(`[数据库] 账号 ${username} ${created ? '录入了新档案' : '更新了档案'}: ${card.name}`);
    res.json({ success: true, message: '保存成功', card });
  } catch (error) {
    next(error);
  }
});

// SECTION: 删除角色卡
// NOTE: 删除只影响角色库，不会回溯修改已产生的房间日志。
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
