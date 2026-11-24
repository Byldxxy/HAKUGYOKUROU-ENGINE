# 当前白玉楼引擎契约

对照项目内的 `ai-trpg-server/src/repositories/scenarioRepository.js`、`src/services/campaignService.js`、`src/ai/systemPrompt.js`、`src/sockets/registerRoomSocket.js`（后三项相对后端目录）。现成参考为 `scenarios/peach-island/chapter-03.json` 与 `scenarios/ontology/ontology.json`。版本变化时以实际读取和结算代码为准。

| 字段 | 编制时的用法 |
| --- | --- |
| `schemaVersion`, `type`, `status` | 内置作品采用 1、chapter、draft。是否出现在大厅由注册表和前端选项决定。 |
| `id`, `scenarioId`, `title`, `summary`, `chapterGoal` | 分别标记章节、系列、展示标题、导演摘要和章节目标。`scriptId` 是服务端注册键。 |
| `adaptationRules`, `resolutionRules`, `directorSecrets` | 传给 KP 的全章改编规则、裁定规则和秘密。把剧透从开场、公开线索和结局之前的台词中移出。 |
| `initialState` | 用 `phase: "active"` 和存在的 `currentSceneId` 起步。`facts` 是预声明的布尔字典，当前只能置 true；`clocks` 是各自含 `value`、`max` 的对象，一次回复每钟最多变动两格。`inventory` 填初始队伍物件 ID，会形成队伍持有记录。转交或放置由 KP 的 `memoryChanges` 结算。 |
| `scenes[]` | `id`、`title`、`location`、`entryNarration` 构成场景。开局和转场时直接展示入口文字。整条当前场景对象进入导演上下文，可在 `objectives`、`suggestedChecks` 或场景专用说明里写动机、证据、提问反应、失败代价及哪些行为对应哪些事实。 |
| 场景白名单 | `allowedFactChanges`、`allowedClockChanges`、`availableClues` 只列本场能够改变或揭示的已声明 ID。建议检定写技能、目的、失败后果；实际每名玩家每次至多一项检定。HP/SAN/MP 走导演回复的 `statChanges`，避免用名为 `injury` 的时钟。 |
| `clues[]` | 每条有 `id`、玩家可读的 `title` 和 `content`；可写 `sources`、`critical` 和机器可判定的 `requires`。模型只收到已揭示的全局线索定义，所以在当前场景中也写清候选 ID 的含义和触发依据。 |
| `transition` | 每场至多一个 `to` 目标和一个 `when` 条件。导演须提交相同的 `proposedTransition`。多路线可在同一大场景中用调查顺序、事实和代价表现，再汇合到后继场景；多结局用不同事实或时钟区分。 |
| `endings[]` | 每个结局有 `id`、`label`、`priority`、`conditions`、`result`。条件每轮全局比较，高优先级先命中；漏写条件会过早结束。`result.phase` 沿用 completed 或 redirected，`publicNarration` 写可见后果。若结果依赖地点，要用只在对应场景可置真的事实表示。 |
| `directorOutputContract` | 沿用 JSON 输出约定：narration、requestedRolls、statChanges、revealedClueIds、proposedStateChanges、proposedTransition、pacing。剧本提供语义，服务端验证模型提议并执行。 |

条件语法为 `{"fact":"key","equals":true}`、`{"clock":"key","atLeast":3}`、`{"itemHeldBy":{"id":"item-tape","holder":"npc-yu"}}`、`{"promiseStatus":{"id":"keep-name","status":"open"}}` 或递归的 `{"all":[...]}`、`{"any":[...]}`。同一轮先应用批准的事实和时钟，再判线索、转场、结局。等待掷骰时，依赖检定的变化须在取得结果后提交；场景中要写明失败证据从哪里来。

**资料送达范围。** 顶层 `actors`、`items` 的 ID 和名称会进入目录，详细设定仍要写在相关场景中。上下文另含召回的记忆、章节摘要与目标、两组规则、导演秘密、当前场景、战役状态、已揭示线索、玩家及输出契约。模型也看不到全局结局条件表。在相应场景写出事实名与触发行为的对应关系。仅靠 `nextChapterId`、`carryFacts`、`carryItems` 不会自动开下一章。

**加入选单。** 服务端在 `SCENARIO_FILES` 中把一个新 `scriptId` 映射到一个章节 JSON；前端在 `ai-trpg-web/src/pages/Lobby/index.tsx` 的 `scriptOptions` 中使用同一个值和玩家可见标题。服务端会缓存已载入的 JSON。接入验证可从实际注册键调用 `createCampaign(scriptId)`，并核对大厅选择、新建房间开场和前端构建。

## 从一段原文到一个可玩的分歧

示例素材是为本技能写的短文：

> 馆要闭了，余青才把磁带从大衣口袋里拿出来。盒上写着“空白”，末尾却有十秒旧电台的台呼。小陈认得那声音，把昨夜的播出日志翻给她看。他在卡上打出“主持人余青”，余青按住他的手：“录下它的是我。说话的人不是我。”小陈换了张卡，问她愿不愿意留下名字。

[示例章节](../assets/broadcast.json) 把小陈主动翻日志的决定交给玩家，保留了磁带、日志和余青对署名的纠正。备用机是为失败后复核而补写的道具；匿名展卡是从原文最后一个问题延展出的另一种结局。若玩家只是问过姓名却没有登记，两种结局都不应触发。[回放](../assets/broadcast.routes.json) 专门检查了这个中间状态。

## 战役记忆与回放

导演提交的每个 `memoryChanges` 元素含 `id`、`kind`、`label`、`witnesses` 和摘自本次公开叙述的 `evidence`。道具填 `holder` 或 `location`，可带 `condition`；承诺填 `from/to/terms/status`；情报填 `statement/source/basis`。现场所见用 observed，转述用 heard。NPC 优先用剧本演员 ID，玩家用角色目录中的 pc:角色卡ID。等骰点时服务端暂缓全部记忆变更。实况、每人最近一次所知和相应出处随快照保存。用普通事实记录「曾经取得」，用 itemHeldBy 判断「此刻在谁手中」。

回放的短路线可用 `name` 代替 `ending`，末步应断言仍能行动。每步的 `action` 记玩家选择，`reply` 是测试注入的已知导演提议，`expect.memory` 用 kind、id 指定对象，可核对 state 中字段，或给 who 核对特定观察者。absent:true 检查记录或该人的见闻缺失。结局覆盖仍需完整路线。示例里的拒绝、错误传闻、连续失败与离场不会触发署名。
