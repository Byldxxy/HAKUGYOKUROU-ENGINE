const rooms = require('../repositories/roomRepository');
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
// Snapshot private notebooks and the game log after active editors acknowledge their pending writes.
router.post('/', async (req, res, next) => {
  try {
    const { saveName } = req.body;
    const roomId = String(req.body.roomId || '');
    if (!isValidRoomId(roomId)) {
      return res.status(400).json({ error: '缺少房间号。' });
    }

    if (!rooms.canRead(roomId, req.user.username)) return res.status(403).json({ success: false, error: '无权访问该房间。' });
    const io = req.app.get('io');
    const editors = [...(io.sockets.adapter.rooms.get(roomId) || [])]
      .map(id => io.sockets.sockets.get(id))
      .filter(peer => peer?.data.notebookEditorRoom === roomId);
    try {
      const replies = await Promise.all(editors.map(peer =>
        peer.timeout(8000).emitWithAck('flush_notebook', { roomId })));
      if (replies.some(reply => reply?.success !== true)) throw new Error('notebook_sync_failed');
    } catch {
      return res.status(409).json({ success: false, error: '有玩家的笔记尚未同步，请稍后重试存档。' });
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
