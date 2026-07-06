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

生产环境前端默认使用 `window.location.origin`，由 Nginx 同源代理 `/api` 和 `/socket.io`。部署模板在根目录 `deploy/`。

## 认证与安全边界

- `src/services/securityService.js` 使用 Node `crypto.scryptSync` 保存密码哈希，并签发 HMAC-SHA256 会话 Cookie。
- Cookie 名为 `trpg_session`，使用 `HttpOnly + SameSite=Lax`；生产环境强制 `Secure`。
- `src/middleware/authenticate.js` 同时服务 REST 与 Socket.IO，认证身份写入 `req.user` / `socket.data.user`。
- 私有 REST 路由不再信任 query/body 中的 `username`，统一使用会话账号。
- Socket `join_lobby` / `sync_character` 只接受当前账号拥有的角色 ID，姓名、职业和资源值从服务器角色库读取。
- `player_action`、大厅聊天、离房和房主权限都按已认证 socket 与房间内部玩家记录判断。
- 存档加载会通过 `saveRepository.findOwnedSave` 校验所有权，避免任意 saveId 和路径型输入。
- 大厅 `lobby_update` 只广播公开摘要，不再发送 `fullData` / `accountName`。
- 旧 `users.json` 可运行 `npm run migrate:passwords` 一次性迁移；未迁移账号首次登录也会自动升级。
- 生产环境缺少 32 字符以上 `SESSION_SECRET`、使用 `CORS_ORIGIN=*` 或缺少 `API_KEY` 时后端拒绝启动。
- 根 `.gitignore` 已忽略 zip/tar 归档；本地 `ai-trpg-server/backend-update.zip` 含 `.env` 与运行数据，不得上传或部署到 Web 可访问目录。

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
- COC 7th 常用技能表、自定义技能、子类型技能
- 职业点、兴趣点余额计算，职业点优先按职业列表公式实时计算
- 背景、重要之人、恐惧症、经历、资产等文本字段

当前编辑模式从 `location.state?.character` 读取旧卡；保存时向 `/api/characters` POST，后端用传入 `id` 判断更新还是新建。

### 最新页面状态（2026-07-06）

- 基本信息页使用 `.basic-tab-active` 关闭右侧内部滚动，`.basic-page` 在当前工作区高度内分配身份区和属性区。
- 身份输入框与派生属性条统一为 `50px` 高；派生属性条通过 `margin-top: auto` 与头像下沿对齐。
- 九项属性按 `statOrder` 固定顺序渲染，标题来自 `statLabels`，用途说明来自 `statDescriptions`，避免对象键顺序随重新骰点变化。
- 属性区为 3×3 等高网格；随机/购点操作统一放在 `44px` 高的 `.stat-mode-action` 中，模式说明用 flex 垂直居中。
- 技能页标题栏右上角显示紧凑职业摘要；重复的职业规则说明块已经删除，自选槽使用横向网格。
- 技能卡采用桌面双列、卡内单行布局；职业固定/自选技能不能在卡片上改名或删除，真正手建技能仍可编辑。
- 三个点数预算块位于技能列表左侧，右侧提供添加自定义技能和清空全部投入按钮；清空只重置 job/interest/grow。
- `src/components/StyledSelect.tsx` 与 `StyledSelect.css` 是 Lobby 和角色卡共用的下拉组件。

### 角色卡职业列表

已新增 `ai-trpg-web/src/data/cocOccupations.ts`：

- 数据来源是用户提供的《COC七版规则空白卡CY20.02.2.xlsx》中的“职业列表”工作表。
- 数据整理为 `COC_OCCUPATIONS`，字段包括 `id`、`name`、`creditRange`、`pointFormula`、`skills`、`contacts`、`description`。
- `/create-character` 左侧新增“职业列表”页签，位于“背景与资产”下面。
- 职业列表支持搜索职业名、技能、点数公式、联系人和描述。
- 右上角 `xx / 230 项` 计数框现在也是排序按钮：
  - 白框粉色阴影：按原始序号排序。
  - 粉框黑色阴影：按当前角色属性计算出的职业点数排序。
- 职业点公式支持 `教育×4`、`教育×2＋力量或敏捷×2` 等格式；含“或”时取当前较高属性。
- 点击“套用职业”会写入 `basicInfo.occupation`，并把职业信用评级范围写入 `bgInfo.credit`。

### 角色卡技能加点页

最新一版重构集中在 `ai-trpg-web/src/pages/CreateCharacter/index.tsx` 和 `CreateCharacter.css`：

- 技能页顶部为“标题 + 右上职业摘要”，下方职业自选槽横向排列，点数预算放在技能列表工具栏。
- 本职点不再固定为 `EDU×4`；若当前职业可在 `COC_OCCUPATIONS` 找到，则使用该职业 `pointFormula` 实时计算。
- 职业技能文本会解析成：
  - 固定本职技能，例如 `会计`、`法律`、`图书馆使用`。
  - 社交技能自选，例如 `两项社交技能（取悦、话术、恐吓、说服）`。
  - 任意技能/个人或时代特长自选。
  - 子类型技能，例如 `技艺（表演）`、`科学（生物学，化学）`、`外语`、`格斗（斗殴）`、`射击（手枪）`。
