# Codex Notes

这份笔记记录我对当前工程的读码结论，方便后续继续协作时快速接上。

## 总览

项目根目录下有两个子项目：

- `ai-trpg-web`：Vite React 前端，页面入口在 `src/App.tsx`。
- `ai-trpg-server`：Node 后端，入口在 `app.js`，核心逻辑已拆到 `src/`。

前端路由：

- `/`：登录/注册页，组件 `src/pages/Auth/index.tsx`
- `/hall`：主页大厅入口，组件 `src/pages/Home/index.tsx`
- `/lobby/:roomId`：房间大厅，组件 `src/pages/Lobby/index.tsx`
- `/game/:roomId`：游戏主舞台，组件 `src/pages/Game/index.tsx`
- `/create-character`：COC 7th 角色卡编辑器，组件 `src/pages/CreateCharacter/index.tsx`

## 运行模型

后端监听 `3000`，前端 Vite 固定监听 `5174`。当前前端请求通过 `src/config.ts` 指向：

- REST：`http://localhost:5174/api/...`
- Socket：`http://localhost:5174`

`vite.config.ts` 已配置 dev proxy，将 `/api` 和 `/socket.io` 转发到 `http://localhost:3000`。

## 后端结构地图

`ai-trpg-server/app.js` 只负责：

- 初始化 Express、HTTP server、Socket.IO
- 注册 REST routes
- 注册 Socket handlers
- 挂载错误处理中间件
- 启动监听

后端 `src/`：

- `config/`：读取 `.env`，集中管理端口、CORS、OpenAI、文件路径。
- `routes/`：`authRoutes`、`characterRoutes`、`saveRoutes`、`roomHistoryRoutes`。
- `routes/notebookRoutes.js`：按 `roomId + username` 保存/读取战役笔记。
- `repositories/`：`users.json`、`characters.json`、`logs/*.jsonl`、`saves/meta.json`、`notebooks.json` 的读写边界。
- `services/aiService.js`：OpenAI-compatible Chat Completions 调用。
- `ai/systemPrompt.js`：白玉楼引擎 KP 系统提示词。
- `sockets/registerRoomSocket.js`：房间、回合、发车、断线、AI 触发逻辑。
- `storage/jsonFile.js`：JSON/JSONL 原子写入和读取工具。

Socket 事件：

- `join_lobby`：进入大厅，若房间不存在则创建房间并绑定房主名
- `join_room`：进入游戏房间并广播房间玩家列表
- `sync_character`：游戏页同步出战角色数据
- `host_start_game`：房主开始游戏，支持新开或加载存档
- `lobby_chat_send` / `lobby_chat_receive`：大厅闲聊
- `player_action`：玩家行动、骰子结果、日志写入、AI 触发判断
- `new_message`：后端向游戏页广播玩家/骰子/DM 消息
- `turn_state`：后端广播明确回合状态，包含 `waiting_players`、`waiting_rolls`、`waiting_dm`、待行动玩家、待掷骰玩家和检定结果
- `disconnect`：玩家断线，从内存房间移除；房间无人则销毁

## 前端数据流

登录成功后写入 localStorage：

- `trpg_username`：账号唯一 ID
- `trpg_current_char_id`：大厅选中的出战角色 ID

当前身份模型：

- 账号只用于登录、角色卡归属、战役笔记归属和存档归属。
- 注册页不再要求昵称，首页欢迎语固定为 `Hello，调查员。`。
- 跑团内展示名、玩家列表名、回合锁、ROLL 归属和 Socket `playerName` 统一使用当前出战角色卡姓名。
- 前端只会清理旧缓存 `trpg_nickname`，不再读取它参与业务判断。

大厅页读取当前账号角色卡，选择出战角色后写入 `trpg_current_char_id`。开始游戏后跳转 `/game/:roomId`。
`Lobby` 会等角色卡加载完成后再发送 `join_lobby`，避免先用占位名加入、随后切换成角色名造成重复玩家。

游戏页根据 `trpg_username` 和 `trpg_current_char_id` 拉取完整角色卡，转换出：

- 基础属性检定项：力量、体质、体型、敏捷、外貌、智力、灵感、意志、教育、幸运、理智、SAN
- 技能成功率：`base + job + interest + grow`
- HP、SAN、MP 当前值与上限

## 回合与骰子逻辑

协议解析：

- 后端 `src/domain/directives.js` 和前端 `src/domain/directives.ts` 共同维护 `ROLL`、`STAT` 和骰子结果的解析规则。
- 页面和 Socket 不再各写一套主要正则；后续扩展 `CLUE`、`SCENE` 等指令时优先扩展 domain 层。

后端判断是否触发 AI：

