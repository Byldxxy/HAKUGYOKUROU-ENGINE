const express = require('express');
const notebookRepository = require('../repositories/notebookRepository');
const { isValidRoomId, sanitizeNotebook } = require('../domain/validation');

const router = express.Router();

// SECTION: 读取战役笔记
// NOTE: 笔记按 roomId + username 隔离，便于多人同房各自记录线索。
router.get('/', (req, res) => {
  const { roomId } = req.query;
  if (!isValidRoomId(roomId)) {
    return res.status(400).json({ success: false, error: '缺少房间号。' });
  }

  res.json({
    success: true,
    notebook: notebookRepository.getNotebook({ roomId, username: req.user.username }),
  });
});

// SECTION: 保存战役笔记
// NOTE: 前端做防抖提交；后端仍做结构兜底，避免异常 payload 写坏文件。
router.put('/', (req, res, next) => {
  try {
    const { roomId, notebook } = req.body;
    if (!isValidRoomId(roomId) || !notebook) {
      return res.status(400).json({ success: false, error: '缺少房间号或笔记内容。' });
    }

    const savedNotebook = notebookRepository.saveNotebook({
      roomId,
      username: req.user.username,
      notebook: sanitizeNotebook(notebook),
    });
    res.json({ success: true, notebook: savedNotebook });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
