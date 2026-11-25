# 白玉楼 Web 客户端

客户端使用 React、TypeScript 和 Vite。`src/pages/CreateCharacter` 负责角色卡编辑，`src/pages/Lobby` 负责选卡与房间设置，`src/pages/Game` 展示战役回合、检定和笔记。

## 开发

先按[项目运行说明](../README.md#本地运行)启动后端，再在本目录执行：

```bash
npm ci
npm run dev
```

默认入口为 `http://localhost:5174`。Vite 同时代理 HTTP 和 Socket.IO；需要更换开发端口或后端地址时，可设置 `VITE_DEV_PORT` 和 `VITE_DEV_API_TARGET`。

## 游戏桌

- 在同一标签页刷新，未发送的行动仍留在输入框。行动草稿按账号和房间存储在 `sessionStorage`，服务端确认提交后清除。
- 回看历史或从战役笔记跳到原话时，收到的消息会计数。点击消息数回到最新叙事。手机上可从顶部查看角色卡、队伍和笔记，从底部完成待办检定。
- 建卡草稿保存在当前浏览器的 `localStorage`，按账号、房间和角色区分。将角色正式录入或主动舍弃草稿后，浏览器会清除对应草稿。

## 生产构建

```bash
npm run lint
npm run build
```

静态文件输出到 `dist/`。生产环境由反向代理将同源的 `/api` 与 `/socket.io` 转交给后端。页脚备案链接通过构建环境逐项配置，示例变量见 [.env.example](.env.example)。[部署指南](../deploy/README.md)
