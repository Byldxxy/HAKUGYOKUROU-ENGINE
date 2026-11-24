# 白玉楼 TRPG · Hakugyokurou Engine

白玉楼是一个支持单人和多人游玩的 **《克苏鲁的呼唤》第七版（CoC 7e）AI 跑团引擎**。玩家创建调查员，在浏览器里用自然语言声明行动。AI 担任守密人（KP），扮演 NPC、描述后果并提出检定；服务器负责掷骰、结算和保存战役。

[本地运行](#本地运行) · [第一次开团](#第一次开团) · [引擎设计](#引擎设计) · [编写剧本](#编写剧本) · [部署指南](deploy/README.md)

## 本地运行

使用 Node.js 24 和 npm。在仓库根目录打开两个终端。

**终端一 · 后端**

```bash
cd ai-trpg-server
npm ci
cp .env.example .env
```

在 `.env` 中设置 `SESSION_SECRET`。要使用站点主持，还需填写 `API_KEY`、`BASE_URL` 和 `MODEL_NAME`，指向支持 Chat Completions 的模型服务。启动后端：

```bash
npm run dev
```

**终端二 · 前端**

```bash
cd ai-trpg-web
npm ci
npm run dev
```

打开 [本地大厅入口](http://localhost:5174)。Vite 将 `/api` 和 `/socket.io` 代理到 `127.0.0.1:3000`。可通过 [健康检查](http://127.0.0.1:3000/api/health) 确认后端已启动。

## 第一次开团

1. **建立调查员。** 注册账号，创建角色卡，选择职业并分配属性和技能点。在「背景与资产」中可按行填写随身物品。
2. **创建房间。** 房主选定剧本和房规。单人可以直接开团，多人将六位房间号发给同伴，每位玩家选好自己的角色卡。
3. **配置主持。** 在「主持 API」中选择下表的一种方式，保存后开始游戏。
4. **行动与检定。** 描述调查员的话语或动作。需要检定时，由被点名的玩家点击检定卡掷骰。服务器广播结果，KP 根据结果继续叙述。
5. **记录与续团。** 在「战役笔记」查看关键线索、人物关系和物品栏。物品栏区分自带、剧情所得和队伍共有。房主可保存战役，再用原班角色读档继续。

| 主持方式 | 房主如何使用 | 费用与数据 |
| --- | --- | --- |
| 自有 API | 填写兼容服务的公网 HTTPS URL、模型名和 Key。配置按账号保存，可跨房间复用。 | 剧情上下文发送到所选服务，由该服务计费。Key 在服务器加密保存。 |
| 站点 API | 输入管理员提供的 CDK 兑换点数，再选中站点 API。 | 每次成功写入的 AI 回复扣 1 点。掷骰、固定开场和失败调用免费。 |

自托管时，在后端目录运行 `node scripts/issue-cdk.js 100` 可生成一张 100 点兑换码。发行与兑换须使用同一环境的 `SESSION_SECRET`。模型调用失败时会保留已提交的玩家行动，房主可调整配置后重试。

## 引擎设计

| 层 | 实现 | 职责 |
| --- | --- | --- |
| 浏览器 | React、TypeScript、Vite | 角色卡编辑、房间大厅、叙事时间线、掷骰交互与个人笔记 |
| 房间服务 | Express、Socket.IO | 使用签名会话识别玩家，同步行动、待掷骰与重连快照 |
| 战役引擎 | Node.js、结构化剧本 JSON | 校验导演提议，按场景条件更新线索、资源、转场与结局 |
| 持久化 | JSON、按房间写入的 JSONL | 保存账号、角色卡、行动与战役快照，支持存档恢复 |

**一次检定如何结算。** 玩家提交行动后，KP 返回叙述和结构化检定请求。引擎核对目标与技能，把请求绑定到角色卡。等待骰点时暂缓相关状态变更；服务器收到该玩家的掷骰操作后结算并广播，刷新页面仍能看到同一次检定的结果。

**长期记忆如何工作。** 引擎分别保存物件的实际归属、承诺的履行状态，以及每个见证者最后获得的信息。例如，甲把怀表交给乙，乙后来独自把怀表藏进抽屉。物件位置更新为抽屉，甲的见闻仍停在上次交接。后续回合按行动和场景召回相关记录，读档时随战役恢复。

后端按单进程运行，在线成员状态保存在内存，快照与日志写入本地文件。生产部署采用单实例，数据目录需要持久存储和备份。

## 编写剧本

剧本文件定义场景、NPC、线索、允许变化的事实、时钟和结局条件。可用广播室示例测试一条分支，观察检定等待、线索揭示和结局是否按预期发生。在仓库根目录运行：

```bash
node skills/hakugyokurou-scenario/scripts/check-scenario.cjs . \
  skills/hakugyokurou-scenario/assets/broadcast.json \
  skills/hakugyokurou-scenario/assets/broadcast.routes.json
```

[剧本编制指南](skills/hakugyokurou-scenario/SKILL.md) · [字段、结算与接入说明](skills/hakugyokurou-scenario/references/engine.md) · [内置剧本](ai-trpg-server/scenarios)

## 开发与验证

安装两端依赖后，在仓库根目录运行：

```bash
npm --prefix ai-trpg-server test
npm --prefix ai-trpg-web run lint
npm --prefix ai-trpg-web run build
```

后端测试覆盖战役结算、长期记忆，以及通过真实 HTTP 和 Socket.IO 连接进行的双人回归。集成测试使用模拟主持。若需调用实际供应商验证模型响应，配置模型后单独运行 `npm --prefix ai-trpg-server run test:live-ai`，该命令会产生模型请求。

[前端开发说明](ai-trpg-web/README.md) · [后端源码](ai-trpg-server/src) · [生产部署、兑换码与备份](deploy/README.md)
