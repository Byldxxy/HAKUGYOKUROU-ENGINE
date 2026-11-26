# 生产部署清单

本目录提供 Nginx、PM2、systemd 和本地数据备份模板。将示例中的 `example.com`、安装路径和系统用户替换为实际值。

## 1. 生产环境变量

复制生产模板。该文件已被 Git 忽略，不会覆盖本地开发用的 `.env`：

```bash
cd /opt/hakugyokurou/ai-trpg-server
cp .env.production.example .env.production
```

服务器上的 `ai-trpg-server/.env.production` 至少配置：

```env
PORT=3000
HOST=127.0.0.1
TRUST_PROXY=true
CORS_ORIGIN=https://example.com

SESSION_SECRET=使用_openssl_rand_hex_32_生成的随机值
SESSION_MAX_AGE_SECONDS=604800
COOKIE_SECURE=true

API_KEY=模型服务密钥
BASE_URL=https://api.openai.com/v1
MODEL_NAME=实际模型名
AI_TIMEOUT_MS=30000
CUSTOM_AI_TIMEOUT_MS=90000
```

生成会话密钥：

```bash
openssl rand -hex 32
```

PM2 会注入 `NODE_ENV=production`，后端随后自动读取 `.env.production`。生产模式会拒绝以下配置：缺少/过短的 `SESSION_SECRET`、未填写或使用通配的 `CORS_ORIGIN`、缺少 `API_KEY`。

## 2. 安装与构建

```bash
cd /opt/hakugyokurou/ai-trpg-server
npm ci --omit=dev

cd /opt/hakugyokurou/ai-trpg-web
npm ci
# 如需展示备案信息，先设置下文的构建参数
npm run build
```

前端默认使用当前页面域名访问 `/api` 和 `/socket.io`，无需把域名写死进源码。

构建前可在 `ai-trpg-web/.env.production.local` 或构建环境中设置 `VITE_ICP_NUMBER` 和 `VITE_POLICE_NUMBER`。登录页和大厅分别显示已填写的备案链接。修改后重新构建前端。该本地文件由 Git 忽略，`VITE_` 变量的值会进入浏览器资源，只应填写面向访客展示的内容。

更新时先备份运行数据，发布带哈希的静态资源后再切换 `index.html`。重启服务后核验 HTTPS、`/api/health` 和 Socket.IO 握手。

## 备份房间闲聊和自有接口

备份脚本包含 `logs/lobby-chat/` 与 `provider-profiles/`。后者的 `accounts.json` 与权限为 0600 的 `encryption.key` 需要一起恢复；备份归档也需限制访问。首次保存自有接口时，服务会生成该实例专用的随机加密密钥。旧版只在内存中的配置需要由房主首次重新保存。

## 发行 CDK 和备份额度

在后端安装目录生成一次性兑换码。下例面额为 100 点，参数接受 1 至 1,000,000 的整数。将标准输出的兑换码私下交给使用者。

```bash
cd /opt/hakugyokurou/ai-trpg-server
NODE_ENV=production node scripts/issue-cdk.js 100
```

兑换时会将点数记入当前房主账号。单实例后端使用数据目录中的 `credits.json` 同时记录账户余额和已兑换编号。备份脚本覆盖此文件。恢复旧账本会回退备份时间之后的扣点和兑码记录。发行和兑换使用同一生产 `SESSION_SECRET`，轮换后未兑换的旧码会失效，已有余额保留。

## 3. 旧密码迁移

迁移前先备份 `users.json`，随后运行：

```bash
cd /opt/hakugyokurou/ai-trpg-server
npm run migrate:passwords
```

脚本会删除旧 `password` 字段并写入 `scrypt` 哈希。未主动运行时，旧账号也会在首次成功登录后自动迁移，但正式开放前建议一次性完成。

## 4. HTTPS 与反向代理

1. 把 `nginx.conf.example` 中的域名、证书路径和项目路径换成实际值。
2. 将 `limit_req_zone` 放进 Nginx 的 `http {}`。
3. 将两个 `server {}` 放入站点配置。
4. 用 Certbot 或云厂商证书配置 TLS。
5. 只向公网开放 `80/443`；不要开放 `3000/5174`。

模板已包含 SPA 回退、WebSocket Upgrade、HSTS、CSP、静态资源缓存和 API 限流。

## 5. PM2 后端常驻

项目只支持单后端实例，因此 ecosystem 固定使用 fork 模式和一个实例：

```bash
cd /opt/hakugyokurou
pm2 start deploy/ecosystem.config.cjs --env production
pm2 save
pm2 startup
```

