const authRoutes = require('./authRoutes');
const characterRoutes = require('./characterRoutes');
const healthRoutes = require('./healthRoutes');
const notebookRoutes = require('./notebookRoutes');
const saveRoutes = require('./saveRoutes');
const roomHistoryRoutes = require('./roomHistoryRoutes');

// SECTION: REST 路由装配
// NOTE: WebSocket 事件不在这里注册；这里只有 HTTP API。
const registerRoutes = (app) => {
  // NOTE: health 独立在 /api/health，方便本地或部署平台做存活探测。
  app.use('/api/health', healthRoutes);
  app.use('/api', authRoutes);
  app.use('/api/characters', characterRoutes);
  app.use('/api/notebooks', notebookRoutes);
  app.use('/api/saves', saveRoutes);
  app.use('/api/room_history', roomHistoryRoutes);
};

module.exports = registerRoutes;
