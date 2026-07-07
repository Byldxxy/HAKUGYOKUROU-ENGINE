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
// NOTE: 开发模式读取 .env，PM2 生产模式读取 .env.production 中的 HTTPS 域名白名单。
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
server.listen(config.port, config.host, () => {
  const origins = config.corsOrigin === '*' ? '*' : config.corsOrigin.join(', ');
  console.log(`🚀 白玉楼引擎后端 [${config.nodeEnv}] 监听 http://${config.host}:${config.port}`);
  console.log(`🔒 允许的前端来源: ${origins}`);
  console.log(`⚙️ 已加载环境文件: ${config.envFileName}`);
});
