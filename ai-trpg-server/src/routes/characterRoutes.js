const express = require('express');
const characterRepository = require('../repositories/characterRepository');

const { decodePortrait } = require('../domain/portrait');
const { isValidRoomId } = require('../domain/validation');
const rooms = require('../repositories/roomRepository');
const { createHash } = require('node:crypto');
const router = express.Router();
const owned = (username, id) => characterRepository.listByUsername(username).find(card => card.id === id);
const summary = ({ id, name, role, hp, san, mp, avatarRevision }) =>
  ({ id, name, role, hp, san, mp, avatarRevision: avatarRevision || null });
const portraitRevision = (card, bytes) => card.avatarRevision || createHash('sha256').update(bytes).digest('hex');


// SECTION: 角色卡列表
// NOTE: username 来自登录账号，用于区分不同玩家的角色档案。
router.get('/', (req, res) => {
  const cards = characterRepository.listByUsername(req.user.username);
  res.json({ success: true, cards: req.query.view === 'summary' ? cards.map(summary) : cards });
});

router.get('/:id', (req, res) => {
  const card = owned(req.user.username, req.params.id);
  if (!card) return res.sendStatus(404);
  const { avatar, ...fullData } = card.fullData;
  // A card from before revisioned portraits may still have a valid PNG.
  const legacyBytes = avatar && !card.avatarRevision && decodePortrait(avatar);
  const revision = card.avatarRevision || (legacyBytes && portraitRevision(card, legacyBytes));
  const avatarPath = revision ? `/api/characters/${encodeURIComponent(card.id)}/avatar?v=${revision}` : null;
  res.set('Cache-Control', 'private, no-cache').json({ success: true, card: { ...summary(card), avatarPath, fullData } });
});

router.get('/:id/avatar', (req, res) => {
  const { roomId, v } = req.query;
  let account = req.user.username;
  if (roomId !== undefined) {
    if (!isValidRoomId(roomId)) return res.sendStatus(400);
    const members = rooms.get(roomId)?.members || [];
    if (!members.some(member => member.accountName === account)) return res.sendStatus(403);
    const target = members.find(member => member.characterId === req.params.id);
    if (!target) return res.sendStatus(404);
    account = target.accountName;
  }
  const card = owned(account, req.params.id);
  const bytes = card && decodePortrait(card.fullData.avatar);
  if (!bytes) return res.sendStatus(404);
  const revision = portraitRevision(card, bytes);
  if (v && v !== revision) return res.sendStatus(404);
  res.set('Cache-Control', 'private, no-cache').set('ETag', '"' + revision + '"')
    .set('X-Content-Type-Options', 'nosniff').type('png').send(bytes);
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
    if (cardData.id && rooms.characterInUse(username, cardData.id)) return res.status(409).json({ success: false, error: '角色正在战役中使用，请先退出该战役。' });

    // NOTE: repository 会返回归一化后的摘要，前端用它刷新大厅角色下拉框。
    const { card, created } = characterRepository.saveForUsername(username, cardData);
    console.log(`[数据库] 账号 ${username} ${created ? '录入了新档案' : '更新了档案'}: ${card.name}`);
    res.json({ success: true, message: '保存成功', card: req.query.view === 'summary' ? summary(card) : card });
  } catch (error) {
    next(error);
  }
});

// SECTION: 删除角色卡
// NOTE: 账号来自认证会话，URL 只接收角色 ID。
router.delete('/:id', (req, res) => {
  const { id } = req.params;
  const username = req.user.username;
  if (rooms.characterInUse(username, id)) return res.status(409).json({ success: false, error: '角色正在战役中使用，请先退出该战役。' });
  const deleted = characterRepository.deleteForUsername(username, id);

  if (!deleted) {
    return res.status(404).json({ success: false, message: '账号或档案不存在' });
  }

  console.log(`[数据库] 账号 ${username} 删除了档案: ${id}`);
  res.json({ success: true });
});

module.exports = router;
