const express = require('express');
const roomLogRepository = require('../repositories/roomLogRepository');
const campaignService = require('../services/campaignService');
const { isValidRoomId } = require('../domain/validation');

const router = express.Router();

// SECTION: 房间历史
// NOTE: 游戏页刷新时先拉这里，再等待 Socket 的实时消息和 turn_state。
router.get('/', (req, res) => {
  const { roomId } = req.query;
  if (!isValidRoomId(roomId)) return res.status(400).json({ success: false, messages: [] });

  const campaign = roomLogRepository.getLatestCampaignState(roomId);
  res.json({
    success: true,
    messages: roomLogRepository.listRoomMessages(roomId),
    campaign: campaign ? campaignService.getPublicCampaign(campaign) : null,
  });
});

module.exports = router;
