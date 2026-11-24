const express = require('express');
const characterRepository = require('../repositories/characterRepository');

const router = express.Router();

// SECTION: 角色卡列表
// NOTE: username 来自登录账号，用于区分不同玩家的角色档案。
router.get('/', (req, res) => {
  res.json({ success: true, cards: characterRepository.listByUsername(req.user.username) });
});

// Only selected party members can fetch each other's portrait.
router.get('/:id/avatar', (req, res) => {
  const { roomId } = req.query;
  if (typeof roomId !== 'string' || !require('../domain/validation').isValidRoomId(roomId)) return res.sendStatus(400);
  const members = require('../repositories/roomRepository').get(roomId)?.members || [];
  if (!members.some(member => member.accountName === req.user.username)) return res.sendStatus(403);
  const target = members.find(member => member.characterId === req.params.id);
  const card = target && characterRepository.listByUsername(target.accountName).find(item => item.id === target.characterId);
  const bytes = card?.avatarRevision && require('../domain/portrait').decodePortrait(card.fullData.avatar);
  if (!bytes) return res.sendStatus(404);
  res.set('Cache-Control', 'private, no-cache').set('X-Content-Type-Options', 'nosniff').type('png').send(bytes);
});

// SECTION: 保存角色卡
// NOTE: 同一个接口同时处理新建和编辑，是否更新由 cardData.id 判断。
router.post('/', (req, res, next) => {
  try {
    const { cardData } = req.body;
    if (!cardData) {
      return res.status(400).json({ success: false, message: '缺少卡片数据' });
    }
    const username = req.user.username;
    if (cardData.id && require('../repositories/roomRepository').characterInUse(username, cardData.id)) return res.status(409).json({ success: false, error: '角色正在战役中使用，请先退出该战役。' });

    // NOTE: repository 会返回归一化后的摘要，前端用它刷新大厅角色下拉框。
    const { card, created } = characterRepository.saveForUsername(username, cardData);
    console.log(`[数据库] 账号 ${username} ${created ? '录入了新档案' : '更新了档案'}: ${card.name}`);
    res.json({ success: true, message: '保存成功', card });
  } catch (error) {
    next(error);
  }
});

// SECTION: 删除角色卡
// NOTE: 账号来自认证会话，URL 只接收角色 ID。
router.delete('/:id', (req, res) => {
  const { id } = req.params;
  const username = req.user.username;
  if (require('../repositories/roomRepository').characterInUse(username, id)) return res.status(409).json({ success: false, error: '角色正在战役中使用，请先退出该战役。' });
  const deleted = characterRepository.deleteForUsername(username, id);

  if (!deleted) {
    return res.status(404).json({ success: false, message: '账号或档案不存在' });
  }

  console.log(`[数据库] 账号 ${username} 删除了档案: ${id}`);
  res.json({ success: true });
});

module.exports = router;
