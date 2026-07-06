# 生产部署清单

本目录提供 Nginx、systemd 和本地数据备份模板。将示例中的 `example.com`、安装路径和系统用户替换为实际值。

## 1. 生产环境变量

服务器上的 `ai-trpg-server/.env` 至少配置：

```env
NODE_ENV=production
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
```

生成会话密钥：

```bash
openssl rand -hex 32
```

生产模式会拒绝以下配置：缺少/过短的 `SESSION_SECRET`、`CORS_ORIGIN=*`、缺少 `API_KEY`。

## 2. 安装与构建

```bash
cd /opt/hakugyokurou/ai-trpg-server
npm ci --omit=dev

cd /opt/hakugyokurou/ai-trpg-web
npm ci
npm run build
```

前端默认使用当前页面域名访问 `/api` 和 `/socket.io`，无需把域名写死进源码。

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

## 5. 后端常驻

复制并修改 `hakugyokurou.service.example`：

```bash
sudo cp deploy/hakugyokurou.service.example /etc/systemd/system/hakugyokurou.service
sudo systemctl daemon-reload
sudo systemctl enable --now hakugyokurou
```

后端使用独立低权限用户运行。确保该用户可写 `users.json`、`characters.json`、`notebooks.json`、`logs/` 和 `saves/`，其他用户不应读取 `.env` 与数据文件。

## 6. 备份

`backup-data.sh` 会打包运行数据并清理 14 天前的旧备份。建议通过 cron 每日执行，并将备份同步到另一台机器或对象存储。

```bash
/opt/hakugyokurou/deploy/backup-data.sh /opt/hakugyokurou /var/backups/hakugyokurou
```

## 7. 当前架构限制

- 房间状态保存在单个 Node 进程内，当前只能运行一个后端实例。
- JSON/JSONL 适合小规模测试；正式扩容前应迁移到 PostgreSQL 与 Redis。
- 部署后应定期检查登录限流、401/429、Socket 连接失败和模型调用异常日志。
