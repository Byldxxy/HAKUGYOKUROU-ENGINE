const express = require('express');
const rooms = require('../repositories/roomRepository');
const logs = require('../repositories/roomLogRepository');
const { getPublicCampaign } = require('../services/campaignService');
const { historyPage, pageQuery } = require('../domain/roomHistoryPage');
const { isValidRoomId } = require('../domain/validation');

const router = express.Router();
router.get('/', (req, res) => {
  const { roomId } = req.query;
  const cursor = pageQuery(req.query);
  if (!isValidRoomId(roomId) || !cursor) return res.status(400).json({ success: false, error: '房间号或消息位置无效。' });
  if (!rooms.canRead(roomId, req.user.username)) return res.status(403).json({ success: false, error: '无权访问该房间。' });

  const index = logs.getRoomIndex(roomId);
  const paged = req.query.historyVersion === '1' || Object.keys(cursor).length > 0;
  const page = paged ? historyPage(index.messages, cursor) : { messages: index.messages };
  if (cursor.aroundSeq !== undefined && !page.messages.some(message => message.logIndex === cursor.aroundSeq)) {
    return res.status(404).json({ success: false, error: '原消息不存在。' });
  }
  // Existing consumers of the default page also use its per-account notebook summary.
  const includeCampaign = Object.keys(cursor).length === 0;
  res.json({ success: true, ...page, ...(includeCampaign && {
    campaign: index.latestCampaign ? getPublicCampaign(index.latestCampaign, req.user.username, index.sources) : null,
  }) });
});
module.exports = router;
