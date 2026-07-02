# 白玉楼 AI TRPG

一个前后端分离的 AI 跑团原型项目。前端提供登录、房间大厅、COC 7th 角色卡、游戏主舞台、自动掷骰、战役笔记和人物关系图；后端提供账号/角色卡持久化、Socket.IO 实时房间、日志存档，以及兼容 OpenAI Chat Completions 的 AI KP 调用。

## 项目结构

```text
trpg/
├── ai-trpg-web/       # React + TypeScript + Vite 前端
├── ai-trpg-server/    # Express + Socket.IO + OpenAI 后端
├── README.md          # 项目总说明
└── CODEX_NOTES.md     # Codex 读码笔记与后续开发提示
```

## 技术栈

- 前端：React 19、TypeScript、Vite、React Router、Socket.IO Client
- 后端：Node.js、Express 5、Socket.IO、OpenAI SDK、dotenv
- 存储：本地 JSON 文件与 JSONL 日志文件

## 本地启动

### 1. 后端

```bash
cd ai-trpg-server
npm install
npm run dev
```

后端默认监听：

```text
http://localhost:3000
```

后端需要 `ai-trpg-server/.env`，可参考 `ai-trpg-server/.env.example`：

```env
PORT=3000
HOST=0.0.0.0
CORS_ORIGIN=*
API_KEY=你的模型 API Key
BASE_URL=https://api.openai.com/v1
MODEL_NAME=gpt-3.5-turbo
AI_TIMEOUT_MS=30000
```

`BASE_URL` 和 `MODEL_NAME` 可换成 DeepSeek 等兼容 OpenAI Chat Completions 的服务。

### 2. 前端

```bash
cd ai-trpg-web
npm install
npm run dev
```

前端开发服务器固定监听：

```text
http://localhost:5174
```

前端代码通过 `src/config.ts` 统一指向 `http://localhost:5174`，Vite dev proxy 会把 `/api` 和 `/socket.io` 转发到后端 `http://localhost:3000`。

## 后端结构

后端已经从单文件整理为分层结构：

```text
ai-trpg-server/
├── app.js                    # 服务启动器
├── src/
│   ├── ai/                   # AI 系统提示词
│   ├── config/               # 环境变量与路径配置
│   ├── middleware/           # 通用中间件
│   ├── repositories/         # 文件存储读写边界
│   ├── routes/               # REST API 路由
│   ├── services/             # AI 等业务服务
│   ├── sockets/              # Socket.IO 房间逻辑
│   └── storage/              # JSON/JSONL 文件工具
├── users.json
├── characters.json
├── logs/
└── saves/
```

## 主要功能

- 账号注册与登录：`/api/register`、`/api/login`。账号只负责登录和数据归属，跑团展示名统一使用当前出战角色卡姓名
- 服务健康检查：`/api/health`
- 角色卡管理：创建、编辑、删除、选择出战角色
- 战役笔记：`/api/notebooks` 按房间和账号保存自由笔记、关键线索、人物关系图
- 大厅联机：创建 6 位房间号、加入房间、房主开始游戏、闲聊广播。玩家列表按角色卡姓名同步，退出、重连和切换角色会更新同一玩家条目
- 游戏主舞台：回合发言、自动等待队友、AI DM 推进、历史记录恢复
- COC 掷骰：AI 输出 `<<ROLL:技能名称:角色卡姓名>>` 后，对应角色卡客户端会渲染检定按钮并播报结果
- 状态变更：AI 输出 `<<STAT:角色卡姓名:HP|SAN|MP:+/-数字>>` 后，前端更新角色状态
- 回合状态：后端广播 `turn_state`，前端根据明确状态锁定输入框、等待玩家行动、等待掷骰或等待 AI 结算
- 存档系统：按房间日志复制成存档，房主可从大厅加载
- 战役笔记：自由笔记、右键提取关键线索、可拖拽人物关系图

## 后端数据文件

后端目前使用本地文件保存数据：

- `ai-trpg-server/users.json`：账号、兼容旧字段的昵称、密码和角色卡占位字段。当前前端注册不再要求昵称
- `ai-trpg-server/characters.json`：每个账号下的角色卡列表
- `ai-trpg-server/logs/room_*.jsonl`：房间行动与 AI 回复日志
- `ai-trpg-server/saves/meta.json`：存档元信息
- `ai-trpg-server/saves/*.jsonl`：具体存档日志
- `ai-trpg-server/notebooks.json`：每个账号在每个房间里的战役笔记、线索和关系图

这些文件适合原型开发。正式部署前建议替换为数据库，并处理密码哈希、权限校验和敏感信息保护。

当前代码已经把文件读写封装进 `src/repositories/`。后续切换 PostgreSQL/MySQL/Redis 时，优先替换 repository 层，不需要直接改页面或 Socket 事件主体。

## 常用脚本

前端：

```bash
npm run dev
npm run build
npm run lint
npm run preview
```

后端：

```bash
npm run dev
npm run start
npm run check
```

## 已完成的整理

- 后端已拆成 routes、socket handlers、repositories、storage、ai service。
- `ROLL` / `STAT` 指令解析已集中到前后端 `domain/directives` 模块，后续扩展协议优先改这里。
- `ROLL` 请求已生成稳定 `rollId`，骰子结果按 `rollId` 回填与去重。
- 后端已广播 `turn_state`，前端优先按明确回合状态锁定输入框。
- 大厅角色卡拉取已集中到 `loadCharacters`；入房 Socket 上报会等待角色卡加载完成，避免占位玩家重复进房。
- 前端已集中使用 `src/socket.ts` 的 Socket.IO 客户端。
- 战役笔记已持久化到本地 JSON 文件。
- 前端会清理旧的 `trpg_nickname` localStorage 缓存，但业务逻辑不再依赖它。

## 待修改与上线风险

- 账号密码当前明文保存在 `users.json`，只适合本地开发。
- 后端接口基本没有鉴权，依赖前端 localStorage 传入的用户名。
- 本地 JSON 文件适合原型开发，后续上线建议迁入数据库并补权限校验。
- 房间实时状态仍主要保存在后端内存，后端重启后需要玩家重新进房。
- Socket 跨页面连接生命周期还可以继续收敛，避免 join/leave 时机分散。
