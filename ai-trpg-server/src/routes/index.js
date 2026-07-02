const authRoutes = require('./authRoutes');
const characterRoutes = require('./characterRoutes');
const healthRoutes = require('./healthRoutes');
const notebookRoutes = require('./notebookRoutes');
const saveRoutes = require('./saveRoutes');
const roomHistoryRoutes = require('./roomHistoryRoutes');

const registerRoutes = (app) => {
  app.use('/api/health', healthRoutes);
  app.use('/api', authRoutes);
  app.use('/api/characters', characterRoutes);
  app.use('/api/notebooks', notebookRoutes);
  app.use('/api/saves', saveRoutes);
  app.use('/api/room_history', roomHistoryRoutes);
};

module.exports = registerRoutes;
