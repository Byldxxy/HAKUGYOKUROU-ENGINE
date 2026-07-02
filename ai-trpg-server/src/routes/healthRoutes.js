const express = require('express');
const config = require('../config');

const router = express.Router();

router.get('/', (req, res) => {
  res.json({
    success: true,
    service: 'hakugyokurou-ai-trpg-server',
    port: config.port,
    time: new Date().toISOString(),
  });
});

module.exports = router;
