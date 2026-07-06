const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const config = require('./src/config');
const registerRoutes = require('./src/routes');
const errorHandler = require('./src/middleware/errorHandler');
const registerRoomSocket = require('./src/sockets/registerRoomSocket');
const securityHeaders = require('./src/middleware/securityHeaders');
const { authenticateSocket } = require('./src/middleware/authenticate');

// SECTION: HTTP 与 WebSocket 基座
// NOTE: Socket.IO 需要复用同一个 HTTP server，不能直接只 app.listen。
const app = express();
const server = http.createServer(app);
app.disable('x-powered-by');
if (config.trustProxy) app.set('trust proxy', config.trustProxy);

// SECTION: 跨域配置
// NOTE: CORS_ORIGIN 在 .env 中配置；本地开发可用 *，上线应改为前端域名白名单。
const corsOptions = {
  origin: config.corsOrigin,
  credentials: true,
  optionsSuccessStatus: 200,
};

// SECTION: Socket.IO 初始化
// NOTE: 前端游戏、房间大厅和回合状态都通过同一个 io 实例广播。
const io = new Server(server, {
  cors: {
    origin: config.corsOrigin,
    methods: ['GET', 'POST'],
    credentials: true,
  },
  maxHttpBufferSize: 512 * 1024,
});
io.use(authenticateSocket);

// SECTION: Express 中间件
// NOTE: JSON 限制 2mb，足够当前角色卡/笔记 payload，避免过大的请求压垮本地文件写入。
app.use(cors(corsOptions));
app.use(securityHeaders);
app.use(express.json({ limit: '512kb' }));

// SECTION: HTTP 路由注册
// NOTE: errorHandler 必须放在路由之后，才能接住 next(error)。
registerRoutes(app);
app.use(errorHandler);

// SECTION: WebSocket 路由注册
// NOTE: 房间内存态 liveRooms 在 registerRoomSocket 模块中维护。
registerRoomSocket(io);

// SECTION: 服务启动
// NOTE: 日志展示 localhost 方便本地复制，但 host 仍由 .env 决定。
server.listen(config.port, config.host, () => {
  console.log(`🚀 白玉楼引擎 (WebSocket) 后端已启动在 http://localhost:${config.port}`);
});
