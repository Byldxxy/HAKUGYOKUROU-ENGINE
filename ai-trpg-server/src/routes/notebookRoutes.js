const express = require('express');
const notebookRepository = require('../repositories/notebookRepository');

const router = express.Router();

router.get('/', (req, res) => {
  const { roomId, username } = req.query;
  if (!roomId || !username) {
    return res.status(400).json({ success: false, error: '缺少房间号或账号。' });
  }

  res.json({
    success: true,
    notebook: notebookRepository.getNotebook({ roomId, username }),
  });
});

router.put('/', (req, res, next) => {
  try {
    const { roomId, username, notebook } = req.body;
    if (!roomId || !username || !notebook) {
      return res.status(400).json({ success: false, error: '缺少房间号、账号或笔记内容。' });
    }

    const savedNotebook = notebookRepository.saveNotebook({ roomId, username, notebook });
    res.json({ success: true, notebook: savedNotebook });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