- 固定技能和已选择的自选技能会自动补进 `skills[]`，并在技能表中排在前面。
- 技能卡使用 `固定`、`自选`、`普通` 徽标区分来源，桌面双列排列，单卡内容压成一条横向记录。
- 职业投入只开放给当前本职技能；普通技能的职业投入默认锁定。
- 为兼容旧卡，如果某个普通技能旧数据中已经有职业投入，则输入框不会被完全锁死，方便用户清零或迁移。
- 兴趣点和成长点仍可投任意技能。
- 职业自选槽状态保存到 `fullData.occupationSkillChoices`，重新编辑角色卡时可恢复选择。
- 保存结构仍保留兼容的 `skills[]`，所以游戏页 `base + job + interest + grow` 的读取方式不需要同步改动。
- 技能显示名已统一为中文；旧英文后缀和旧别名由 `normalizePersistedSkillName` 在编辑时迁移。
- 技艺、科学、外语、格斗、射击、驾驶、生存、学识使用上级分类 + 子技能的两级选择；预设子技能维护在 `specialtySubtypeOptions`。
- 选择“自定义...”时输入框会原位替换第二级菜单，不增加新行；最终保存真实名称，如 `外语:阿拉伯语`。
- `ai-trpg-web/src/data/cocSkills.ts` 不再保存 `自定义①/②/③` 伪技能，旧的空白占位记录会被过滤。

当前技能解析辅助函数在 `CreateCharacter/index.tsx` 顶部，包括：

- `calculateOccupationPoints`：解析职业点公式。
- `parseOccupationSkillRules`：从职业技能文本解析固定技能和自选槽。
- `normalizeSkillName`：把中文职业表技能映射到角色卡技能名。
- `normalizeSubtypedSkillName`：生成 `技艺:表演`、`科学:生物学` 这类子类型技能。
- `createDefaultSkills`：从 `src/data/cocSkills.ts` 生成完整默认技能模板。

这版已通过：

- `npm run build`
- `git diff --check`

尚未做浏览器人工验收。接手时建议重点看“职业与技能”页的视觉密度、移动端/窄屏表现，以及典型职业的解析是否符合预期。

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
- 角色卡职业列表已从 Excel 抽成前端结构化数据，避免继续依赖表格文件。
- 角色卡技能页已经初步从“纯手填表格”改为“职业规则驱动 + 手动修正”的半自动写卡模式。

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

1. 把 repository 层从 JSON 文件替换为 PostgreSQL/MySQL，房间实时状态和可撤销会话迁到 Redis。
2. 为 `users.json`、`characters.json`、`saves/meta.json` 增加更强并发写保护，直到数据库替换完成。
3. 继续收敛 Socket 生命周期：现在已集中使用 `src/socket.ts`，但跨页面 join/leave 时机仍需要更系统的状态机。
4. 补充自动测试：认证迁移、角色归属、Socket 伪造、房间回合、ROLL/STAT、notebook 保存。
5. 当前 D100 结果仍由客户端生成；若需要防作弊，应把掷骰随机数与结果判定迁到后端。

## 当前接力重点

- 技能库已依据 `COC七版规则空白卡CY20.02.2.xlsx` 的人物卡技能区补齐，模板集中在 `ai-trpg-web/src/data/cocSkills.ts`。除基础技能外，现已包含技艺/格斗/射击/外语/科学等专业槽，以及克苏鲁神话、电子学、锁匠、操作重型机械、骑术、妙手、生存、驯兽、潜水、爆破、读唇、催眠、炮术、学识等扩展技能。
- “自然”“自然学”和旧英文 `Natural World` 存档统一迁移并合并为“博物学”，旧版驾驶、斗殴、劝说、领航、秘教名称也会迁移到当前规范名称，保留原加点。
- 技能加点区已由单列高表格改为桌面双列紧凑卡片，职业技能优先并以粉色边框突出；窄屏自动回落为单列。后续需要重点实测大量技能下的桌面高度、笔记本分辨率和移动端输入体验。
- 技能页顶部已进一步压缩：移除重复固定技能标签与说明行，三个点数统计缩成技能列表工具栏内的小状态块。技能模板、职业解析、旧技能和旧自选槽均统一显示及保存为纯中文名称。
- 专业技能自选已改为两级联动：第一栏选择普通技能或技艺/科学/外语/格斗/射击/驾驶/生存/学识等上级分类，第二栏选择预设子技能；选择“自定义...”后必须填写真实名称再添加。旧版 `自定义①/②/③` 伪技能已从模板和职业自选记录中过滤。

角色卡写卡模块正在重构中，下一位接手时优先关注：

1. 浏览器里实际打开 `/create-character`，检查“职业与技能”页新版布局是否符合现有粉色纸卡 UI。
2. 用几个代表职业手测解析结果：
   - `会计师`：固定技能 + 任意两项特长。
   - `演员-戏剧演员`：`技艺（表演）` + 两项社交技能 + 任意特长。
   - `精神病医生（古典）`：`科学（生物学，化学）` 应拆成两个科学子技能。
   - `事务所侦探、保安`：公式 `教育×2＋力量或敏捷×2` 应取力量/敏捷较高者。
3. 检查自选槽保存后重新编辑是否能恢复 `occupationSkillChoices`。
4. 讨论是否需要把技能解析和 COC 默认技能表拆到独立 `data/` 或 `domain/` 文件；当前为了快速落地仍放在 `CreateCharacter/index.tsx` 顶部，文件已经偏大。
5. 后续可以继续补“信用评级范围校验”“职业技能数目校验”“兴趣点推荐”等半自动卡功能。
6. 当前 Git 工作区仍有未提交改动，至少涉及 `CreateCharacter/index.tsx`、`CreateCharacter.css`、Lobby 下拉重构、`src/components/StyledSelect.*`、`src/data/cocOccupations.ts` 与 `src/data/cocSkills.ts`；提交前先执行 `git status` 核对。
