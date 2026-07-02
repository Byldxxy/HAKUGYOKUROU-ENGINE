const express = require('express');
const config = require('../config');

const router = express.Router();

// SECTION: 健康检查
// NOTE: 不访问文件和 AI，只确认 HTTP 服务进程可响应。
router.get('/', (req, res) => {
  res.json({
    success: true,
    service: 'hakugyokurou-ai-trpg-server',
    port: config.port,
    time: new Date().toISOString(),
  });
});

module.exports = router;