- 如果上一条 DM 消息含 `<<ROLL:技能:角色卡姓名>>`，等待所有被点名且仍在房间内的角色提交 `D100 =` 结果。
- 如果没有检定要求，等待房间内所有玩家都提交一次 `player_action`。
- 条件满足后读取最后 15 条日志，组装为 Chat Completions 上下文，调用模型。
- 每次进入房间、同步角色、玩家行动、AI 回复后，后端都会广播 `turn_state`。前端优先按这个状态锁定输入框，本地聊天历史推导只作为兜底。

前端游戏页会解析 DM 消息：

- `<<ROLL:技能:角色卡姓名>>`：剥离指令，只有本地 `myCharacter.name` 匹配时渲染可点击检定按钮。
- `<<STAT:角色卡姓名:HP|SAN|MP:+/-数字>>`：剥离指令，渲染状态变更提示，并更新本地角色/队友状态。

Socket 房间身份细节：

- `join_lobby` 的 `playerName` 来自大厅当前出战角色卡姓名。
- `sync_character` 的 `nickname` 参数名是旧命名，当前传入的也是角色卡姓名。
- 后端 `registerRoomSocket.js` 仍保留 `accountName` 字段兼容旧数据，但现在它实际会与角色名保持一致。
- 后端匹配同一玩家时会比较 `socket.id`、`name`、`accountName`、`characterName`，因此重连、退出和切换角色会尽量更新现有玩家条目。
- 房主切换出战角色后，`ownerName` 会同步更新，避免房主权限丢失。

## 角色卡编辑器

`CreateCharacter` 支持：

- 基本信息、职业、时代、住地、故乡
- 随机投掷属性和购点模式
- COC 7th 常用技能表、自定义技能
- 职业点、兴趣点余额计算
- 背景、重要之人、恐惧症、经历、资产等文本字段

当前编辑模式从 `location.state?.character` 读取旧卡；保存时向 `/api/characters` POST，后端用传入 `id` 判断更新还是新建。

## 关系图与笔记

`src/components/RelationGraph.tsx` 是无外部依赖的 DOM + SVG 小工具：

- 新建人物节点
- 拖动节点移动位置
- 将节点拖到另一个节点上建立有向关系
- 双击节点/边重命名
- 拖到垃圾桶删除节点及相关边

`Game` 把关系图节点和边状态提升到父组件，避免切换笔记 tab 时丢失。自由笔记、关键线索、关系图节点和边会通过 `/api/notebooks` 自动持久化到 `ai-trpg-server/notebooks.json`。

笔记保存粒度：

- key：`roomId + username`
- 内容：`freeNotes`、`clues`、`graphNodes`、`graphEdges`、`updatedAt`

## 已整理重复逻辑

- `Lobby` 里原本有两段重复拉取角色卡的 `useEffect`，现在合并为 `loadCharacters`。
- 删除角色卡后复用 `loadCharacters` 刷新列表和当前出战角色。
- 大厅入房 Socket 上报会随着当前出战角色变化重新同步。
- Auth 注册表单删除昵称字段，账号与跑团展示名彻底拆开。
- Home 不再读取昵称，欢迎语固定为 `Hello，调查员。`。
- Game 的发言、掷骰、回合等待、队友过滤都改为基于角色卡姓名。
- Game 已接入后端 `turn_state`，不再完全依赖前端从聊天历史猜回合锁。
- `ROLL` 已接入稳定 `rollId`，投骰提交、日志保存、重复拦截和结果回填优先按 `rollId` 匹配。

## 已完成的架构整理

- 后端从单文件拆到 `src/routes`、`src/repositories`、`src/services`、`src/sockets`、`src/storage`。
- 前后端分别新增 `domain/directives`，集中维护 `ROLL`、`STAT` 和骰子结果解析。
- 后端新增 `turn_state` 广播，显式描述当前处于等待玩家、等待掷骰或等待 DM 结算。
- 前端 Socket 客户端集中在 `src/socket.ts`。
- 根目录已初始化 Git 仓库并推送到 GitHub，`.env`、运行 JSON、日志、存档和依赖目录已在 `.gitignore` 中排除。

## 空文件与可清理项

- `src/assets/components/ChatBox.tsx` 是空文件。
- `src/assets/components/PinkButton.tsx` 是空文件。
- `ai-trpg-web/README.md` 仍是 Vite 模板说明。

## 风险与后续优先级

1. 密码改为哈希存储；接口增加会话或 token 校验。
2. 把 repository 层从 JSON 文件替换为 PostgreSQL/MySQL，房间实时状态迁到 Redis。
3. 为 `users.json`、`characters.json`、`saves/meta.json` 增加更强并发写保护，直到数据库替换完成。
4. 继续收敛 Socket 生命周期：现在已集中使用 `src/socket.ts`，但跨页面 join/leave 时机仍需要更系统的状态机。
5. 补充最小测试：角色卡保存、房间回合触发、ROLL/STAT 解析、notebook 保存。
6. `sync_character` 的 `nickname` 参数名应在后续重命名为 `playerName` 或 `characterName`，避免继续误导。
