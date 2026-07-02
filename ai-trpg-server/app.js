const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const config = require('./src/config');
const registerRoutes = require('./src/routes');
const errorHandler = require('./src/middleware/errorHandler');
const registerRoomSocket = require('./src/sockets/registerRoomSocket');

const app = express();
const server = http.createServer(app);

const corsOptions = {
  origin: config.corsOrigin,
  optionsSuccessStatus: 200,
};

const io = new Server(server, {
  cors: {
    origin: config.corsOrigin,
    methods: ['GET', 'POST'],
  },
});

app.use(cors(corsOptions));
app.use(express.json({ limit: '2mb' }));

registerRoutes(app);
app.use(errorHandler);

registerRoomSocket(io);

server.listen(config.port, config.host, () => {
  console.log(`🚀 白玉楼引擎 (WebSocket) 后端已启动在 http://localhost:${config.port}`);
});
