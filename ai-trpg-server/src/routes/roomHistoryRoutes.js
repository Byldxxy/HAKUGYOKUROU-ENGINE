const express = require('express');
const roomLogRepository = require('../repositories/roomLogRepository');

const router = express.Router();

router.get('/', (req, res) => {
  const { roomId } = req.query;
  if (!roomId) return res.status(400).json({ success: false, messages: [] });

  res.json({ success: true, messages: roomLogRepository.listRoomMessages(roomId) });
});

module.exports = router;