`--env production` 是环境切换开关。不要在服务器上使用 `npm run dev`，它会有意切回本地开发配置。

常用更新流程：

```bash
cd /opt/hakugyokurou
git pull
cd ai-trpg-web && npm ci && npm run build
cd ../ai-trpg-server && npm ci --omit=dev
cd .. && pm2 restart deploy/ecosystem.config.cjs --env production
```

## 6. systemd 备选

如果不使用 PM2，可以直接复制并按实际安装路径修改 `hakugyokurou.service.example`：

```bash
sudo cp deploy/hakugyokurou.service.example /etc/systemd/system/hakugyokurou.service
sudo systemctl daemon-reload
sudo systemctl enable --now hakugyokurou
```

后端使用独立低权限用户运行。确保该用户可写 `users.json`、`characters.json`、`notebooks.json`、`logs/` 和 `saves/`，其他用户不应读取 `.env` 与数据文件。

## 7. 备份

`backup-data.sh` 会打包运行数据并清理 14 天前的旧备份。建议通过 cron 每日执行，并将备份同步到另一台机器或对象存储。

```bash
/opt/hakugyokurou/deploy/backup-data.sh /opt/hakugyokurou /var/backups/hakugyokurou
```

如果服务指定了自定义数据目录，运行备份脚本时也应传入相同的 `TRPG_DATA_DIR`。付费回合恢复依赖同一时间点的 `credits.json` 与 `logs/`，其中 `logs/settlements/` 保存尚待完成的提交。使用文件系统时间点快照，或在短暂停服期间打包整个数据目录，并在恢复后以单实例启动。续团也依赖同一时间点的 `saves/`、`notebooks.json` 和 `scenario-revisions/`。最后一个目录按内容指纹归档开团时的剧本。发布新版剧本时请保留旧修订，换机器时从备份一并恢复这些目录。恢复后可在隔离实例用原班角色载入一个旧档，核对当前场景和个人笔记。

离线代掷与断线重连共用 `RECONNECT_GRACE_MS`，默认 30000 毫秒。玩家需要在自己的房间设置中明确授权；超过宽限期后由服务器写入带标记的骰点。

## 8. 主持容量与耗时统计

站点主持和房主自有接口各有一条先进先出的有限队列。以下设置均为可选。容量应结合真实供应商的速率限制和服务日志调整。

| 环境变量 | 默认值 | 用途 |
|---|---:|---|
| `AI_SITE_CONCURRENCY` | 4 | 同时向站点供应商发送的请求数 |
| `AI_CUSTOM_CONCURRENCY` | 8 | 全部自有接口共享的并发请求数 |
| `AI_QUEUE_SIZE` | 24 | 每条队列可额外等待的请求数，设为 0 即仅接受空闲名额 |
| `AI_TIMEOUT_MS` / `CUSTOM_AI_TIMEOUT_MS` | 30000 / 90000 | 从申请队列名额起计算的请求总时限，单位毫秒 |
| `AI_INPUT_TOKEN_BUDGET` | 32768 | 组装上下文时的保守估算上限，以 UTF-8 字节加消息开销估算 |
| `AI_OUTPUT_TOKEN_BUDGET` | 4096 | 每次请求交给模型的输出 token 上限 |
| `PERF_METRICS_INTERVAL_MS` | 60000 | 有样本时输出一行聚合统计的间隔，0 关闭输出 |

模型输入优先包含本轮行动、最近检定、当前场景和相关道具。多人长行动超出预算时，模型会看到每名玩家发言的首尾和节选标记；完整行动保存在战役日志，检定指令和骰点完整送达。模型因输出上限截断时会提示重试并释放预留额度。已访问场景以访问次数和最近六次转场表示。可从 PM2 日志筛选 `trpg_performance`。其中 `dm_queue_ms`、`dm_upstream_ms`、`dm_commit` 分别表示排队、供应商响应与持久化耗时，单位为毫秒。`room_snapshot_ms` 和 `room_snapshot_messages` 记录生成快照的耗时与消息条数。每行提供计数、总和、最大值，以及该窗口内最近最多 512 个观测值的 P50 和 P95。供应商返回用量时，`input_tokens` 和 `output_tokens` 记录其报告的实际值；`input_token_estimate` 单独记录预算估算值。统计按渠道和结果聚合，默认生产配置关闭原始模型回复日志。

## 9. 当前架构限制

- 房间状态保存在单个 Node 进程内，当前只能运行一个后端实例。
- JSON/JSONL 适合小规模测试；正式扩容前应迁移到 PostgreSQL 与 Redis。
- 部署后应定期检查登录限流、401/429、Socket 连接失败和模型调用异常日志。
